-- Follow Chiave_Bindex_2026-11-14.txt: canonical pages have no query string.
-- Product-ID redirects remain available in the internal printing index and raw cards.
create or replace function public.catalog_keep_cardmarket() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then new.cardmarket_id:=coalesce(new.cardmarket_id,old.cardmarket_id);end if;
 if new.cardmarket_url is null or new.cardmarket_url !~ '^https://www[.]cardmarket[.]com/it/Pokemon/Products/[^?#]+$' then
  new.cardmarket_url:=null;
  if tg_op='UPDATE' then
   if old.cardmarket_url ~ '^https://www[.]cardmarket[.]com/it/Pokemon/Products/[^?#]+$' then new.cardmarket_url:=old.cardmarket_url;end if;
  end if;
 end if;
 return new;
end $$;
-- No IDs, keys or product evidence are deleted by this correction.
create function public.bindex_repair_urls(batch_size integer default 1000) returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 with candidates as(select sigla,numero,variante from public.set_carte where cardmarket_url is not null and cardmarket_url !~ '^https://www[.]cardmarket[.]com/it/Pokemon/Products/[^?#]+$' order by sigla,numero,variante limit least(greatest(batch_size,1),5000))
 update public.set_carte c set cardmarket_url=null from candidates x where (c.sigla,c.numero,c.variante)=(x.sigla,x.numero,x.variante);
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.bindex_repair_urls(integer) from public,anon,authenticated;
grant execute on function public.bindex_repair_urls(integer) to service_role;
alter table public.set_carte drop constraint set_carte_cardmarket_url_check;
alter table public.set_carte add constraint set_carte_cardmarket_url_check check(cardmarket_url is null or cardmarket_url ~ '^https://www[.]cardmarket[.]com/it/Pokemon/Products/[^?#]+$') not valid;
alter table public.set_carte add constraint bindex_required_values check(nullif(trim(nome),'') is not null and nullif(trim(sigla),'') is not null and array_position(tag,null) is null);
create or replace function public.catalog_link_cardmarket(batch_size integer default 1000) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='20s' as $$
declare published_count integer;entry_count integer;card_count integer; cap integer:=least(greatest(coalesce(batch_size,1000),1),5000);
begin
 with pages as (
  select cardmarket_id,min(cardmarket_url) url from public.set_carte
  where cardmarket_id>0 and cardmarket_url ~ '^https://www[.]cardmarket[.]com/it/Pokemon/Products/[^?#]+$'
  group by cardmarket_id having count(distinct cardmarket_url)=1
 ), candidates as (
  select c.sigla,c.numero,c.variante,p.url from public.set_carte c join pages p using(cardmarket_id)
  where not c.eliminata and c.cardmarket_url is null order by c.sigla,c.numero,c.variante limit cap
 ) update public.set_carte c set cardmarket_url=x.url from candidates x
 where (c.sigla,c.numero,c.variante)=(x.sigla,x.numero,x.variante);
 get diagnostics published_count=row_count;
 with candidates as (
  select e.entry_key from public.catalog_search_entries e
  left join public.catalog_export_links l on l.entry_key=e.entry_key
  left join public.set_carte c on (c.sigla,c.numero,c.variante)=(l.sigla,l.numero,l.variante) and not c.eliminata
  where e.cardmarket_status='pending' and (
   (e.verification<>'catalog' and e.source_payload->'variant'->'thirdParty'->>'cardmarket' ~ '^[1-9][0-9]{0,9}$')
   or c.cardmarket_id>0 or c.cardmarket_url is not null)
  order by e.entry_key limit cap
 ) update public.catalog_search_entries e set updated_at=clock_timestamp() from candidates x where e.entry_key=x.entry_key;
 get diagnostics entry_count=row_count;
 -- A general card gets a product link only if ALL its documented printings agree.
 -- Unknown or conflicting printings block this shortcut; their individual links remain available.
 with products as (
  select e.card_id,min(e.cardmarket_id) product_id
  from public.catalog_search_entries e
  where e.verification<>'catalog' group by e.card_id
  having bool_and(e.cardmarket_status='linked' and e.cardmarket_id is not null) and count(distinct e.cardmarket_id)=1
 ), candidates as (
  select c.id,p.product_id from public.cards c join products p on p.card_id=c.id
  where nullif(trim(c.link_cardmarket),'') is null order by c.id limit cap
 ) update public.cards c set link_cardmarket='https://www.cardmarket.com/it/Pokemon/Products?idProduct='||x.product_id::text
 from candidates x where c.id=x.id;
 get diagnostics card_count=row_count;
 return jsonb_build_object('published',published_count,'printings',entry_count,'cards',card_count);
