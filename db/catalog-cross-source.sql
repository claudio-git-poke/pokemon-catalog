-- Cross-provider diagnostics do not assign or change canonical card identities.
create table public.catalog_source_comparisons(
 pair_key text primary key,
 primary_uid text not null references public.catalog_sync_sets(source_uid),
 secondary_uid text not null references public.catalog_sync_sets(source_uid),
 status text not null check(status in ('concordant','differences','uncomparable','error')),
 checked_at timestamptz not null,next_check_at timestamptz not null,last_success_at timestamptz,
 result jsonb not null default '{}' check(jsonb_typeof(result)='object'),last_error text,
 unique(primary_uid,secondary_uid)
);
create index catalog_comparison_secondary on public.catalog_source_comparisons(secondary_uid);
alter table public.catalog_source_comparisons enable row level security;
revoke all on public.catalog_source_comparisons from public,anon,authenticated;
grant select on public.catalog_source_comparisons to anon,authenticated;
grant all on public.catalog_source_comparisons to service_role;
create policy source_comparisons_read on public.catalog_source_comparisons for select to anon,authenticated using(true);
create policy source_comparisons_worker on public.catalog_source_comparisons for all to service_role using(true) with check(true);
create view public.catalog_cross_source_register with(security_invoker=true) as
select a.source_uid||'|'||b.source_uid pair_key,a.source_uid primary_uid,b.source_uid secondary_uid,
 a.source_language,coalesce(l.label,a.source_language) language_label,a.set_id primary_set,b.set_id secondary_set,a.name,
 coalesce(c.status,'pending') status,c.checked_at,c.next_check_at,c.last_success_at,coalesce(c.result,'{}'::jsonb) result,c.last_error,
 b.last_sync_at secondary_checked_at,b.card_count secondary_expected_count,b.last_error secondary_error,
 'https://api.tcgdex.net/v2/'||a.source_language||'/sets/'||a.set_id primary_url,
 'https://github.com/type-null/PTCG-database' secondary_url,
 'same_language_and_set_code'::text match_basis,'unestablished'::text independence_status,'unverified'::text variants_status
from public.catalog_sync_sets a join public.catalog_sync_sets b on b.provider='atlas' and a.source_language=b.source_language and lower(a.set_id)=lower(b.set_id)
left join public.catalog_language_sources l on l.source_language=a.source_language
left join public.catalog_source_comparisons c on (c.primary_uid,c.secondary_uid)=(a.source_uid,b.source_uid)
where a.provider='tcgdex' and a.set_id<>'__index__' and a.coverage_scope<>'digital' and b.coverage_scope<>'digital';
revoke all on public.catalog_cross_source_register from public,anon,authenticated;
grant select on public.catalog_cross_source_register to anon,authenticated,service_role;
create function public.catalog_cross_source_due(batch_size integer default 1) returns setof public.catalog_cross_source_register
language sql stable security invoker set search_path='' as $$
 select * from public.catalog_cross_source_register where (next_check_at is null or next_check_at<=now()) and secondary_checked_at is not null
 order by next_check_at nulls first,pair_key limit least(greatest(batch_size,1),3)
$$;
revoke all on function public.catalog_cross_source_due(integer) from public,anon,authenticated;
grant execute on function public.catalog_cross_source_due(integer) to service_role;
create function public.catalog_cross_source_report(wanted_status text default null,page_offset integer default 0) returns jsonb
language sql stable security invoker set search_path='' as $$
 with candidates as materialized(select * from public.catalog_cross_source_register),filtered as materialized(select * from candidates where wanted_status is null or status=wanted_status)
 select jsonb_build_object('stats',coalesce((select jsonb_object_agg(status,n) from(select status,count(*) n from candidates group by status)x),'{}'::jsonb),
 'total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from filtered order by case status when 'differences' then 0 when 'uncomparable' then 1 when 'error' then 2 when 'concordant' then 3 else 4 end,pair_key limit 20 offset greatest(page_offset,0))x),'[]'::jsonb))
$$;
revoke all on function public.catalog_cross_source_report(text,integer) from public;
grant execute on function public.catalog_cross_source_report(text,integer) to anon,authenticated,service_role;
