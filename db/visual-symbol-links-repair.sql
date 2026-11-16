-- Additive and repeatable. Existing identifiers, tag_code and anonymous reads stay valid.
alter table public.catalog_visual_assets add column if not exists match_code text;
alter table public.catalog_visual_assets add column if not exists tag_codes text[] not null default '{}';
alter table public.cards add column if not exists manual_overrides jsonb not null default '{}';
alter table public.catalog_search_entries add column if not exists manual_overrides jsonb not null default '{}';
create index if not exists cards_visual_uid_c on public.cards((source_uid collate "C"));
revoke all on public.catalog_visual_assets,public.catalog_visual_links from anon,authenticated;
grant select on public.catalog_visual_assets,public.catalog_visual_links to anon,authenticated;

create or replace function public.catalog_visual_language(value text) returns text
language sql immutable security invoker set search_path='' as $$
 select case upper(trim(coalesce(value,'')))
 when 'INT' then 'en' when 'EN' then 'en' when 'IT' then 'it' when 'FR' then 'fr' when 'DE' then 'de' when 'ES' then 'es'
 when 'PT' then 'pt' when 'JP' then 'ja' when 'JA' then 'ja' when 'KOR' then 'ko' when 'KO' then 'ko'
 when 'CHN-T' then 'zh-tw' when 'ZH-TW' then 'zh-tw' when 'CHN' then 'zh-cn' when 'ZH-CN' then 'zh-cn'
 when 'ID' then 'id' when 'TH' then 'th' when 'ES-LA' then 'es-mx' when 'ES-MX' then 'es-mx'
 when 'NL' then 'nl' when 'PL' then 'pl' when 'RU' then 'ru' else 'und' end
$$;
create or replace function public.catalog_visual_actual_language(payload jsonb,entry_language text,parent_language text,entry_release text,manual_language boolean default false)
returns text language sql immutable security invoker set search_path='' as $$
 select public.catalog_visual_language(case when manual_language then entry_language else
 coalesce(nullif(payload->>'printing_language',''),
 case when entry_release is null or payload ? 'variant' then coalesce(nullif(payload->>'source_language',''),parent_language) end,
 entry_language,'und') end)
$$;

-- Keep all existing view columns in their original order; append the new fields.
create or replace view public.catalog_visual_group_members with(security_invoker=true) as
 select a.asset_key,a.kind,a.source_code,a.source_language,a.name,a.scope,a.image_url,a.source_url,a.image_sha256,a.mime_type,
 a.availability,a.match_mode,a.tag_code,a.original_path,a.source_pack,a.provenance,
 md5(jsonb_build_array(a.kind,a.scope,coalesce(a.image_sha256,'missing:'||a.asset_key))::text) visual_group_key,
 a.match_code,a.tag_codes
 from public.catalog_visual_assets a;
grant select on public.catalog_visual_group_members to anon,authenticated,service_role;

