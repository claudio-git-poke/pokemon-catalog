-- A separate queue: importing a set and checking its manifest are different jobs.
alter table public.catalog_sync_sets
 add column manifest_next_check_at timestamptz not null default now(),
 add column manifest_last_attempt_at timestamptz,
 add column manifest_last_error text;
create index catalog_manifest_due on public.catalog_sync_sets(provider,manifest_next_check_at,source_uid) where set_id<>'__index__' and coverage_scope<>'digital';

-- Optimistic guard: a running importer may have published a newer manifest.
-- Never change card records, source classifications, import dates, retries or errors.
create function public.catalog_save_manifest_audit(wanted_uid text,expected_set_id text,previous_check timestamptz,new_manifest jsonb)
returns boolean language plpgsql security invoker set search_path='' set statement_timeout='8s' as $$
declare changed integer;
begin
 if jsonb_typeof(new_manifest) is distinct from 'object' or new_manifest->'coverage_detail'->>'comparison_scope' is distinct from 'expected_source_links'
  or coalesce((new_manifest->>'manifest_count')::int,0)<1 or (new_manifest->>'manifest_count')::int>5000
  or new_manifest->>'resolved_count' is null or (new_manifest->>'resolved_count')::int<0 or (new_manifest->>'resolved_count')::int>(new_manifest->>'manifest_count')::int
  or new_manifest->'coverage_detail'->>'missing_count' is null or (new_manifest->'coverage_detail'->>'missing_count')::int<0
  or nullif(new_manifest->>'manifest_digest','') is null or nullif(new_manifest->>'resolved_digest','') is null
  or nullif(new_manifest->>'coverage_checked_at','') is null then raise exception 'Confronto degli identificativi non valido';end if;
 update public.catalog_sync_sets set
  manifest_count=(new_manifest->>'manifest_count')::int,resolved_count=(new_manifest->>'resolved_count')::int,
  manifest_digest=new_manifest->>'manifest_digest',resolved_digest=new_manifest->>'resolved_digest',coverage_scope='physical',
  coverage_checked_at=(new_manifest->>'coverage_checked_at')::timestamptz,coverage_detail=new_manifest->'coverage_detail',
  manifest_last_attempt_at=clock_timestamp(),manifest_last_error=null,
  manifest_next_check_at=clock_timestamp()+case when (new_manifest->'coverage_detail'->>'missing_count')::int>0 then interval '1 day' else interval '7 days' end
 where source_uid=wanted_uid and set_id=expected_set_id and coverage_checked_at is not distinct from previous_check and coverage_scope<>'digital';
 get diagnostics changed=row_count;return changed=1;
end $$;
revoke all on function public.catalog_save_manifest_audit(text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.catalog_save_manifest_audit(text,text,timestamptz,jsonb) to service_role;
