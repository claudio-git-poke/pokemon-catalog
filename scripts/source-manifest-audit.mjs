import {readdir,readFile} from 'node:fs/promises'
import path from 'node:path'
import {sourceManifest} from './catalog-manifest.mjs'
import {atlasCards} from './atlas-source.mjs'
import {asiaList,englishRecord} from './supplemental-sources.mjs'
import {limitlessLinks} from './research-sources.mjs'
import {CATALOG_LANGUAGES} from '../src/lib/catalog-languages.ts'
import {databaseError} from './database-errors.mjs'

export const MANIFEST_PROVIDERS=['tcgdex','atlas','supplement-en','supplement-th','supplement-id','research-pokumon','research-limitless']
const check=async operation=>{try{const {data,error}=await operation;if(error)throw error;return data}catch(error){throw databaseError(error)}}
const validPath=v=>typeof v==='string'&&v!=='.'&&v!=='..'&&/^[-A-Za-z0-9_.]+$/.test(v)

// One source-list request per job. Never fetch card images or individual detail pages.
export function manifestFetcher({fetchImpl=fetch,clock=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const last=new Map(),hosts=new Set(['api.tcgdex.net','asia.pokemon-card.com','pokumon.com','limitlesstcg.com'])
 return async(url,json=false)=>{
  const u=new URL(url)
  if(u.protocol!=='https:'||!hosts.has(u.hostname)||u.username||u.password)throw Error('URL elenco non autorizzato')
  await wait(Math.max(0,(last.get(u.hostname)||0)+1100-clock()));last.set(u.hostname,clock())
  const response=await fetchImpl(u.href,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{'User-Agent':'BindexCatalog/1.0 (+https://github.com/claudio-git-poke/pokemon-catalog)'}})
  if(!response.ok)throw Error(`Elenco ${u.hostname} HTTP ${response.status}`)
  return json?response.json():response.text()
 }
}

export async function sourceList(job,{root,request=manifestFetcher(),loadAtlas=atlasCards}={}){
 const {provider,source_language:lang,set_id:set}=job
 if(provider==='tcgdex'){
  if(!CATALOG_LANGUAGES.some(l=>l.api===lang)||!validPath(set))throw Error('Identità elenco TCGdex non valida')
  const url=`https://api.tcgdex.net/v2/${lang}/sets/${encodeURIComponent(set)}`,data=await request(url,true)
  if(data.id!==set)throw Error('Identità elenco TCGdex discordante')
  if(data.serie?.id==='tcgp')return {excluded:true,url}
  if(!Array.isArray(data.cards)||!data.cards.length||data.cards.some(c=>typeof c.id!=='string'||!c.id.startsWith(set+'-')||c.id===set+'-'))throw Error('Elenco TCGdex vuoto o con identificativi non validi: completezza sconosciuta')
  return {ids:data.cards.map(c=>c.id),uid:id=>`tcgdex:${lang}:${id}`,url,scope:'source_set'}
 }
 if(provider==='atlas'){
  if(!root)throw Error('Archivio Card Atlas non disponibile')
  const cards=await loadAtlas(root,job)
  if(!cards.length)throw Error('Archivio Card Atlas senza schede utilizzabili')
  return {ids:cards.map(c=>c.id),uid:id=>`atlas:${lang}:${id}`,url:'https://github.com/type-null/PTCG-database',scope:'validated_archive_records'}
 }
 if(provider==='supplement-en'){
  const [series,code]=JSON.parse(set)
  if(!root||![series,code].every(validPath))throw Error('Archivio inglese non disponibile o percorso non valido')
  const dir=path.join(root,'data_en',series,code),files=(await readdir(dir)).filter(f=>f.endsWith('.json')).sort(),records=[]
  for(const file of files){
   const record=englishRecord(JSON.parse(await readFile(path.join(dir,file),'utf8')),series,code,file)
   if(!record)throw Error('Scheda inglese non validata: elenco completo non determinabile')
   records.push(record)
  }
  if(!records.length)throw Error('Archivio inglese vuoto')
  return {ids:records.map(r=>r.uid),uid:id=>id,url:'https://github.com/type-null/PTCG-database',scope:'archive_set'}
 }
 if(['supplement-th','supplement-id'].includes(provider)){
  if(provider!==`supplement-${lang}`||!/^\d+$/.test(set)||Number(set)<1)throw Error('Pagina ufficiale non valida')
  const url=`https://asia.pokemon-card.com/${lang}/card-search/list/?pageNo=${set}`,list=asiaList(await request(url),lang)
  if(Number(set)>list.pages||list.ids.length!==Math.min(20,list.total-(Number(set)-1)*20))throw Error('Pagina ufficiale incompleta o paginazione cambiata')
  return {ids:list.ids.map(id=>`asia-official:${lang}:${id}`),uid:id=>id,url,scope:'source_page',reported_total:list.total}
 }
 if(provider==='research-pokumon'){
  if(!/^\d+$/.test(set)||Number(set)<1)throw Error('Pagina Pokumon non valida')
  const url=`https://pokumon.com/wp-json/wp/v2/card?per_page=50&page=${set}&_embed=1`,rows=await request(url,true)
  if(!Array.isArray(rows)||!rows.length||rows.length>50||rows.some(r=>!Number.isSafeInteger(r.id)||r.status!=='publish'))throw Error('Elenco Pokumon non valido')
  return {ids:rows.map(r=>`pokumon:${r.id}`),uid:id=>id,url,scope:'source_page'}
 }
 if(provider==='research-limitless'){
  const {lang:region,set:code}=JSON.parse(set)
  if((region==='jp'?'ja':region)!==lang)throw Error('Lingua Limitless discordante')
  const url=`https://limitlesstcg.com/cards/${region}/${code}`,ids=limitlessLinks(await request(url),region,code)
  return {ids:ids.map(id=>`limitless:${region}:${code}:${id}`),uid:id=>id,url,scope:'source_set'}
 }
 throw Error('Fonte priva di elenco completo supportato')
}

