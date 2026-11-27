// Catalogue listing on Turso with few reads. One grouped count gives total,
// with photo and missing photo; counts are kept in memory for ten minutes;
// pages follow the (sigla, lingua, numero) index. Metadata filters (rarity,
// type, stage, card type) go through the indexed tag table and match every
// language variant of the vocabulary; the year filter uses the set sheets.
import {tagVariants} from '../lib/metadata-vocabulary.mjs'
import {looseKey} from '../lib/set-sheet-lookup.mjs'

export const PAGE_SIZE=48
export const TAG_FILTERS={rarita:'rarity',tipo:'type',stadio:'stage',carta:'card-type'}
const WESTERN=['INT','EN','IT','FR','DE','ES','PT','ES-LA','NL']
const ASIAN=['JP','KOR','CHN-T','CHN','TH','ID']

// Every catalogue code of the sets released in a year: the sheet itself, its
// official abbreviation, and the same code in the languages that borrow it.
export function yearCodes(sheets){
 const byYear=new Map()
 for(const [key,s] of Object.entries(sheets)){
  const year=String(s.release_date||'').slice(0,4);if(!/^\d{4}$/.test(year))continue
  const [code,lang]=key.split('@'),codes=[code,s.abbreviation&&looseKey(s.abbreviation)].filter(Boolean)
  const langs=WESTERN.includes(lang)?(['INT','EN'].includes(lang)?WESTERN:[lang]):ASIAN.includes(lang)?(lang==='JP'?ASIAN:[lang]):[lang]
  if(!byYear.has(year))byYear.set(year,new Set())
  for(const c of codes)for(const l of langs)byYear.get(year).add(`${String(c).toUpperCase()}@${l}`)
 }
 return byYear
}

export function readFilters(params){
 const get=k=>String(params.get(k)||'').trim()
 const tags={};for(const [param,family] of Object.entries(TAG_FILTERS)){const v=get(param);if(v)tags[family]=v.startsWith(family+':')?v:`${family}:${v}`}
 return {search:get('q').slice(0,80),set:get('set').slice(0,40),language:get('lingua').slice(0,8),photo:['with','missing'].includes(get('foto'))?get('foto'):'all',year:/^\d{4}$/.test(get('anno'))?get('anno'):'',tags,page:Math.max(0,Math.min(5000,Number.parseInt(get('pagina')||'1',10)-1||0))}
}

const PHOTO_WITH="c.image_status IN ('found','manual') AND coalesce(c.image_url,'')<>''"
export function buildWhere(filters,{years=new Map()}={}){
 const where=[],args=[]
 if(filters.language){where.push('c.lingua=?');args.push(filters.language)}
 if(filters.set){const s=filters.set.replace(/[%_]/g,'').toUpperCase();if(s.includes('@')){where.push('c.sigla=?');args.push(s)}else{where.push('c.sigla LIKE ?');args.push(`%${s}%`)}}
 if(filters.search){const s=`%${filters.search.replace(/[%_]/g,'')}%`;where.push('(c.nome LIKE ? OR c.file_name LIKE ? OR c.codice LIKE ?)');args.push(s,s,s)}
 if(filters.year){const codes=[...(years.get(filters.year)||[])];if(!codes.length)where.push('0');else{where.push(`c.sigla IN (${codes.map(()=>'?').join(',')})`);args.push(...codes)}}
 for(const code of Object.values(filters.tags||{})){
  const variants=tagVariants(code)
  where.push(`c.id IN (SELECT json_extract(e._row,'$.card_id') FROM _catalog_entry_tags t JOIN _copy_catalog_search_entries e ON e.rowid=t.entry_rowid WHERE t.tag IN (${variants.map(()=>'?').join(',')}))`)
  args.push(...variants)
 }
 return {where,args}
}
export function buildQueries(filters,options){
 const {where,args}=buildWhere(filters,options)
 const photo=filters.photo==='with'?[PHOTO_WITH]:filters.photo==='missing'?[`NOT (${PHOTO_WITH})`]:[]
 const clause=list=>list.length?' WHERE '+list.join(' AND '):''
 return {
  page:{sql:`SELECT c._row AS row FROM cards c${clause([...where,...photo])} ORDER BY c.sigla,c.lingua,c.numero,c.id LIMIT ${PAGE_SIZE} OFFSET ${filters.page*PAGE_SIZE}`,args},
  counts:{sql:`SELECT CASE WHEN ${PHOTO_WITH} THEN 'with' ELSE 'missing' END AS bucket,count(*) AS n FROM cards c${clause(where)} GROUP BY 1`,args}
 }
}
const cache=new Map()
export async function listCatalog(client,filters,{years=new Map(),ttl=600000,clock=Date.now}={}){
 const q=buildQueries(filters,{years})
 const key=JSON.stringify({...filters,page:0,photo:'all'})
 let counts=cache.get(key)
 if(!counts||clock()-counts.at>ttl){
  const rows=(await client.execute(q.counts)).rows,get=b=>Number(rows.find(r=>r.bucket===b)?.n||0)
  counts={with:get('with'),missing:get('missing'),at:clock()};counts.total=counts.with+counts.missing
  cache.set(key,counts);if(cache.size>500)cache.delete(cache.keys().next().value)
 }
 const cards=(await client.execute(q.page)).rows.map(r=>JSON.parse(r.row))
 const total=filters.photo==='with'?counts.with:filters.photo==='missing'?counts.missing:counts.total
 return {cards,total,counts:{total:counts.total,with:counts.with,missing:counts.missing},counted_at:new Date(counts.at).toISOString()}
}