-- Shared implementation keeps per-reference and grouped APIs consistent.
create or replace function public.catalog_visual_matches(wanted_assets text[],after_key text default '',page_size integer default 24,include_review boolean default false,filter_language text default null)
returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare result jsonb;
begin
 if page_size is null or page_size<1 or page_size>100 or coalesce(cardinality(wanted_assets),0)>1000 then raise exception 'Limite non valido';end if;
 with refs as materialized(
  select a.*,
  case when coalesce(to_jsonb(a)->'manual_overrides','{}') ? 'source_code' and not(coalesce(to_jsonb(a)->'manual_overrides','{}') ? 'match_code')
   then a.source_code else coalesce(a.match_code,a.source_code) end effective_code,
  case when coalesce(to_jsonb(a)->'manual_overrides','{}') ? 'tag_code' and not(coalesce(to_jsonb(a)->'manual_overrides','{}') ? 'tag_codes')
   then array_remove(array[a.tag_code],null) when cardinality(a.tag_codes)>0 then a.tag_codes else array_remove(array[a.tag_code],null) end effective_tags
  from public.catalog_visual_assets a where a.asset_key=any(wanted_assets)
 ), blocked as materialized(
  select l.entry_key from public.catalog_visual_links l join refs r using(asset_key) where l.status='rejected'
 ), prefixes as materialized(
  select r.asset_key,'tcgdex:'||lang||':'||r.effective_code prefix from refs r
  cross join lateral unnest(case when r.source_language='und' then array['en','it','fr','de','es','pt','ja','ko','zh-tw','zh-cn','id','th','es-mx','nl','pl','ru']
   else array[public.catalog_visual_language(r.source_language)] end) lang
  where r.match_mode='tcgdex-set' and r.scope='physical' and r.availability='available' and lower(r.effective_code)<>'base1'
 ), candidates as(
  select e.entry_key,r.asset_key from refs r join public.catalog_search_entries e on e.tags && r.effective_tags
  where r.match_mode='tag' and r.scope='physical' and r.availability='available' and e.verification<>'catalog' and e.entry_key>after_key
  union all
  select e.entry_key,p.asset_key from prefixes p join public.cards c on
   (c.source_uid collate "C")>=p.prefix||'-' and (c.source_uid collate "C")<p.prefix||'.' and starts_with(c.source_uid,p.prefix||'-')
  join public.catalog_search_entries e on e.card_id=c.id where e.verification<>'catalog' and e.entry_key>after_key
 ), automatic as(
  select e.entry_key,case when r.match_mode='tag' then 'source' else 'candidate' end status,'candidate'::text image_match_status,null::text position,
   e.source_url evidence_url,'automatic'::text method,r.asset_key reference_asset_key
  from candidates k join refs r using(asset_key) join public.catalog_search_entries e using(entry_key) join public.cards c on c.id=e.card_id
  where include_review or r.source_language='und' or public.catalog_visual_actual_language(e.source_payload,e.language,c.source_language,e.release_code,
   (e.manual_overrides ? 'language') or (c.manual_overrides ? 'lingua'))=public.catalog_visual_language(r.source_language)
 ), manual as(
  select l.entry_key,l.status,l.image_match_status,l.position,l.evidence_url,'reviewed-link'::text method,l.asset_key reference_asset_key
  from public.catalog_visual_links l join refs r using(asset_key) where r.scope='physical' and l.entry_key>after_key and l.status<>'rejected'
 ), selected as(select * from automatic union all select * from manual), deduplicated as(
  select distinct on(s.entry_key) s.* from selected s join public.catalog_search_entries e using(entry_key) join public.cards c on c.id=e.card_id
  where not exists(select 1 from blocked b where b.entry_key=s.entry_key)
   and(filter_language is null or public.catalog_visual_actual_language(e.source_payload,e.language,c.source_language,e.release_code,
    (e.manual_overrides ? 'language') or (c.manual_overrides ? 'lingua'))=public.catalog_visual_language(filter_language))
  order by s.entry_key,(s.method='reviewed-link') desc,(s.status='verified') desc,(s.image_match_status='verified') desc,s.reference_asset_key
 ), page as(select * from deduplicated order by entry_key limit page_size+1), body as(
  select p.*,e.name,e.collector_number,e.set_code,e.language,e.tags,e.release_year,e.release_code,c.id card_id,c.image_url reference_image_url,
   public.catalog_visual_actual_language(e.source_payload,e.language,c.source_language,e.release_code,
    (e.manual_overrides ? 'language') or (c.manual_overrides ? 'lingua')) actual_language,
   i.canonical_sigla,i.canonical_numero,i.canonical_variante,i.canonical_mapping_status
  from page p join public.catalog_search_entries e using(entry_key) join public.cards c on c.id=e.card_id
  left join public.catalog_printing_inventory i on i.record_key=e.entry_key and not i.deleted order by p.entry_key limit page_size
 )select jsonb_build_object('results',coalesce((select jsonb_agg(to_jsonb(b) order by b.entry_key) from body b),'[]'::jsonb),
  'has_more',(select count(*)>page_size from page),'next_key',(select max(entry_key) from body),'position_unknown_when_null',true,
  'image_match_is_not_verified_by_automatic_link',true) into result;
 return result;
