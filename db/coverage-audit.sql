-- Bounded coverage scans: no full-catalog calculation from a page load or importer cycle.
set local lock_timeout='5s';
alter table public.catalog_sync_sets add column if not exists coverage_detail jsonb check(coverage_detail is null or jsonb_typeof(coverage_detail)='object');
create table public.catalog_coverage_snapshots(
 scope text primary key check(scope in ('latest','checkpoint','request')),
 report jsonb not null check(jsonb_typeof(report)='object'),updated_at timestamptz not null default clock_timestamp()
);
alter table public.catalog_coverage_snapshots enable row level security;
revoke all on public.catalog_coverage_snapshots from public,anon,authenticated;
grant select on public.catalog_coverage_snapshots to anon,authenticated;
grant all on public.catalog_coverage_snapshots to service_role;
create policy coverage_snapshot_read on public.catalog_coverage_snapshots for select to anon,authenticated using(scope='latest');
create policy coverage_snapshot_worker on public.catalog_coverage_snapshots for all to service_role using(true) with check(true);

create function public.catalog_coverage_provider(uid text) returns text language sql immutable set search_path='' as $$
 select case when uid like 'tcgdex:%' then 'tcgdex' when uid like 'atlas:%' then 'atlas'
 when uid like 'asia-official:%' then 'supplement-'||split_part(uid,':',2)
 when uid like 'pkmncards:%' then 'supplement-en' when uid like 'pokumon:%' then 'research-pokumon'
 when uid like 'limitless:%' then 'research-limitless' when uid like 'bulbapedia:%' then 'research-bulbapedia' else 'legacy' end
$$;
create function public.catalog_coverage_origin(uid text,sigla text,source_id text,local_id text) returns text language sql immutable set search_path='' as $$
 select lower(case
 when uid like 'tcgdex:%' and nullif(local_id,'') is not null and right(source_id,length(local_id)+1)='-'||local_id then left(source_id,length(source_id)-length(local_id)-1)
 when (uid like 'tcgdex:%' or uid like 'atlas:%') and source_id ~ '^.+-.+$' then regexp_replace(source_id,'-[^-]+$','')
 else coalesce(nullif(split_part(sigla,'@',1),''),'unknown') end)
$$;
create function public.catalog_coverage_scan_bounds() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('card_until',coalesce((select id from public.cards order by id desc limit 1),0),
 'inventory_until',coalesce((select record_key from public.catalog_printing_inventory order by record_key desc limit 1),''),'started_at',clock_timestamp())
$$;