export async function auditSourceList({db,job,list,clock=Date.now}){
 if(!list.ids.length||list.ids.length>5000||list.ids.some(id=>typeof id!=='string'||!id))throw Error('Elenco vuoto, non valido o oltre il limite di 5.000 identificativi')
 const resolved=[],unique=[...new Set(list.ids)]
 for(let offset=0;offset<unique.length;offset+=200){
  const ids=unique.slice(offset,offset+200),byUid=new Map(ids.map(id=>[list.uid(id),id]))
  const rows=await check(db.from('cards').select('source_uid').in('source_uid',[...byUid.keys()]))
  for(const row of rows)if(byUid.has(row.source_uid))resolved.push(byUid.get(row.source_uid))
 }
 const manifest=sourceManifest(list.ids,resolved)
 manifest.coverage_checked_at=new Date(clock()).toISOString()
 // This reads exact source links, not physical-card equivalence. The complement
 // outside the expected list is intentionally NOT measured by these IN queries.
 manifest.coverage_detail={...manifest.coverage_detail,unexpected_count:null,unexpected_ids:[],comparison_scope:'expected_source_links',
  list_scope:list.scope,source_url:list.url,...(list.reported_total?{reported_source_total:list.reported_total}:{}),
  meaning:'Identificativi della fonte senza collegamento esatto; non prova che manchino carte fisiche.'}
 const saved=await check(db.rpc('catalog_save_manifest_audit',{wanted_uid:job.source_uid,expected_set_id:job.set_id,
  previous_check:job.coverage_checked_at||null,new_manifest:manifest}))
 return {saved,missing:manifest.coverage_detail.missing_count,checked:unique.length}
}

export async function runSourceManifestAudit({db,root,budgetMs=10*60000,maxJobs=140,perProvider=20,clock=Date.now,
 request=manifestFetcher(),loadList=sourceList,log=console.log,onProgress=()=>{}}){
 const end=clock()+budgetMs,stats={checked_lists:0,checked_ids:0,missing_links:0,excluded:0,errors:0,conflicts:0},groups=[]
 for(const provider of MANIFEST_PROVIDERS){
  if(!root&&['atlas','supplement-en'].includes(provider))continue
  groups.push(await check(db.from('catalog_sync_sets').select('*').eq('provider',provider).neq('set_id','__index__').neq('coverage_scope','digital')
   .lte('manifest_next_check_at',new Date(clock()).toISOString()).order('manifest_next_check_at').order('source_uid').limit(perProvider)))
 }
 const blocked=new Set();let attempted=0
 for(let slot=0;slot<perProvider;slot++)for(const group of groups){
  const job=group[slot];if(!job||blocked.has(job.provider))continue
  if(clock()>end-30000||attempted>=maxJobs)return {...stats,deferred:true}
  attempted++
  let list
  try{list=await loadList(job,{root,request})}
  catch(error){
   stats.errors++
   // Failure preserves the last successful measurement and the importer's queue.
   await check(db.from('catalog_sync_sets').update({manifest_last_attempt_at:new Date(clock()).toISOString(),manifest_last_error:String(error),
    manifest_next_check_at:new Date(clock()+6*3600000).toISOString()}).eq('source_uid',job.source_uid))
   await log(`${job.name}: confronto rinviato · ${String(error)}`,true)
   if(/HTTP (429|503)\b/.test(String(error)))blocked.add(job.provider)
   onProgress({...stats});continue
  }
  if(list.excluded){
   await check(db.from('catalog_sync_sets').update({coverage_scope:'digital',manifest_last_attempt_at:new Date(clock()).toISOString(),manifest_last_error:null,
    manifest_next_check_at:new Date(clock()+30*86400000).toISOString()}).eq('source_uid',job.source_uid).eq('set_id',job.set_id))
   stats.excluded++;continue
  }
  // Database/permission errors abort; they must never be reported as source gaps.
  const result=await auditSourceList({db,job,list,clock})
  if(result.saved){stats.checked_lists++;stats.checked_ids+=result.checked;stats.missing_links+=result.missing}
  else stats.conflicts++
  await log(`${job.name}: ${result.saved?`${result.checked} identificativi confrontati, ${result.missing} senza collegamento esatto`:'fonte aggiornata durante il controllo; riprovo alla prossima sessione'}. Nessuna carta modificata.`,true)
  onProgress({...stats})
 }
 return stats
}
