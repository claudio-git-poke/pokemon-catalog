create index if not exists catalog_entry_inventory_seed on public.catalog_search_entries(entry_key) where verification<>'catalog';
-- Source evidence inventory, additive to the immutable Bindex v1 keys.
create table public.catalog_printing_inventory(
 record_key text primary key,
 source_entry_key text unique references public.catalog_search_entries(entry_key) on delete set null,
 card_id bigint references public.cards(id) on delete set null,
 scope text not null check(scope in ('printing','card')),
 language text not null check(language in ('EN','IT','FR','DE','ES','PT','JP','KOR','CHN','CHN-T','TH','ID','NL','PL','RU','ES-LA','und')),
 language_status text not null check(language_status in ('documented','unknown','conflict')),
 check((language='und' and language_status in ('unknown','conflict')) or (language<>'und' and language_status='documented')),
 name text not null,source_set_code text,collector_number text,denominator text,release_code text,release_year integer,deck_code text,deck_number integer,
 attributes jsonb not null default '{}' check(jsonb_typeof(attributes)='object'),tags text[] not null default '{}',facts jsonb not null default '{}',
 source_url text,verification text not null,
 canonical_sigla text,canonical_numero integer,canonical_variante text,canonical_mapping_status text not null check(canonical_mapping_status in ('linked','pending','review')),mapping_reason text,
 check((canonical_mapping_status='linked' and canonical_sigla is not null) or (canonical_mapping_status<>'linked' and canonical_sigla is null)),
 foreign key(canonical_sigla,canonical_numero,canonical_variante) references public.set_carte(sigla,numero,variante) match full,
 image_url text,image_hd text,image_source_url text,image_status text not null check(image_status in ('missing','candidate','verified')),
 image_evidence jsonb not null default '{}' check(jsonb_typeof(image_evidence)='object'),reference_image_url text,reference_source_url text,
 source_updated_at timestamptz not null,updated_at timestamptz not null default clock_timestamp(),deleted boolean not null default false,
 check((image_status='missing' and image_url is null and image_hd is null) or (image_status in ('candidate','verified') and scope='printing' and language<>'und' and image_url is not null and image_source_url is not null and image_url like 'https://%' and image_source_url like 'https://%'))
);
create index catalog_inventory_card on public.catalog_printing_inventory(card_id);
create index catalog_inventory_canonical on public.catalog_printing_inventory(canonical_sigla,canonical_numero,canonical_variante);
create index catalog_inventory_changes on public.catalog_printing_inventory(updated_at,record_key);
create index catalog_inventory_missing_photo on public.catalog_printing_inventory(language,record_key) where not deleted and scope='printing' and image_status='missing';
create table public.catalog_inventory_dirty(
 entry_key text primary key references public.catalog_search_entries(entry_key) on delete cascade,
 requested_at timestamptz not null default clock_timestamp()
);
create index catalog_inventory_due on public.catalog_inventory_dirty(requested_at,entry_key);
create table public.catalog_inventory_state(id text primary key check(id='inventory'),seed_key text not null default '',seed_complete boolean not null default false);
insert into public.catalog_inventory_state(id) values('inventory');
alter table public.catalog_printing_inventory enable row level security;
alter table public.catalog_inventory_dirty enable row level security;
alter table public.catalog_inventory_state enable row level security;
revoke all on public.catalog_printing_inventory,public.catalog_inventory_dirty,public.catalog_inventory_state from public,anon,authenticated;
grant select on public.catalog_printing_inventory to anon,authenticated;
grant all on public.catalog_printing_inventory,public.catalog_inventory_dirty,public.catalog_inventory_state to service_role;
create policy inventory_read on public.catalog_printing_inventory for select to anon,authenticated using(true);
create policy inventory_worker on public.catalog_printing_inventory for all to service_role using(true) with check(true);
create policy inventory_dirty_worker on public.catalog_inventory_dirty for all to service_role using(true) with check(true);
create policy inventory_state_worker on public.catalog_inventory_state for all to service_role using(true) with check(true);
create function public.catalog_inventory_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Usare deleted=true: gli identificativi esportati non si cancellano';end if;
 if tg_op='UPDATE' then
  if new.record_key<>old.record_key then raise exception 'Identificativo inventario immutabile';end if;
  if not new.deleted and old.image_status='verified' and new.image_status<>'verified' and new.language=old.language and new.scope='printing' then
   new.image_url:=old.image_url;new.image_hd:=old.image_hd;new.image_source_url:=old.image_source_url;new.image_status:=old.image_status;new.image_evidence:=old.image_evidence;
  end if;
  if (to_jsonb(new)-'updated_at')=(to_jsonb(old)-'updated_at') then return null;end if;
  new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
 else new.updated_at:=clock_timestamp();end if;
 return new;