create function public.catalog_coverage_card_batch(after_id bigint,until_id bigint,batch_size integer default 500) returns jsonb
language sql stable security invoker set search_path='' set statement_timeout='8s' set work_mem='8MB' set jit=off as $$
 with page as materialized(
 select id,sigla,lingua,source_uid,source_card_id,source_local_id,source_language,image_status,image_url,traits_checked_at,traits_last_error
 from public.cards where id>after_id and id<=until_id order by id limit least(greatest(coalesce(batch_size,500),1),1000)
 ), per_card as materialized(
 select c.*,public.catalog_coverage_provider(c.source_uid) source_provider,coalesce(c.source_language,'und') origin_language,
 public.catalog_coverage_origin(c.source_uid,c.sigla,c.source_card_id,c.source_local_id) origin_set,
 case when c.source_uid like 'tcgdex:%' then 'tcgdex' when c.source_uid like 'atlas:%' then 'atlas' else 'legacy' end provider,
 coalesce(e.tagged,false) tagged,e.printings,coalesce(e.warnings,'[]'::jsonb) warnings,
 c.image_status='placeholder' placeholder,nullif(trim(c.image_url),'') is null missing_image,
 case when e.tagged then 'indexed' when c.traits_checked_at is not null then 'insufficient'
 when c.source_uid is null or c.source_card_id is null or (c.source_uid not like 'tcgdex:%' and c.source_uid not like 'atlas:%') then 'unsupported'
 when c.traits_last_error is not null then 'retry' else 'pending' end metadata_state
 from page c cross join lateral(
 select bool_or(cardinality(x.tags)>0) tagged,count(*) printings,
 jsonb_agg(jsonb_build_object('entry_key',x.entry_key,'card_id',c.id,'name',x.name,'set_code',x.set_code,'reason',x.reason)) filter(where x.reason is not null) warnings
 from (select e.entry_key,e.tags,e.name,e.set_code,case
 when e.tags @> array['finish:normal'] and(e.tags && array['finish:holo','finish:reverse','visual:shiny'] or e.facts->>'shiny'='true') then 'finish_conflict'
 when e.entry_key like 'tcgdex:%' then case
 when nullif(e.source_payload->>'id','') is not null and c.source_card_id is not null and e.source_payload->>'id'<>c.source_card_id then 'source_identity_conflict'
 when nullif(e.source_payload->>'localId','') is not null and e.collector_number is not null and public.catalog_number(e.source_payload->>'localId')<>public.catalog_number(e.collector_number) then 'number_conflict' end
 end reason from public.catalog_search_entries e where e.card_id=c.id and e.verification<>'catalog')x
 )e
 ), groups as(
 select provider,source_provider,origin_language,origin_set,sigla,lingua,count(*) total,count(*) filter(where tagged) tagged,
 count(*) filter(where missing_image) missing_image,count(*) filter(where placeholder) placeholder,
 count(*) filter(where metadata_state='pending') pending,count(*) filter(where metadata_state='retry') retry,
 count(*) filter(where metadata_state='insufficient') insufficient,count(*) filter(where metadata_state='unsupported') unsupported,sum(printings) printings
 from per_card group by provider,source_provider,origin_language,origin_set,sigla,lingua
 ), warnings as materialized(select w.value item from per_card c cross join lateral jsonb_array_elements(c.warnings) w)
 select jsonb_build_object('scanned',(select count(*) from page),'next_id',coalesce((select max(id) from page),after_id),
 'has_more',(select count(*) from page)=least(greatest(coalesce(batch_size,500),1),1000),
 'groups',coalesce((select jsonb_agg(to_jsonb(g)) from groups g),'[]'::jsonb),
 'warnings',jsonb_build_object('by_reason',coalesce((select jsonb_object_agg(reason,n) from(select item->>'reason' reason,count(*) n from warnings group by item->>'reason')x),'{}'::jsonb),
 'samples',coalesce((select jsonb_agg(item) from(select item from warnings order by(item->>'card_id')::bigint,item->>'entry_key' limit 30)x),'[]'::jsonb)))
$$;

create function public.catalog_coverage_inventory_batch(after_key text,until_key text,batch_size integer default 2000) returns jsonb
language sql stable security invoker set search_path='' set statement_timeout='8s' set work_mem='8MB' set jit=off as $$
 with page as materialized(
 select record_key,card_id,scope,language,source_set_code,image_status,canonical_mapping_status,deleted from public.catalog_printing_inventory
 where record_key>after_key and record_key<=until_key order by record_key limit least(greatest(coalesce(batch_size,2000),1),2000)
 ), rows as materialized(
 select p.*,public.catalog_coverage_provider(c.source_uid) source_provider,coalesce(c.source_language,case when p.language='EN' then 'en' end,l.source_language,'und') origin_language,
 public.catalog_coverage_origin(c.source_uid,coalesce(c.sigla,p.source_set_code),c.source_card_id,c.source_local_id) origin_set
 from page p left join public.cards c on c.id=p.card_id left join public.catalog_language_sources l on l.local_code=p.language where not p.deleted
 ), groups as(
 select source_provider,origin_language,origin_set,count(*) inventory_entries,
 count(*) filter(where scope='printing') printing_entries,count(*) filter(where scope='card') unidentified_entries,
 count(*) filter(where canonical_mapping_status<>'linked') pending_identity,
 count(*) filter(where scope='printing' and image_status='missing') missing_exact,
 count(*) filter(where scope='printing' and image_status='candidate') candidate_exact,
 count(*) filter(where scope='printing' and image_status='verified') verified_exact,
 count(*) filter(where language='und') unknown_language from rows group by source_provider,origin_language,origin_set
 ), languages as(
 select language,count(*) inventory_entries,count(*) filter(where scope='printing') printing_entries,count(*) filter(where scope='card') unidentified_entries,
 count(*) filter(where canonical_mapping_status<>'linked') pending_identity,count(*) filter(where scope='printing' and image_status='missing') missing_exact,
 count(*) filter(where scope='printing' and image_status='candidate') candidate_exact,count(*) filter(where scope='printing' and image_status='verified') verified_exact,
 count(*) filter(where language='und') unknown_language from rows group by language
 )select jsonb_build_object('scanned',(select count(*) from page),'next_key',coalesce((select max(record_key) from page),after_key),
 'has_more',(select count(*) from page)=least(greatest(coalesce(batch_size,2000),1),2000),
 'groups',coalesce((select jsonb_agg(to_jsonb(g)) from groups g),'[]'::jsonb),'languages',coalesce((select jsonb_agg(to_jsonb(l)) from languages l),'[]'::jsonb))
