import {CatalogRestError} from './turso-rest.mjs'
const LANGUAGES={INT:'en',EN:'en',IT:'it',FR:'fr',DE:'de',ES:'es',PT:'pt',JP:'ja',JA:'ja',KOR:'ko',KO:'ko','CHN-T':'zh-tw','ZH-TW':'zh-tw',CHN:'zh-cn','ZH-CN':'zh-cn',ID:'id',TH:'th','ES-LA':'es-mx','ES-MX':'es-mx',NL:'nl',PL:'pl',RU:'ru'}
export const visualLanguage=value=>LANGUAGES[String(value??'').trim().toUpperCase()]||'und'
const langSql=value=>`CASE upper(trim(coalesce(${value},''))) ${Object.entries(LANGUAGES).map(([k,v])=>`WHEN '${k}' THEN '${v}'`).join(' ')} ELSE 'und' END`
const actualLanguageSql=()=>langSql(`CASE WHEN json_type(e.manual_overrides,'$.language') IS NOT NULL OR json_type(c.manual_overrides,'$.lingua') IS NOT NULL THEN e.language ELSE coalesce(nullif(json_extract(e.source_payload,'$.printing_language'),''),CASE WHEN e.release_code IS NULL OR json_type(e.source_payload,'$.variant') IS NOT NULL THEN coalesce(nullif(json_extract(e.source_payload,'$.source_language'),''),c.source_language) END,e.language,'und') END`)
function cap(value,fallback,max=100){const n=value??fallback;if(!Number.isInteger(n)||n<1||n>max)throw new CatalogRestError('Limite non valido.');return n}
export async function visualGroupPage(client,{after_group='',page_size=48,filter_kind=null,filter_language=null,include_unlinked=false}={}){
 const limit=cap(page_size,48),args=[after_group],conditions=['group_key>?']
 if(filter_kind){conditions.push('kind=?');args.push(filter_kind)}
 if(!include_unlinked)conditions.push('has_links=1')
 if(filter_language){conditions.push("EXISTS(SELECT 1 FROM json_each(languages) WHERE value IN ('und',?))");args.push(visualLanguage(filter_language))}
 args.push(limit+1)
 const all=(await client.execute({sql:'SELECT _row FROM _catalog_visual_groups WHERE '+conditions.join(' AND ')+' ORDER BY group_key LIMIT ?',args})).rows
 const results=all.slice(0,limit).map(r=>JSON.parse(r._row))
 return {contract:'bindex-visual-groups-v1',grouped:true,results,has_more:all.length>limit,next_key:results.at(-1)?.group_key??null,grouping_basis:'exact-image-hash+kind+scope',image_match_is_not_verified_by_automatic_link:true}
}
export async function visualMatches(client,{wanted_assets,after_key='',page_size=24,include_review=false,filter_language=null}){
 const limit=cap(page_size,24)
 if(!Array.isArray(wanted_assets)||wanted_assets.length>1000||wanted_assets.some(k=>typeof k!=='string'||k.length>200))throw new CatalogRestError('Riferimenti non validi.')
 if(!wanted_assets.length)return {results:[],has_more:false,next_key:null,position_unknown_when_null:true,image_match_is_not_verified_by_automatic_link:true}
 const args=[],bind=value=>{args.push(value);return '?'},keys=wanted_assets.map(bind).join(','),languages=bind(JSON.stringify(['en','it','fr','de','es','pt','ja','ko','zh-tw','zh-cn','id','th','es-mx','nl','pl','ru'])),review=bind(include_review?1:0),filter=filter_language?visualLanguage(filter_language):null
 const variantFilter=filter?'actual_language='+bind(filter):'1',cursor=bind(after_key),pageFilter=filter?'s.actual_language='+bind(filter):'1',pageCap=bind(limit+1)
 const actual=actualLanguageSql()
 const sql=`WITH refs AS MATERIALIZED(
 SELECT a.*,CASE WHEN json_type(a.manual_overrides,'$.source_code') IS NOT NULL AND json_type(a.manual_overrides,'$.match_code') IS NULL THEN a.source_code ELSE coalesce(a.match_code,a.source_code) END effective_code,
 CASE WHEN json_type(a.manual_overrides,'$.tag_code') IS NOT NULL AND json_type(a.manual_overrides,'$.tag_codes') IS NULL THEN json_array(a.tag_code) WHEN json_array_length(a.tag_codes)>0 THEN a.tag_codes ELSE json_array(a.tag_code) END effective_tags
 FROM catalog_visual_assets a WHERE a.asset_key IN (${keys})
 ),blocked AS MATERIALIZED(SELECT l.entry_key FROM catalog_visual_links l JOIN refs r USING(asset_key) WHERE l.status='rejected'),
 prefixes AS MATERIALIZED(
 SELECT r.asset_key,'tcgdex:'||lang.value||':'||r.effective_code prefix FROM refs r,json_each(CASE WHEN r.source_language='und' THEN ${languages} ELSE json_array(${langSql('r.source_language')}) END)lang
 WHERE r.match_mode='tcgdex-set' AND r.scope='physical' AND r.availability='available' AND lower(r.effective_code)<>'base1'
 ),candidates AS(
 SELECT e.entry_key,r.asset_key FROM refs r,json_each(r.effective_tags)rt JOIN _catalog_entry_tags t ON t.tag=rt.value JOIN catalog_search_entries e ON e._entry_rowid=t.entry_rowid
 WHERE r.match_mode='tag' AND r.scope='physical' AND r.availability='available'
 UNION
 SELECT e.entry_key,p.asset_key FROM prefixes p JOIN cards c ON c.source_uid>=p.prefix||'-' COLLATE BINARY AND c.source_uid<p.prefix||'.' COLLATE BINARY AND substr(c.source_uid,1,length(p.prefix)+1)=p.prefix||'-'
 JOIN catalog_search_entries e ON e.card_id=c.id
 ),automatic AS(
 SELECT e.entry_key,CASE WHEN r.match_mode='tag' THEN 'source' ELSE 'candidate' END status,'candidate' image_match_status,NULL position,e.source_url evidence_url,'automatic' method,r.asset_key reference_asset_key,e.card_id,e.verification,${actual} actual_language
 FROM candidates k JOIN refs r USING(asset_key) JOIN catalog_search_entries e USING(entry_key) JOIN cards c ON c.id=e.card_id
 WHERE ${review}=1 OR r.source_language='und' OR ${actual}=${langSql('r.source_language')}
 ),manual AS(
 SELECT l.entry_key,l.status,l.image_match_status,l.position,l.evidence_url,'reviewed-link' method,l.asset_key reference_asset_key,e.card_id,e.verification,${actual} actual_language
 FROM catalog_visual_links l JOIN refs r USING(asset_key) JOIN catalog_search_entries e USING(entry_key) JOIN cards c ON c.id=e.card_id WHERE r.scope='physical' AND l.status<>'rejected'
 ),selected AS MATERIALIZED(SELECT * FROM automatic UNION ALL SELECT * FROM manual),variant_cards AS MATERIALIZED(
 SELECT DISTINCT card_id FROM selected WHERE verification<>'catalog' AND (${variantFilter})
 UNION SELECT e.card_id FROM blocked b JOIN catalog_search_entries e USING(entry_key) WHERE e.verification<>'catalog'
 ),ranked AS(
 SELECT s.*,row_number() OVER(PARTITION BY s.entry_key ORDER BY (s.method='reviewed-link') DESC,(s.status='verified') DESC,(s.image_match_status='verified') DESC,s.reference_asset_key) rn
 FROM selected s WHERE s.entry_key>${cursor} AND NOT EXISTS(SELECT 1 FROM blocked b WHERE b.entry_key=s.entry_key)
 AND (s.verification<>'catalog' OR NOT EXISTS(SELECT 1 FROM variant_cards v WHERE v.card_id=s.card_id)) AND (${pageFilter})
 ),page AS(SELECT * FROM ranked WHERE rn=1 ORDER BY entry_key LIMIT ${pageCap})
 SELECT p.*,e._row entry_json,c._row card_json,i._row inventory_json FROM page p JOIN catalog_search_entries e USING(entry_key) JOIN cards c ON c.id=e.card_id
 LEFT JOIN catalog_printing_inventory i ON i.record_key=e.entry_key AND i.deleted=0 ORDER BY p.entry_key`
 const all=(await client.execute({sql,args})).rows
 const results=all.slice(0,limit).map(row=>{
  const e=JSON.parse(row.entry_json),c=JSON.parse(row.card_json),i=row.inventory_json?JSON.parse(row.inventory_json):{}
  return {entry_key:row.entry_key,status:row.status,image_match_status:row.image_match_status,position:row.position,evidence_url:row.evidence_url,method:row.method,reference_asset_key:row.reference_asset_key,name:e.name,collector_number:e.collector_number,set_code:e.set_code,language:e.language,tags:e.tags,release_year:e.release_year,release_code:e.release_code,card_id:c.id,reference_image_url:c.image_url,actual_language:row.actual_language,canonical_sigla:i.canonical_sigla??null,canonical_numero:i.canonical_numero??null,canonical_variante:i.canonical_variante??null,canonical_mapping_status:i.canonical_mapping_status??null}
 })
 return {results,has_more:all.length>limit,next_key:results.at(-1)?.entry_key??null,position_unknown_when_null:true,image_match_is_not_verified_by_automatic_link:true}
}
export async function visualCards(client,{symbol_key,...rest}){
 const exists=(await client.execute({sql:'SELECT 1 FROM _copy_catalog_visual_assets WHERE _key=?',args:[JSON.stringify([symbol_key])]})).rows.length
 if(!exists)return {error:'Simbolo non trovato'}
 return {...await visualMatches(client,{...rest,wanted_assets:[symbol_key]}),contract:'bindex-visual-v1',asset_key:symbol_key}
}
export async function visualGroupCards(client,{symbol_group,...rest}){
 const keys=(await client.execute({sql:'SELECT json_extract(_row,\'$.asset_key\') asset_key FROM _copy_catalog_visual_assets WHERE _group_key=? ORDER BY _key',args:[symbol_group]})).rows.map(r=>r.asset_key)
 if(!keys.length)return {error:'Gruppo non trovato'}
 return {...await visualMatches(client,{...rest,wanted_assets:keys}),contract:'bindex-visual-groups-v1',group_key:symbol_group}
}
