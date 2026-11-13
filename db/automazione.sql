-- Eseguire una sola volta nel SQL Editor del progetto Bindex, prima del worker.
-- Compatibile con la tabella public.cards del progetto caricato. Non elimina righe.
begin;
alter table public.cards
  add column if not exists source_uid text,
  add column if not exists source_local_id text,
  add column if not exists source_card_id text,
  add column if not exists source_language text,
  add column if not exists image_attempts integer not null default 0,
  add column if not exists image_next_attempt_at timestamptz not null default now(),
  add column if not exists image_last_error text;
create unique index if not exists cards_source_uid_unique on public.cards(source_uid);
create index if not exists cards_image_queue_idx on public.cards(image_next_attempt_at,id)
  where image_status in ('missing','placeholder');
create table if not exists public.catalog_sync_sets (
  source_uid text primary key, source_language text not null,
  set_id text not null, name text not null, provider text not null default 'tcgdex', next_sync_at timestamptz not null default now(),
  last_sync_at timestamptz, last_error text, card_count integer not null default 0, reported_count integer
);
alter table public.catalog_sync_sets add column if not exists reported_count integer;
alter table public.catalog_sync_sets add column if not exists provider text not null default 'tcgdex';
create index if not exists catalog_sync_sets_due_idx on public.catalog_sync_sets(next_sync_at);
create table if not exists public.catalog_sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null default 'running', summary jsonb not null default '{}'::jsonb
);
create table if not exists public.catalog_external_cards (
  source_uid text primary key, provider text not null, language text not null,
  set_code text not null, local_id text not null, name text not null,
  image_url text, page_url text, updated_at timestamptz not null default now()
);
create index if not exists catalog_external_match_idx on public.catalog_external_cards(language,set_code,local_id);
alter table public.catalog_external_cards enable row level security;
revoke all on public.catalog_external_cards from anon, authenticated;
grant select on public.catalog_external_cards to anon, authenticated;
grant all on public.catalog_external_cards to service_role;
drop policy if exists catalog_external_read on public.catalog_external_cards;
create policy catalog_external_read on public.catalog_external_cards for select to anon, authenticated using(true);
-- Allinea la sequenza dopo precedenti importazioni CSV con ID espliciti.
do $$
declare seq text; next_id bigint;
begin
  seq := pg_get_serial_sequence('public.cards','id');
  if seq is not null then
    select coalesce(max(id),0) + 1 into next_id from public.cards;
    perform setval(seq::regclass,next_id,false);
  end if;
end $$;
-- Le tabelle contengono solo lo stato operativo, senza segreti.
alter table public.catalog_sync_sets enable row level security;
alter table public.catalog_sync_runs enable row level security;
revoke all on public.catalog_sync_sets, public.catalog_sync_runs from anon, authenticated;
grant select on public.catalog_sync_sets, public.catalog_sync_runs to anon, authenticated;
grant all on public.catalog_sync_sets, public.catalog_sync_runs to service_role;
grant usage, select on sequence public.catalog_sync_runs_id_seq to service_role;
drop policy if exists catalog_sync_sets_read on public.catalog_sync_sets;
create policy catalog_sync_sets_read on public.catalog_sync_sets for select to anon, authenticated using(true);
drop policy if exists catalog_sync_runs_read on public.catalog_sync_runs;
create policy catalog_sync_runs_read on public.catalog_sync_runs for select to anon, authenticated using(true);
-- Permessi e policy esistenti di cards invariati. Worker = service_role.
commit;