$$;

create function public.catalog_coverage_publication_counts() returns jsonb language sql stable security invoker set search_path='' set statement_timeout='8s' set work_mem='8MB' set jit=off as $$
 select jsonb_build_object('total',(select count(*) from public.set_carte where not eliminata),
 'tagged',(select count(*) from public.set_carte where not eliminata and cardinality(tag)>0),
 'without_image',(select count(*) from public.set_carte where not eliminata and nullif(trim(immagine),'') is null),
 'verified_images',(select count(*) from public.set_carte where not eliminata and immagine_verificata and nullif(trim(immagine),'') is not null),
 'shared_verified_images',(select count(*) from(select immagine from public.set_carte_immagini where verificata and nullif(trim(immagine),'') is not null group by immagine having count(distinct(sigla,numero,variante))>1)x))
$$;
create function public.catalog_publish_coverage_audit(snapshot jsonb,quality jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 if snapshot->>'contract' is distinct from 'catalog-coverage-audit-v1' or snapshot->>'complete' is distinct from 'true' or snapshot->>'generated_at' is null or jsonb_typeof(snapshot->'groups') is distinct from 'array' then raise exception 'Rilevazione incompleta: il precedente riepilogo viene mantenuto';end if;
 if quality->>'generated_at' is distinct from snapshot->>'generated_at' then raise exception 'Rilevazioni non coerenti';end if;
 insert into public.catalog_coverage_snapshots(scope,report) values('latest',snapshot) on conflict(scope) do update set report=excluded.report,updated_at=clock_timestamp();
 insert into public.catalog_quality_cache(scope,report) values('catalog',quality) on conflict(scope) do update set report=excluded.report,updated_at=clock_timestamp();
 delete from public.catalog_coverage_snapshots where scope='checkpoint';
end $$;
-- Existing importer callers now request a background scan; they no longer execute the costly aggregate.
create or replace function public.catalog_refresh_quality_cache() returns void language sql security invoker set search_path='' as $$
 insert into public.catalog_coverage_snapshots(scope,report) values('request','{}') on conflict(scope) do update set updated_at=clock_timestamp()
 where public.catalog_coverage_snapshots.updated_at<now()-interval '25 minutes'
$$;
revoke all on function public.catalog_coverage_scan_bounds(),public.catalog_coverage_card_batch(bigint,bigint,integer),public.catalog_coverage_inventory_batch(text,text,integer),public.catalog_coverage_publication_counts(),public.catalog_publish_coverage_audit(jsonb,jsonb),public.catalog_refresh_quality_cache() from public,anon,authenticated;
grant execute on function public.catalog_coverage_scan_bounds(),public.catalog_coverage_card_batch(bigint,bigint,integer),public.catalog_coverage_inventory_batch(text,text,integer),public.catalog_coverage_publication_counts(),public.catalog_publish_coverage_audit(jsonb,jsonb),public.catalog_refresh_quality_cache() to service_role;
revoke all on function public.catalog_coverage_provider(text),public.catalog_coverage_origin(text,text,text,text) from public;
grant execute on function public.catalog_coverage_provider(text),public.catalog_coverage_origin(text,text,text,text) to service_role;