end $$;

-- A source image is stored under its documented language. Verified photos survive weaker imports.
create function public.bindex_publish_photo(set_code text,card_number integer,printing text,image_language text,image text,image_hd text,image_source text,image_verified boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
declare previous_url text; accepted_url text; accepted_hd text; accepted_verified boolean;
begin
 if image_language not in ('IT','EN','FR','DE','ES','PT','JP','KOR','CHN','CHN-T','TH','ID') or image_language is null then raise exception 'Lingua della foto non documentata';end if;
 if image is null or image !~ '^https://' or nullif(trim(image_source),'') is null then raise exception 'Foto o fonte non valida';end if;
 select p.immagine into previous_url from public.set_carte_immagini p
 where (p.sigla,p.numero,p.variante,p.lingua)=(set_code,card_number,printing,image_language) for update;
 insert into public.set_carte_immagini(sigla,numero,variante,lingua,immagine,immagine_hd,fonte,verificata)
 values(set_code,card_number,printing,image_language,image,image_hd,image_source,coalesce(image_verified,false))
 on conflict(sigla,numero,variante,lingua) do update set immagine=excluded.immagine,immagine_hd=excluded.immagine_hd,fonte=excluded.fonte,verificata=excluded.verificata
 where not public.set_carte_immagini.verificata or excluded.verificata;
 select p.immagine,p.immagine_hd,p.verificata into accepted_url,accepted_hd,accepted_verified from public.set_carte_immagini p
 where (p.sigla,p.numero,p.variante,p.lingua)=(set_code,card_number,printing,image_language);
 update public.set_carte c set immagine=accepted_url,immagine_hd=accepted_hd,immagine_verificata=accepted_verified
 where (c.sigla,c.numero,c.variante)=(set_code,card_number,printing)
 and (nullif(trim(c.immagine),'') is null or c.immagine=previous_url
  or (image_language='IT' and (not c.immagine_verificata or accepted_verified)))
 -- Once an Italian photo is known, a different language cannot take over the main picture.
 and (image_language='IT' or not exists(select 1 from public.set_carte_immagini p where (p.sigla,p.numero,p.variante,p.lingua)=(set_code,card_number,printing,'IT') and p.immagine=c.immagine));
end $$;
revoke all on function public.bindex_publish_photo(text,integer,text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.bindex_publish_photo(text,integer,text,text,text,text,text,boolean) to service_role;

create function public.bindex_contract_report() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('contract','bindex-v1','blocking',count(*) filter(where nullif(trim(nome),'') is null or numero<=0 or variante !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or (codice is not null and codice !~ '^[A-Z0-9][A-Z0-9.-]*( [A-Z0-9]+)?$') or (cardmarket_url is not null and cardmarket_url !~ '^https://www[.]cardmarket[.]com/it/Pokemon/Products/[^?#]+$')),
 'cards',count(*),'missing_code',count(*) filter(where codice is null),'canonical_cardmarket_pages',count(cardmarket_url),
 'cardmarket_ids',count(cardmarket_id),'tombstones',count(*) filter(where eliminata),'checked_at',now()) from public.set_carte
$$;
revoke all on function public.bindex_contract_report() from public;
grant execute on function public.bindex_contract_report() to anon,authenticated,service_role;
