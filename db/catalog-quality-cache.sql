-- Explicitly public catalogue statistics, refreshed by the worker, not by each viewer.
create table public.catalog_quality_cache(
 scope text primary key check(scope='catalog'),report jsonb not null,updated_at timestamptz not null default clock_timestamp()
);
alter table public.catalog_quality_cache enable row level security;
revoke all on public.catalog_quality_cache from public,anon,authenticated;
grant select on public.catalog_quality_cache to anon,authenticated;
grant all on public.catalog_quality_cache to service_role;
create policy quality_cache_read on public.catalog_quality_cache for select to anon,authenticated using(true);
create policy quality_cache_worker on public.catalog_quality_cache for all to service_role using(true) with check(true);
create function public.catalog_refresh_quality_cache() returns void language sql security invoker set search_path='' as $$
 insert into public.catalog_quality_cache(scope,report) values('catalog',public.catalog_quality_report())
 on conflict(scope) do update set report=excluded.report,updated_at=clock_timestamp()
$$;
revoke all on function public.catalog_refresh_quality_cache() from public,anon,authenticated;
grant execute on function public.catalog_refresh_quality_cache() to service_role;
-- Signal only once when a fresh saved report is published.
create trigger catalog_quality_cache_live after insert or update on public.catalog_quality_cache for each statement execute function catalog_internal.signal_catalog_change();
