-- Aggregate to small groups before materializing. Never spool the full card catalogue for live counters.
-- Per-function 16MB work_mem avoids hash spills without raising the global connection memory budget.
create or replace function public.catalog_quality_report() returns jsonb
language sql stable security invoker set search_path='' set statement_timeout='20s' set work_mem='16MB' set jit=off set enable_sort=off set enable_mergejoin=off as $$
with card_rows as materialized (
 select id,sigla,lingua,
  case when source_uid like 'tcgdex:%' then 'tcgdex' when source_uid like 'atlas:%' then 'atlas' else 'legacy' end provider,
  image_status='placeholder' placeholder,nullif(trim(image_url),'') is null missing_image,
  traits_checked_at is not null checked,
  source_uid is null or source_card_id is null or (source_uid not like 'tcgdex:%' and source_uid not like 'atlas:%') unsupported,
  traits_last_error is not null retry
 from public.cards
), entries as materialized (
 select e.card_id,
  bool_or(cardinality(e.tags)>0) tagged,
  count(*) printings
 from public.catalog_search_entries e where e.verification<>'catalog' group by e.card_id
), coverage as not materialized (
 select c.id,c.sigla,c.lingua,c.provider,coalesce(e.tagged,false) tagged,coalesce(e.printings,0) printings,
  c.placeholder,c.missing_image,
  case when e.tagged then 'indexed' when c.checked then 'insufficient' when c.unsupported then 'unsupported'
   when c.retry then 'retry' else 'pending' end metadata_state
 from card_rows c left join entries e on e.card_id=c.id
), groups as materialized (
 select provider,sigla,lingua,count(*) total,count(*) filter(where tagged) tagged,
  count(*) filter(where missing_image) missing_image,count(*) filter(where placeholder) placeholder,
  count(*) filter(where metadata_state='pending') pending,count(*) filter(where metadata_state='retry') retry,
  count(*) filter(where metadata_state='insufficient') insufficient,count(*) filter(where metadata_state='unsupported') unsupported,
  sum(printings) printings
 from coverage group by provider,sigla,lingua
), warnings as materialized (
 select * from (select e.entry_key,e.card_id,e.name,e.set_code,
  case when e.tags @> array['finish:normal'] and (e.tags && array['finish:holo','finish:reverse','visual:shiny'] or e.facts->>'shiny'='true') then 'finish_conflict'
   when e.entry_key like 'tcgdex:%' then case
   when nullif(e.source_payload->>'id','') is not null and c.source_card_id is not null
    and e.source_payload->>'id'<>c.source_card_id then 'source_identity_conflict'
   when nullif(e.source_payload->>'localId','') is not null and e.collector_number is not null
    and public.catalog_number(e.source_payload->>'localId')<>public.catalog_number(e.collector_number) then 'number_conflict'
   else null end
   else null end reason
 from public.catalog_search_entries e join public.cards c on c.id=e.card_id
 where e.verification<>'catalog') checked where reason is not null
), shared_images as materialized (
 select immagine,count(distinct (sigla,numero,variante)) identities
 from public.set_carte_immagini where verificata and nullif(trim(immagine),'') is not null
 group by immagine having count(distinct (sigla,numero,variante))>1
)
select jsonb_build_object(
 'generated_at',now(),
 'totals',(select jsonb_build_object('total',coalesce(sum(total),0),'tagged',coalesce(sum(tagged),0),'missing_image',coalesce(sum(missing_image),0),'placeholder',coalesce(sum(placeholder),0),'pending',coalesce(sum(pending),0),'retry',coalesce(sum(retry),0),'insufficient',coalesce(sum(insufficient),0),'unsupported',coalesce(sum(unsupported),0),'printings',coalesce(sum(printings),0)) from groups),
 'groups',coalesce((select jsonb_agg(to_jsonb(g) order by total desc,provider,sigla,lingua) from groups g),'[]'::jsonb),
 'warnings',jsonb_build_object('total',(select count(*) from warnings where reason is not null),
  'by_reason',coalesce((select jsonb_object_agg(reason,n) from(select reason,count(*) n from warnings where reason is not null group by reason)x),'{}'::jsonb),
  'samples',coalesce((select jsonb_agg(to_jsonb(x)) from(select entry_key,card_id,name,set_code,reason from warnings where reason is not null order by card_id,entry_key limit 30)x),'[]'::jsonb),
  'shared_verified_images',(select count(*) from shared_images)),
 'published',jsonb_build_object(
  'total',(select count(*) from public.set_carte where not eliminata),
  'tagged',(select count(*) from public.set_carte where not eliminata and cardinality(tag)>0),
  'without_image',(select count(*) from public.set_carte where not eliminata and nullif(trim(immagine),'') is null),
  'verified_images',(select count(*) from public.set_carte where not eliminata and immagine_verificata and nullif(trim(immagine),'') is not null))
)
$$;
revoke all on function public.catalog_quality_report() from public;
grant execute on function public.catalog_quality_report() to anon,authenticated,service_role;
