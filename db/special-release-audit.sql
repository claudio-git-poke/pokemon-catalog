create table if not exists public.catalog_special_release_audit(
 id text primary key check(id='latest'),report jsonb not null,updated_at timestamptz not null default now()
);
alter table public.catalog_special_release_audit enable row level security;
revoke all on public.catalog_special_release_audit from public,anon,authenticated;
grant select on public.catalog_special_release_audit to anon,authenticated;
grant all on public.catalog_special_release_audit to service_role;
drop policy if exists special_release_read on public.catalog_special_release_audit;
create policy special_release_read on public.catalog_special_release_audit for select to anon,authenticated using(true);
drop policy if exists special_release_worker on public.catalog_special_release_audit;
create policy special_release_worker on public.catalog_special_release_audit for all to service_role using(true) with check(true);
