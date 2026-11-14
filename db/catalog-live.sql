-- A tiny invalidation signal; no card payloads are replicated to dashboards.
create table public.catalog_live_updates(
 scope text primary key check(scope='catalog'),revision bigint not null default 0,updated_at timestamptz not null default now()
);
insert into public.catalog_live_updates(scope) values('catalog');
alter table public.catalog_live_updates enable row level security;
revoke all on public.catalog_live_updates from public,anon,authenticated;
grant select on public.catalog_live_updates to anon,authenticated;
grant all on public.catalog_live_updates to service_role;
create policy catalog_live_read on public.catalog_live_updates for select to anon,authenticated using(true);

create schema if not exists catalog_internal;
revoke all on schema catalog_internal from public,anon,authenticated;
-- Privilege is restricted to a trigger in a private schema: anonymous legacy
-- card edits can emit a signal without obtaining direct write access to it.
create function catalog_internal.signal_catalog_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.catalog_live_updates set revision=revision+1,updated_at=clock_timestamp() where scope='catalog';
 return null;
end $$;
revoke all on function catalog_internal.signal_catalog_change() from public,anon,authenticated;
create trigger catalog_live_cards after insert or update or delete on public.cards for each statement execute function catalog_internal.signal_catalog_change();
create trigger catalog_live_entries after insert or update or delete on public.catalog_search_entries for each statement execute function catalog_internal.signal_catalog_change();
create trigger catalog_live_published after insert or update or delete on public.set_carte for each statement execute function catalog_internal.signal_catalog_change();
create trigger catalog_live_images after insert or update or delete on public.set_carte_immagini for each statement execute function catalog_internal.signal_catalog_change();

-- Publication configuration, verified separately on the hosted database.
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='catalog_live_updates') then
  alter publication supabase_realtime add table public.catalog_live_updates;
 end if;
end $$;
