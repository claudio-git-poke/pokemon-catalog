-- Cardmarket officially supports /Pokemon/Products?idProduct=<ID> redirects.
-- These identify marketplace products, which can cover several physical finishes.
alter table public.set_carte drop constraint set_carte_cardmarket_url_check;
alter table public.set_carte add constraint set_carte_cardmarket_url_check check (
 cardmarket_url is null or cardmarket_url ~ '^https://www[.]cardmarket[.]com/it/Pokemon/Products/[^?#]+$'
 or (cardmarket_id is not null and cardmarket_id>0 and cardmarket_url='https://www.cardmarket.com/it/Pokemon/Products?idProduct='||cardmarket_id::text)
);
alter table public.catalog_search_entries
 add column cardmarket_id bigint,
 add column cardmarket_url text,
 add column cardmarket_method text,
 add column cardmarket_status text not null default 'pending' check(cardmarket_status in ('pending','linked','conflict'));
alter table public.catalog_search_entries add constraint catalog_entry_cardmarket_url_check check (
 cardmarket_url is null or cardmarket_url ~ '^https://www[.]cardmarket[.]com/it/Pokemon/Products/[^?#]+$'
 or (cardmarket_id is not null and cardmarket_id>0 and cardmarket_url='https://www.cardmarket.com/it/Pokemon/Products?idProduct='||cardmarket_id::text)
);

-- Old workers can have a cached reference without the freshly completed URL.
create function public.catalog_keep_cardmarket() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then
  new.cardmarket_id:=coalesce(new.cardmarket_id,old.cardmarket_id);
  new.cardmarket_url:=coalesce(new.cardmarket_url,old.cardmarket_url);
 end if;
 if new.cardmarket_url is null and new.cardmarket_id>0 then
  new.cardmarket_url:='https://www.cardmarket.com/it/Pokemon/Products?idProduct='||new.cardmarket_id::text;
 end if;
 return new;
end $$;
create trigger bindex_cardmarket_link before insert or update on public.set_carte
for each row execute function public.catalog_keep_cardmarket();

create function public.catalog_entry_cardmarket() returns trigger
language plpgsql security invoker set search_path='' as $$
declare source_id text; product_id bigint; published_id bigint; published_url text;
begin
 source_id:=case when new.verification<>'catalog' then new.source_payload->'variant'->'thirdParty'->>'cardmarket' end;
 if source_id ~ '^[1-9][0-9]{0,9}$' then product_id:=source_id::bigint;end if;
 select c.cardmarket_id,c.cardmarket_url into published_id,published_url
 from public.catalog_export_links l join public.set_carte c using(sigla,numero,variante)
 where l.entry_key=new.entry_key and not c.eliminata;
 new.cardmarket_id:=null;new.cardmarket_url:=null;new.cardmarket_method:=null;new.cardmarket_status:='pending';
 if product_id is not null and published_id is not null and product_id<>published_id then
  new.cardmarket_status:='conflict';return new;
 end if;
 new.cardmarket_id:=coalesce(published_id,product_id);
 -- Without a canonical product ID, a source product must retain its own ID redirect.
 new.cardmarket_url:=case when product_id is null or published_id=product_id then published_url end;
 if new.cardmarket_url is null and new.cardmarket_id>0 then
  new.cardmarket_url:='https://www.cardmarket.com/it/Pokemon/Products?idProduct='||new.cardmarket_id::text;
 end if;
 if new.cardmarket_url is not null then
  new.cardmarket_status:='linked';
  new.cardmarket_method:=case when published_url is not null and (product_id is null or published_id=product_id) then 'published_identity' else 'source_product_id' end;
 end if;
 return new;
end $$;
create trigger zz_catalog_entry_cardmarket before insert or update on public.catalog_search_entries
for each row execute function public.catalog_entry_cardmarket();

-- Publication may resolve a printing after its metadata has already been imported.
create function public.catalog_relink_cardmarket() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if (new.sigla,new.numero,new.variante)=(old.sigla,old.numero,old.variante) then return new;end if;
 end if;
 update public.catalog_search_entries set updated_at=clock_timestamp() where entry_key=new.entry_key;
 return new;
end $$;
create trigger catalog_relink_cardmarket after insert or update on public.catalog_export_links
for each row execute function public.catalog_relink_cardmarket();

-- Bounded, replay-safe backfill, also called by every future worker cycle.
create function public.catalog_link_cardmarket(batch_size integer default 1000) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='20s' as $$
declare published_count integer;entry_count integer;card_count integer; cap integer:=least(greatest(coalesce(batch_size,1000),1),5000);
begin
 with candidates as (
  select sigla,numero,variante from public.set_carte where not eliminata and cardmarket_url is null and cardmarket_id>0
  order by sigla,numero,variante limit cap
 ) update public.set_carte c set cardmarket_url='https://www.cardmarket.com/it/Pokemon/Products?idProduct='||c.cardmarket_id::text
 from candidates x where (c.sigla,c.numero,c.variante)=(x.sigla,x.numero,x.variante);
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
revoke all on function public.catalog_keep_cardmarket(),public.catalog_entry_cardmarket(),public.catalog_relink_cardmarket(),public.catalog_link_cardmarket(integer) from public,anon,authenticated;
grant execute on function public.catalog_keep_cardmarket(),public.catalog_entry_cardmarket(),public.catalog_relink_cardmarket(),public.catalog_link_cardmarket(integer) to service_role;
