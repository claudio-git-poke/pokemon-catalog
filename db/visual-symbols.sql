create table public.catalog_visual_assets(
 asset_key text primary key check(asset_key ~ '^[a-f0-9]{32}$'),kind text not null,source_code text not null,source_language text not null,name text not null,
 scope text not null check(scope in ('physical','digital','reference')),image_url text,source_url text,image_sha256 text,mime_type text,
 availability text not null check(availability in ('available','local-only','missing')),match_mode text check(match_mode in ('tag','tcgdex-set')),tag_code text,
 original_path text not null,source_pack text not null,provenance jsonb not null default '{}',
 check(image_url is null or image_url like 'https://%'),check(source_url is null or source_url like 'https://%'),
 check(match_mode is null or (scope='physical' and availability='available' and image_sha256 is not null and image_url is not null)),
 check(match_mode<>'tag' or tag_code is not null)
);
create index catalog_visual_asset_hash on public.catalog_visual_assets(image_sha256);
create index catalog_visual_asset_filter on public.catalog_visual_assets(scope,kind,asset_key);
alter table public.catalog_visual_assets enable row level security;
grant select on public.catalog_visual_assets to anon,authenticated;
grant all on public.catalog_visual_assets to service_role;
create policy visual_assets_read on public.catalog_visual_assets for select to anon,authenticated using(true);
create table public.catalog_visual_links(
 asset_key text references public.catalog_visual_assets(asset_key) on delete cascade,
 entry_key text references public.catalog_search_entries(entry_key) on delete cascade,
 status text not null check(status in ('candidate','verified','rejected')),image_match_status text not null default 'candidate' check(image_match_status in ('candidate','verified')),
 position text,evidence_url text not null check(evidence_url like 'https://%'),primary key(asset_key,entry_key)
);
create index catalog_visual_link_entry on public.catalog_visual_links(entry_key);
alter table public.catalog_visual_links enable row level security;
grant select on public.catalog_visual_links to anon,authenticated;
grant all on public.catalog_visual_links to service_role;
create policy visual_links_read on public.catalog_visual_links for select to anon,authenticated using(true);
-- Associations are evaluated from current source data, without copying or updating every card.
create function public.catalog_visual_cards(symbol_key text,after_key text default '',page_size integer default 24,include_review boolean default false)
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
  where a.match_mode='tcgdex-set' and c.source_uid>='tcgdex:'||a.source_language||':'||a.source_code||'-'
   and c.source_uid<'tcgdex:'||a.source_language||':'||a.source_code||'-~'
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
