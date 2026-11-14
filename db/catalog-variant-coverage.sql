create or replace function public.catalog_variant_coverage() returns jsonb language sql stable security invoker set search_path='' as $$
 with counts as(select tag,count(*) n from public.catalog_search_entries e cross join lateral unnest(e.tags) tag where e.verification<>'catalog' group by tag)
 select jsonb_build_object('terms',coalesce((select jsonb_agg(jsonb_build_object('code',t.code,'label',t.label,'kind',t.kind,'count',coalesce(c.n,0)) order by t.kind,t.label) from public.catalog_terms t left join counts c on c.tag=t.code),'[]'::jsonb),'indexed_printings',(select count(*) from public.catalog_search_entries where verification<>'catalog'),'pending_cards',(select count(*) from public.cards where source_card_id is not null and traits_checked_at is null))
$$;
grant execute on function public.catalog_variant_coverage() to anon,authenticated,service_role;