end $$;
create trigger catalog_inventory_guard before insert or update or delete on public.catalog_printing_inventory for each row execute function public.catalog_inventory_guard();
-- Unprivileged trigger: sources may queue only when their existing writer has access.
create function public.catalog_inventory_entry_dirty() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then
  update public.catalog_printing_inventory set deleted=true,image_status='missing',image_url=null,image_hd=null,image_source_url=null,reference_image_url=null,reference_source_url=null where record_key=old.entry_key;
  return old;
 end if;
 if new.verification='catalog' then
  delete from public.catalog_inventory_dirty where entry_key=new.entry_key;
  update public.catalog_printing_inventory set deleted=true,image_status='missing',image_url=null,image_hd=null,image_source_url=null,reference_image_url=null,reference_source_url=null where record_key=new.entry_key;
 else
  insert into public.catalog_inventory_dirty(entry_key) values(new.entry_key)
  on conflict(entry_key) do update set requested_at=greatest(clock_timestamp(),public.catalog_inventory_dirty.requested_at+interval '1 microsecond');
 end if;
 return new;
end $$;
create trigger catalog_inventory_entry_dirty after insert or update or delete on public.catalog_search_entries for each row execute function public.catalog_inventory_entry_dirty();
create schema if not exists catalog_internal;
revoke all on schema catalog_internal from public,anon,authenticated;
create function catalog_internal.inventory_card_dirty() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.catalog_inventory_dirty(entry_key) select e.entry_key from public.catalog_search_entries e where e.card_id=new.id and e.verification<>'catalog'
 on conflict(entry_key) do update set requested_at=greatest(clock_timestamp(),public.catalog_inventory_dirty.requested_at+interval '1 microsecond');
 return new;
end $$;
create trigger catalog_inventory_card_dirty after update of image_url,image_status,source_language on public.cards for each row when ((old.image_url,old.image_status,old.source_language) is distinct from (new.image_url,new.image_status,new.source_language)) execute function catalog_internal.inventory_card_dirty();
create function public.catalog_inventory_link_dirty() returns trigger language plpgsql security invoker set search_path='' as $$
declare k text:=case when tg_op='DELETE' then old.entry_key else new.entry_key end;
begin
 insert into public.catalog_inventory_dirty(entry_key) select k where exists(select 1 from public.catalog_search_entries where entry_key=k and verification<>'catalog')
 on conflict(entry_key) do update set requested_at=greatest(clock_timestamp(),public.catalog_inventory_dirty.requested_at+interval '1 microsecond');
 return null;
end $$;
create trigger catalog_inventory_link_dirty after insert or update or delete on public.catalog_export_links for each row execute function public.catalog_inventory_link_dirty();
create trigger catalog_inventory_pending_dirty after insert or update or delete on public.catalog_export_pending for each row execute function public.catalog_inventory_link_dirty();
create function public.catalog_inventory_seed(batch_size integer default 500) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.catalog_inventory_state;last_key text;n integer;cap integer:=least(greatest(coalesce(batch_size,500),1),1000);
begin
 select * into s from public.catalog_inventory_state where id='inventory' for update;
 if s.seed_complete then return jsonb_build_object('complete',true,'seeded',0);end if;
 with candidates as materialized(select entry_key from public.catalog_search_entries where verification<>'catalog' and entry_key>s.seed_key order by entry_key limit cap),
 added as(insert into public.catalog_inventory_dirty(entry_key) select entry_key from candidates on conflict do nothing returning entry_key)
 select max(entry_key),count(*) into last_key,n from candidates;
 update public.catalog_inventory_state set seed_key=coalesce(last_key,seed_key),seed_complete=n<cap where id='inventory';
 return jsonb_build_object('complete',n<cap,'seeded',n);
