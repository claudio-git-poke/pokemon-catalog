-- Stable publication contract. Raw cards remain a source/staging catalogue.
create table public.set_espansioni(
 sigla text primary key,tcgdex_id text,nome text not null,carte_base integer,carte_totali integer,data_uscita date,lingua text not null,
 aggiornato_il timestamptz not null default clock_timestamp()
);
create index bindex_set_tcgdex on public.set_espansioni(lower(tcgdex_id)) where tcgdex_id is not null;
create table public.set_carte(
 sigla text not null references public.set_espansioni(sigla),numero integer not null check(numero>0),variante text not null check(variante~'^[a-z0-9]+(-[a-z0-9]+)*$'),
 nome text,rarita text,codice text check(codice is null or codice~'^[A-Z0-9][A-Z0-9.-]*( [A-Z0-9]+)?$'),cardmarket_id bigint,
 cardmarket_url text check(cardmarket_url is null or cardmarket_url~'^https://www[.]cardmarket[.]com/it/Pokemon/Products/[^?]+$'),
 immagine text,immagine_hd text,tag text[] not null default '{}',immagine_verificata boolean not null default false,
 aggiornato_il timestamptz not null default clock_timestamp(),eliminata boolean not null default false,
 primary key(sigla,numero,variante)
);
create index bindex_card_market_id on public.set_carte(cardmarket_id) where cardmarket_id is not null;
create index bindex_card_market_url on public.set_carte(cardmarket_url) where cardmarket_url is not null;
create index bindex_card_changes on public.set_carte(aggiornato_il,sigla,numero,variante);
create index bindex_card_tags on public.set_carte using gin(tag);
create table public.set_carte_immagini(
 sigla text not null,numero integer not null,variante text not null,lingua text not null,immagine text,immagine_hd text,fonte text not null,verificata boolean not null default false,
 aggiornato_il timestamptz not null default clock_timestamp(),primary key(sigla,numero,variante,lingua),foreign key(sigla,numero,variante) references public.set_carte(sigla,numero,variante)
);
create index bindex_photo_changes on public.set_carte_immagini(aggiornato_il,sigla,numero,variante,lingua);
create table public.catalog_export_links(
 entry_key text primary key references public.catalog_search_entries(entry_key) on delete cascade,sigla text not null,numero integer not null,variante text not null,
 method text not null,evidence jsonb not null default '{}',linked_at timestamptz not null default clock_timestamp(),foreign key(sigla,numero,variante) references public.set_carte(sigla,numero,variante)
);
create table public.catalog_export_pending(
 entry_key text primary key references public.catalog_search_entries(entry_key) on delete cascade,reason text not null,detail jsonb not null default '{}',
 next_attempt_at timestamptz not null default now()+interval '1 day',updated_at timestamptz not null default now()
);
create table public.catalog_export_state(
 id text primary key default 'bindex',ready boolean not null default false,reference_cards integer not null,reference_sets integer not null,
 bootstrapped_at timestamptz,cursor_time timestamptz,cursor_key text,refreshed_at timestamptz,statistics jsonb not null default '{}'
);
insert into public.catalog_export_state(id,reference_cards,reference_sets) values('bindex',47373,294);
create function public.bindex_stable_row() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Le identità pubblicate non si cancellano: usare eliminata=true per le carte o svuotare il contenuto della foto.';end if;
 if tg_op='UPDATE' then
  if new.sigla<>old.sigla then raise exception 'Chiave Bindex immutabile';end if;
  if tg_table_name<>'set_espansioni' then
   if new.numero<>old.numero or new.variante<>old.variante then raise exception 'Chiave Bindex immutabile';end if;
  end if;
  if tg_table_name='set_carte_immagini' then
   if new.lingua<>old.lingua then raise exception 'Lingua della foto immutabile';end if;
  end if;
  if (to_jsonb(new)-'aggiornato_il')=(to_jsonb(old)-'aggiornato_il') then return null;end if;
  new.aggiornato_il:=greatest(clock_timestamp(),old.aggiornato_il+interval '1 microsecond');
 else new.aggiornato_il:=clock_timestamp();end if;
 return new;
end $$;
create trigger bindex_stable_set before insert or update or delete on public.set_espansioni for each row execute function public.bindex_stable_row();
create trigger bindex_stable_card before insert or update or delete on public.set_carte for each row execute function public.bindex_stable_row();
create trigger bindex_stable_photo before insert or update or delete on public.set_carte_immagini for each row execute function public.bindex_stable_row();
-- Consumer tables: read-only, including tombstones. Internal evidence/queues: worker only.
alter table public.set_espansioni enable row level security;
alter table public.set_carte enable row level security;
alter table public.set_carte_immagini enable row level security;
alter table public.catalog_export_state enable row level security;
alter table public.catalog_export_links enable row level security;
alter table public.catalog_export_pending enable row level security;
revoke all on public.set_espansioni,public.set_carte,public.set_carte_immagini,public.catalog_export_state,public.catalog_export_links,public.catalog_export_pending from public,anon,authenticated;
grant select on public.set_espansioni,public.set_carte,public.set_carte_immagini,public.catalog_export_state to anon,authenticated;
grant all on public.set_espansioni,public.set_carte,public.set_carte_immagini,public.catalog_export_state,public.catalog_export_links,public.catalog_export_pending to service_role;
create policy bindex_sets_read on public.set_espansioni for select to anon,authenticated using(true);
create policy bindex_cards_read on public.set_carte for select to anon,authenticated using(true);
create policy bindex_photos_read on public.set_carte_immagini for select to anon,authenticated using(true);
create policy bindex_state_read on public.catalog_export_state for select to anon,authenticated using(true);
create function public.catalog_export_queue(after_time timestamptz default '1970-01-01',after_key text default '',batch_size integer default 200)
returns setof public.catalog_search_entries language sql stable security invoker set search_path='' as $$
 select e.* from public.catalog_search_entries e where e.verification<>'catalog' and
 ((e.updated_at,e.entry_key)>(coalesce(after_time,'1970-01-01'::timestamptz),coalesce(after_key,'')) or exists(select 1 from public.catalog_export_pending p where p.entry_key=e.entry_key and p.next_attempt_at<=now()))
 order by e.updated_at,e.entry_key limit least(greatest(batch_size,1),500)
$$;
revoke all on function public.catalog_export_queue(timestamptz,text,integer) from public,anon,authenticated;
grant execute on function public.catalog_export_queue(timestamptz,text,integer) to service_role;
revoke all on function public.bindex_stable_row() from public,anon,authenticated;
grant execute on function public.bindex_stable_row() to service_role;
create policy bindex_links_worker on public.catalog_export_links for all to service_role using(true) with check(true);
create policy bindex_pending_worker on public.catalog_export_pending for all to service_role using(true) with check(true);
