create view public.catalog_coverage_audit_rows with(security_invoker=true) as
with snapshot as(select report from public.catalog_coverage_snapshots where scope='latest'),observed as(
 select x.* from snapshot s cross join lateral jsonb_to_recordset(s.report->'groups') as x(
 source_provider text,origin_language text,origin_set text,cards bigint,reference_missing bigint,placeholder bigint,source_printings bigint,
 inventory_entries bigint,printing_entries bigint,unidentified_entries bigint,pending_identity bigint,missing_exact bigint,candidate_exact bigint,verified_exact bigint,unknown_language bigint)
), metadata as(
 select distinct on(s.provider,s.source_language,lower(s.set_id)) s.source_uid,s.provider,s.source_language,lower(s.set_id) source_set,s.name,s.coverage_scope,
 s.reported_count,s.manifest_count,s.resolved_count,s.coverage_checked_at,s.coverage_detail,r.status,r.reason,r.source_url,
 case when jsonb_typeof(s.coverage_detail->'missing_count')='number' then(s.coverage_detail->>'missing_count')::bigint
 when s.manifest_digest is not null and s.manifest_digest=s.resolved_digest then 0 end missing_count,
 case when jsonb_typeof(s.coverage_detail->'unexpected_count')='number' then(s.coverage_detail->>'unexpected_count')::bigint
 when s.manifest_digest is not null and s.manifest_digest=s.resolved_digest then 0 end unexpected_count
 from public.catalog_sync_sets s join public.catalog_coverage_register r on r.target_key=s.source_uid and r.target_type='set'
 where s.set_id<>'__index__' order by s.provider,s.source_language,lower(s.set_id),s.coverage_checked_at desc nulls last,s.source_uid
)
select coalesce(m.source_uid,jsonb_build_array(o.source_provider,o.origin_language,o.origin_set)::text) target_key,
 coalesce(m.provider,o.source_provider) provider,coalesce(m.source_language,o.origin_language) source_language,coalesce(l.label,'Lingua non determinata') language_label,
 coalesce(m.source_set,o.origin_set) source_set,coalesce(m.name,o.origin_set) name,coalesce(m.status,'unregistered') status,
 coalesce(m.reason,'Voci importate: manca un elenco di riferimento abbinato con certezza.') reason,m.source_url,
 m.reported_count,m.manifest_count,m.resolved_count,m.coverage_checked_at checked_at,m.missing_count,m.unexpected_count,m.coverage_detail,
 case when exists(select 1 from snapshot) then coalesce(o.cards,0) end cards,
 case when exists(select 1 from snapshot) then coalesce(o.reference_missing,0) end reference_missing,
 case when exists(select 1 from snapshot) then coalesce(o.placeholder,0) end placeholder,
 case when exists(select 1 from snapshot) then coalesce(o.source_printings,0) end source_printings,
 case when exists(select 1 from snapshot) then coalesce(o.inventory_entries,0) end inventory_entries,
 case when exists(select 1 from snapshot) then coalesce(o.printing_entries,0) end printing_entries,
 case when exists(select 1 from snapshot) then coalesce(o.unidentified_entries,0) end unidentified_entries,
 case when exists(select 1 from snapshot) then coalesce(o.pending_identity,0) end pending_identity,
 case when exists(select 1 from snapshot) then coalesce(o.missing_exact,0) end missing_exact,
 case when exists(select 1 from snapshot) then coalesce(o.candidate_exact,0) end candidate_exact,
 case when exists(select 1 from snapshot) then coalesce(o.verified_exact,0) end verified_exact,
 case when exists(select 1 from snapshot) then coalesce(o.unknown_language,0) end unknown_language
from metadata m full join observed o on(o.source_provider,o.origin_language,o.origin_set)=(m.provider,m.source_language,m.source_set)
left join public.catalog_language_sources l on l.source_language=coalesce(m.source_language,o.origin_language)
where coalesce(m.coverage_scope,'unclassified')<>'digital';
revoke all on public.catalog_coverage_audit_rows from public,anon,authenticated;
grant select on public.catalog_coverage_audit_rows to anon,authenticated,service_role;

create function public.catalog_coverage_audit_report(wanted_issue text default null,wanted_language text default null,wanted_provider text default null,query_text text default '',page_offset integer default 0,page_size integer default 25)
returns jsonb language sql stable security invoker set search_path='' set statement_timeout='8s' set work_mem='8MB' as $$
 with all_rows as materialized(select * from public.catalog_coverage_audit_rows),filtered as materialized(
 select * from all_rows where(wanted_language is null or source_language=wanted_language)and(wanted_provider is null or provider=wanted_provider)
 and(coalesce(query_text,'')='' or name ilike '%'||query_text||'%' or source_set ilike '%'||query_text||'%')
 and(wanted_issue is null or wanted_issue='cards' and(missing_count>0 or unexpected_count>0)
 or wanted_issue='unchecked' and missing_count is null or wanted_issue='identity' and(pending_identity>0 or unidentified_entries>0)
 or wanted_issue='photos' and missing_exact>0)
 )select jsonb_build_object('generated_at',clock_timestamp(),
 'snapshot',(select(report-'groups') from public.catalog_coverage_snapshots where scope='latest'),
 'stats',jsonb_build_object('lists',(select count(*) from all_rows),'unmeasured',(select count(*) from all_rows where missing_count is null),
 'known_missing_ids',(select coalesce(sum(missing_count),0) from all_rows),'identity_lists',(select count(*) from all_rows where pending_identity>0 or unidentified_entries>0),
 'photo_lists',(select count(*) from all_rows where missing_exact>0)),
 'total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from filtered
 order by case when missing_count>0 or unexpected_count>0 then 0 when pending_identity>0 then 1 when missing_exact>0 then 2 when missing_count is null then 3 else 4 end,
 source_language,provider,source_set,target_key limit least(greatest(page_size,1),100) offset greatest(page_offset,0))x),'[]'::jsonb),
 'languages',(select jsonb_agg(jsonb_build_object('source_language',source_language,'label',label) order by label) from public.catalog_language_sources),
 'providers',coalesce((select jsonb_agg(provider order by provider) from(select distinct provider from all_rows)x),'[]'::jsonb))
$$;
revoke all on function public.catalog_coverage_audit_report(text,text,text,text,integer,integer) from public;
grant execute on function public.catalog_coverage_audit_report(text,text,text,text,integer,integer) to anon,authenticated,service_role;
