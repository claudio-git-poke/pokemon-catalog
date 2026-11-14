-- Read-only coverage of imported cards and exact-printing consistency warnings.
create or replace function public.catalog_quality_report() returns jsonb
language sql stable security invoker set search_path='' set statement_timeout='20s' as $$
with entries as materialized (
 select e.card_id,
  bool_or(cardinality(e.tags)>0 and e.verification<>'catalog') tagged,
  count(*) filter(where e.verification<>'catalog') printings
 from public.catalog_search_entries e group by e.card_id
), coverage as materialized (
 select c.id,c.sigla,c.lingua,
  case when c.source_uid like 'tcgdex:%' then 'tcgdex' when c.source_uid like 'atlas:%' then 'atlas' else 'legacy' end provider,
  coalesce(e.tagged,false) tagged,coalesce(e.printings,0) printings,
  c.image_status='placeholder' placeholder,
  nullif(trim(c.image_url),'') is null missing_image,
  case when e.tagged then 'indexed'
   when c.traits_checked_at is not null then 'insufficient'
   when c.source_uid is null or c.source_uid not like 'tcgdex:%' then 'unsupported'
   when c.traits_last_error is not null then 'retry'
   else 'pending' end metadata_state
 from public.cards c left join entries e on e.card_id=c.id
), groups as (
 select provider,sigla,lingua,count(*) total,count(*) filter(where tagged) tagged,
  count(*) filter(where missing_image) missing_image,count(*) filter(where placeholder) placeholder,
  count(*) filter(where metadata_state='pending') pending,count(*) filter(where metadata_state='retry') retry,
  count(*) filter(where metadata_state='insufficient') insufficient,count(*) filter(where metadata_state='unsupported') unsupported,
  sum(printings) printings
 from coverage group by provider,sigla,lingua
), warnings as materialized (
 select e.entry_key,e.card_id,e.name,e.set_code,
  case when e.tags @> array['finish:normal'] and (e.tags && array['finish:holo','finish:reverse','visual:shiny'] or e.facts->>'shiny'='true') then 'finish_conflict'
   when nullif(e.source_payload->>'id','') is not null and c.source_card_id is not null
    and e.entry_key like 'tcgdex:%' and e.source_payload->>'id'<>c.source_card_id then 'source_identity_conflict'
   when nullif(e.source_payload->>'localId','') is not null and e.collector_number is not null
    and e.entry_key like 'tcgdex:%' and public.catalog_number(e.source_payload->>'localId')<>public.catalog_number(e.collector_number) then 'number_conflict'
   else null end reason
 from public.catalog_search_entries e join public.cards c on c.id=e.card_id
 where e.verification<>'catalog'
), shared_images as materialized (
 select immagine,count(distinct (sigla,numero,variante)) identities
 from public.set_carte_immagini where verificata and nullif(trim(immagine),'') is not null
 group by immagine having count(distinct (sigla,numero,variante))>1
)
select jsonb_build_object(
 'generated_at',now(),
 'totals',(select jsonb_build_object('total',count(*),'tagged',count(*) filter(where tagged),
  'missing_image',count(*) filter(where missing_image),'placeholder',count(*) filter(where placeholder),
  'pending',count(*) filter(where metadata_state='pending'),'retry',count(*) filter(where metadata_state='retry'),
  'insufficient',count(*) filter(where metadata_state='insufficient'),'unsupported',count(*) filter(where metadata_state='unsupported'),
  'printings',coalesce(sum(printings),0)) from coverage),
 'groups',coalesce((select jsonb_agg(to_jsonb(g) order by total desc,provider,sigla,lingua) from groups g),'[]'::jsonb),
 'warnings',jsonb_build_object('total',(select count(*) from warnings where reason is not null),
  'by_reason',coalesce((select jsonb_object_agg(reason,n) from(select reason,count(*) n from warnings where reason is not null group by reason)x),'{}'::jsonb),
  'samples',coalesce((select jsonb_agg(to_jsonb(x)) from(select entry_key,card_id,name,set_code,reason from warnings where reason is not null order by card_id,entry_key limit 30)x),'[]'::jsonb),
  'shared_verified_images',(select count(*) from shared_images)),
 'published',(select jsonb_build_object('total',count(*),'tagged',count(*) filter(where cardinality(tag)>0),
  'without_image',count(*) filter(where nullif(trim(immagine),'') is null),
  'verified_images',count(*) filter(where immagine_verificata and nullif(trim(immagine),'') is not null)) from public.set_carte where not eliminata)
)
$$;
revoke all on function public.catalog_quality_report() from public;
grant execute on function public.catalog_quality_report() to anon,authenticated,service_role;