end $$;
create function public.catalog_inventory_queue(batch_size integer default 100) returns table(entry jsonb,card jsonb,link jsonb,requested_at text) language sql stable security invoker set search_path='' as $$
 select to_jsonb(e)-'search_vector'-'search_text',jsonb_build_object('id',c.id,'nome',c.nome,'source_language',c.source_language,'image_url',c.image_url,'image_status',c.image_status),
 case when l.entry_key is not null then jsonb_build_object('sigla',l.sigla,'numero',l.numero,'variante',l.variante,'pending_reason',p.reason) end,d.requested_at::text
 from (select * from public.catalog_inventory_dirty order by requested_at,entry_key limit least(greatest(coalesce(batch_size,100),1),200)) d
 join public.catalog_search_entries e using(entry_key) join public.cards c on c.id=e.card_id left join public.catalog_export_links l using(entry_key) left join public.catalog_export_pending p using(entry_key)
$$;
create function public.catalog_inventory_ack(items jsonb) returns void language sql security invoker set search_path='' as $$
 delete from public.catalog_inventory_dirty d using jsonb_to_recordset(items) as x(entry_key text,requested_at timestamptz) where d.entry_key=x.entry_key and d.requested_at=x.requested_at
$$;
revoke all on function public.catalog_inventory_guard(),public.catalog_inventory_entry_dirty(),catalog_internal.inventory_card_dirty(),public.catalog_inventory_link_dirty(),public.catalog_inventory_seed(integer),public.catalog_inventory_queue(integer),public.catalog_inventory_ack(jsonb) from public,anon,authenticated;
grant execute on function public.catalog_inventory_guard(),public.catalog_inventory_entry_dirty(),catalog_internal.inventory_card_dirty(),public.catalog_inventory_link_dirty(),public.catalog_inventory_seed(integer),public.catalog_inventory_queue(integer),public.catalog_inventory_ack(jsonb) to service_role;

-- Read-only source-evidence feed. A record is not a new canonical Bindex identity.
create function public.bindex_printing_page(after_time timestamptz default '1970-01-01',after_key text default '',until_time timestamptz default null,page_size integer default 200) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare cap integer:=least(greatest(coalesce(page_size,200),1),500);cutoff timestamptz:=least(coalesce(until_time,statement_timestamp()-interval '1 minute'),statement_timestamp()-interval '1 minute');result jsonb;
begin
 if after_time is null or after_key is null then raise exception 'Cursore inventario mancante';end if;
 with page as materialized(
  select * from public.catalog_printing_inventory where (updated_at,record_key)>(after_time,after_key) and updated_at<=cutoff order by updated_at,record_key limit cap
 ) select jsonb_build_object('contract','bindex-printings-v1','record_type','source_evidence','until',cutoff,
 'items',coalesce((select jsonb_agg((to_jsonb(p)-'canonical_sigla'-'canonical_numero'-'canonical_variante'-'source_entry_key')||jsonb_build_object(
  'canonical_key',case when canonical_sigla is not null then jsonb_build_object('sigla',canonical_sigla,'numero',canonical_numero,'variante',canonical_variante) end,
  'canonical_mapping_status',canonical_mapping_status)
  order by updated_at,record_key) from page p),'[]'::jsonb),
 'next_cursor',(select jsonb_build_object('time',updated_at,'key',record_key) from page order by updated_at desc,record_key desc limit 1),
 'complete',(select count(*)<cap from page)) into result;
 return result;
end $$;
revoke all on function public.bindex_printing_page(timestamptz,text,timestamptz,integer) from public;
grant execute on function public.bindex_printing_page(timestamptz,text,timestamptz,integer) to anon,authenticated,service_role;

-- Accept every documented project language, never the INT grouping.
create or replace function public.bindex_publish_photo(set_code text,card_number integer,printing text,image_language text,image text,image_hd text,image_source text,image_verified boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
declare previous_url text; accepted_url text; accepted_hd text; accepted_verified boolean;
begin
 if image_language not in ('IT','EN','FR','DE','ES','PT','JP','KOR','CHN','CHN-T','TH','ID','NL','PL','RU','ES-LA') or image_language is null then raise exception 'Lingua della foto non documentata';end if;
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