end $$;

create or replace function public.catalog_visual_cards(symbol_key text,after_key text default '',page_size integer default 24,include_review boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
begin
 if not exists(select 1 from public.catalog_visual_assets where asset_key=symbol_key) then return jsonb_build_object('error','Simbolo non trovato');end if;
 return public.catalog_visual_matches(array[symbol_key],after_key,page_size,include_review,null)||jsonb_build_object('contract','bindex-visual-v1','asset_key',symbol_key);
end $$;
create or replace function public.catalog_visual_group_cards(symbol_group text,after_key text default '',page_size integer default 24,include_review boolean default false,filter_language text default null)
returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare assets text[];
begin
 select array_agg(asset_key order by asset_key) into assets from public.catalog_visual_group_members where visual_group_key=symbol_group;
 if assets is null then return jsonb_build_object('error','Gruppo non trovato');end if;
 return public.catalog_visual_matches(assets,after_key,page_size,include_review,filter_language)||jsonb_build_object('contract','bindex-visual-groups-v1','group_key',symbol_group);
end $$;

-- A language-neutral symbol remains selectable when the user filters card language.
create or replace function public.catalog_visual_group_page(after_group text default '',page_size integer default 48,filter_kind text default null,filter_language text default null,include_unlinked boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare result jsonb;
begin
 if page_size is null or page_size<1 or page_size>100 then raise exception 'Limite non valido';end if;
 with grouped as(
  select m.visual_group_key,
  (array_agg(m.asset_key order by(m.availability='available') desc,(m.match_mode is not null) desc,(m.source_language='en') desc,m.asset_key))[1] representative,
  array_agg(distinct m.source_language order by m.source_language) languages,array_agg(distinct m.source_code order by m.source_code) source_codes,
  array_agg(m.asset_key order by m.asset_key) member_asset_keys,count(*) reference_count,bool_or(m.match_mode is not null) has_links
  from public.catalog_visual_group_members m where m.visual_group_key>after_group and(filter_kind is null or m.kind=filter_kind)
  group by m.visual_group_key having(include_unlinked or bool_or(m.match_mode is not null))
  and(filter_language is null or bool_or(m.source_language='und' or public.catalog_visual_language(m.source_language)=public.catalog_visual_language(filter_language)))
 ),page as(select * from grouped order by visual_group_key limit page_size+1),body as(
  select to_jsonb(a)||jsonb_build_object('group_key',g.visual_group_key,'languages',g.languages,'source_codes',g.source_codes,'member_asset_keys',g.member_asset_keys,
   'reference_count',g.reference_count,'has_links',g.has_links) row,g.visual_group_key from page g join public.catalog_visual_assets a on a.asset_key=g.representative
  order by g.visual_group_key limit page_size
 )select jsonb_build_object('contract','bindex-visual-groups-v1','grouped',true,'results',coalesce((select jsonb_agg(b.row order by b.visual_group_key) from body b),'[]'::jsonb),
 'has_more',(select count(*)>page_size from page),'next_key',(select max(visual_group_key) from body),'grouping_basis','exact-image-hash+kind+scope',
 'image_match_is_not_verified_by_automatic_link',true) into result;return result;
end $$;
revoke all on function public.catalog_visual_language(text),public.catalog_visual_actual_language(jsonb,text,text,text,boolean),public.catalog_visual_matches(text[],text,integer,boolean,text),
 public.catalog_visual_cards(text,text,integer,boolean),public.catalog_visual_group_cards(text,text,integer,boolean,text),public.catalog_visual_group_page(text,integer,text,text,boolean) from public;
grant execute on function public.catalog_visual_language(text),public.catalog_visual_actual_language(jsonb,text,text,text,boolean),public.catalog_visual_matches(text[],text,integer,boolean,text),
 public.catalog_visual_cards(text,text,integer,boolean),public.catalog_visual_group_cards(text,text,integer,boolean,text),public.catalog_visual_group_page(text,integer,text,text,boolean) to anon,authenticated,service_role;
