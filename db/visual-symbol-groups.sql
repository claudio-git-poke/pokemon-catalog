create index if not exists cards_visual_uid_c on public.cards((source_uid collate "C"));
-- One visual group for identical bytes in the same kind and scope; original references stay intact.
create view public.catalog_visual_group_members with(security_invoker=true) as
 select a.*,md5(jsonb_build_array(a.kind,a.scope,coalesce(a.image_sha256,'missing:'||a.asset_key))::text) visual_group_key
 from public.catalog_visual_assets a;
grant select on public.catalog_visual_group_members to anon,authenticated,service_role;
create function public.catalog_visual_group_page(after_group text default '',page_size integer default 48,filter_kind text default null,filter_language text default null,include_unlinked boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare result jsonb;
begin
 if page_size<1 or page_size>100 then raise exception 'Limite non valido';end if;
 with grouped as (
  select m.visual_group_key,
   (array_agg(m.asset_key order by (m.availability='available') desc,(m.match_mode is not null) desc,(m.source_language='en') desc,m.asset_key))[1] representative,
   array_agg(distinct m.source_language order by m.source_language) languages,
   array_agg(distinct m.source_code order by m.source_code) source_codes,
   array_agg(m.asset_key order by m.asset_key) member_asset_keys,
   count(*) reference_count,bool_or(m.match_mode is not null) has_links
  from public.catalog_visual_group_members m where m.visual_group_key>after_group
   and (filter_kind is null or m.kind=filter_kind)
  group by m.visual_group_key
  having (include_unlinked or bool_or(m.match_mode is not null)) and (filter_language is null or bool_or(m.source_language=filter_language))
 ), page as (
  select * from grouped order by visual_group_key limit page_size+1
 ), body as (
  select to_jsonb(a)||jsonb_build_object('group_key',g.visual_group_key,'languages',g.languages,'source_codes',g.source_codes,'member_asset_keys',g.member_asset_keys,'reference_count',g.reference_count,'has_links',g.has_links) row,g.visual_group_key
  from page g join public.catalog_visual_assets a on a.asset_key=g.representative order by g.visual_group_key limit page_size
 )
 select jsonb_build_object('contract','bindex-visual-groups-v1','grouped',true,'results',coalesce((select jsonb_agg(b.row order by b.visual_group_key) from body b),'[]'::jsonb),
 'has_more',(select count(*)>page_size from page),'next_key',(select max(visual_group_key) from body),
 'grouping_basis','exact-image-hash+kind+scope','image_match_is_not_verified_by_automatic_link',true) into result;
 return result;
end $$;
create function public.catalog_visual_group_cards(symbol_group text,after_key text default '',page_size integer default 24,include_review boolean default false,filter_language text default null)
returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare result jsonb;
begin
 if page_size<1 or page_size>100 then raise exception 'Limite non valido';end if;
 if not exists(select 1 from public.catalog_visual_group_members where visual_group_key=symbol_group) then return jsonb_build_object('error','Gruppo non trovato');end if;
 with members as materialized (select * from public.catalog_visual_group_members where visual_group_key=symbol_group),
 blocked as (
  select l.entry_key from public.catalog_visual_links l join members m using(asset_key) where l.status='rejected'
 ), candidates as (
  select e.entry_key,m.asset_key from members m join public.catalog_search_entries e on e.tags @> array[m.tag_code]
  where m.match_mode='tag' and e.verification<>'catalog' and e.entry_key>after_key
  union all
  select e.entry_key,m.asset_key from members m join public.cards c on
   (c.source_uid collate "C")>='tcgdex:'||m.source_language||':'||m.source_code||'-' and (c.source_uid collate "C")<'tcgdex:'||m.source_language||':'||m.source_code||'.'
   and starts_with(c.source_uid,'tcgdex:'||m.source_language||':'||m.source_code||'-')
   join public.catalog_search_entries e on e.card_id=c.id
  where m.match_mode='tcgdex-set' and e.entry_key>after_key
 ), automatic as (
  select e.entry_key,case when m.match_mode='tag' then 'source' else 'candidate' end status,'candidate'::text image_match_status,null::text position,
   e.source_url evidence_url,'automatic'::text method,m.asset_key reference_asset_key
  from candidates k join members m using(asset_key) join public.catalog_search_entries e using(entry_key) join public.cards c on c.id=e.card_id
  where m.scope='physical' and m.availability='available'
   and (include_review or lower(coalesce(e.source_payload->>'printing_language',case when e.release_code is null or e.source_payload ? 'variant' then coalesce(e.source_payload->>'source_language',c.source_language) end))=lower(m.source_language))
 ), manual as (
  select l.entry_key,l.status,l.image_match_status,l.position,l.evidence_url,'reviewed-link'::text method,l.asset_key reference_asset_key
  from public.catalog_visual_links l join members m using(asset_key)
  where m.scope='physical' and l.entry_key>after_key and l.status<>'rejected'
 ), selected as (
  select * from automatic union all select * from manual
 ), deduplicated as (
  select distinct on(s.entry_key) s.* from selected s join public.catalog_search_entries e using(entry_key) join public.cards c on c.id=e.card_id
  where not exists(select 1 from blocked b where b.entry_key=s.entry_key)
   and (filter_language is null or lower(coalesce(e.source_payload->>'printing_language',case when e.release_code is null or e.source_payload ? 'variant' then coalesce(e.source_payload->>'source_language',c.source_language) end,'und'))=lower(filter_language))
  order by s.entry_key,(s.method='reviewed-link') desc,(s.status='verified') desc,(s.image_match_status='verified') desc,s.reference_asset_key
 ), page as (select * from deduplicated order by entry_key limit page_size+1), body as (
  select p.*,e.name,e.collector_number,e.set_code,e.language,e.tags,e.release_year,e.release_code,c.id card_id,c.image_url reference_image_url,
   coalesce(e.source_payload->>'printing_language',case when e.release_code is null or e.source_payload ? 'variant' then coalesce(e.source_payload->>'source_language',c.source_language) end,'und') actual_language,
   i.canonical_sigla,i.canonical_numero,i.canonical_variante,i.canonical_mapping_status
  from page p join public.catalog_search_entries e using(entry_key) join public.cards c on c.id=e.card_id
  left join public.catalog_printing_inventory i on i.record_key=e.entry_key and not i.deleted order by p.entry_key limit page_size
 )
 select jsonb_build_object('contract','bindex-visual-groups-v1','group_key',symbol_group,
 'results',coalesce((select jsonb_agg(to_jsonb(b) order by b.entry_key) from body b),'[]'::jsonb),
 'has_more',(select count(*)>page_size from page),'next_key',(select max(entry_key) from body),'position_unknown_when_null',true,
 'image_match_is_not_verified_by_automatic_link',true) into result;
 return result;
end $$;
revoke all on function public.catalog_visual_group_page(text,integer,text,text,boolean) from public;
revoke all on function public.catalog_visual_group_cards(text,text,integer,boolean,text) from public;
grant execute on function public.catalog_visual_group_page(text,integer,text,text,boolean) to anon,authenticated,service_role;
grant execute on function public.catalog_visual_group_cards(text,text,integer,boolean,text) to anon,authenticated,service_role;

-- Apply the same prefix fix to the existing per-reference API.
create or replace function public.catalog_visual_cards(symbol_key text,after_key text default '',page_size integer default 24,include_review boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare a public.catalog_visual_assets; result jsonb;
begin
 if page_size<1 or page_size>100 then raise exception 'Limite non valido';end if;
 select * into a from public.catalog_visual_assets where asset_key=symbol_key;
 if not found then return jsonb_build_object('error','Simbolo non trovato');end if;
 with candidates as (
  select e.entry_key from public.catalog_search_entries e
  where a.match_mode='tag' and e.verification<>'catalog' and e.tags @> array[a.tag_code] and e.entry_key>after_key
  union all
  select e.entry_key from public.cards c join public.catalog_search_entries e on e.card_id=c.id
  where a.match_mode='tcgdex-set' and (c.source_uid collate "C")>='tcgdex:'||a.source_language||':'||a.source_code||'-'
   and (c.source_uid collate "C")<'tcgdex:'||a.source_language||':'||a.source_code||'.'
   and starts_with(c.source_uid,'tcgdex:'||a.source_language||':'||a.source_code||'-') and e.entry_key>after_key
 ), automatic as (
  select e.entry_key,case when a.match_mode='tag' then 'source' else 'candidate' end status,'candidate'::text image_match_status,null::text position,
   e.source_url evidence_url,'automatic'::text method
  from candidates k join public.catalog_search_entries e using(entry_key) join public.cards c on c.id=e.card_id
  where a.scope='physical' and a.availability='available'
   and (include_review or lower(coalesce(e.source_payload->>'printing_language',case when e.release_code is null or e.source_payload ? 'variant' then coalesce(e.source_payload->>'source_language',c.source_language) end))=lower(a.source_language))
   and not exists(select 1 from public.catalog_visual_links l where l.asset_key=a.asset_key and l.entry_key=e.entry_key)
 ), manual as (
  select l.entry_key,l.status,l.image_match_status,l.position,l.evidence_url,'reviewed-link'::text method
  from public.catalog_visual_links l where a.scope='physical' and l.asset_key=a.asset_key and l.entry_key>after_key and l.status<>'rejected'
 ), selected as (select * from automatic union all select * from manual), page as (
  select * from selected order by entry_key limit page_size+1
 ), body as (
  select p.*,e.name,e.collector_number,e.set_code,e.language,e.tags,e.release_year,e.release_code,c.id card_id,c.image_url reference_image_url,
   coalesce(e.source_payload->>'printing_language',case when e.release_code is null or e.source_payload ? 'variant' then coalesce(e.source_payload->>'source_language',c.source_language) end,'und') actual_language,
   i.canonical_sigla,i.canonical_numero,i.canonical_variante,i.canonical_mapping_status
  from page p join public.catalog_search_entries e using(entry_key) join public.cards c on c.id=e.card_id
  left join public.catalog_printing_inventory i on i.record_key=e.entry_key and not i.deleted
  order by p.entry_key limit page_size
 )
 select jsonb_build_object('contract','bindex-visual-v1','asset_key',a.asset_key,'position_unknown_when_null',true,
 'results',coalesce((select jsonb_agg(to_jsonb(b) order by b.entry_key) from body b),'[]'::jsonb),
 'has_more',(select count(*)>page_size from page),'next_key',(select max(entry_key) from body),
 'image_match_is_not_verified_by_automatic_link',true) into result;
 return result;
end $$;
revoke all on function public.catalog_visual_cards(text,text,integer,boolean) from public;
grant execute on function public.catalog_visual_cards(text,text,integer,boolean) to anon,authenticated,service_role;
