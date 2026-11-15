import {databaseError,isTransientDatabaseError} from './database-errors.mjs'
import {variantKey,equivalentVariant} from './bindex-identity.mjs'
import {CATALOG_LANGUAGES} from '../src/lib/catalog-languages.ts'
const known=new Set([...CATALOG_LANGUAGES.map(l=>l.code).filter(l=>l!=='INT'),'EN'])
const aliases=new Map(CATALOG_LANGUAGES.map(l=>[l.api,l.api==='en'?'EN':l.code]))
export function actualLanguage(value){
 if(typeof value!=='string')return null
 const lower=value.toLowerCase(),upper=value.toUpperCase()
 return aliases.get(lower)||(known.has(upper)?upper:null)
}
const https=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
export function inventoryRecord({entry,card={},link=null}){
 const p=entry.source_payload||{},v=p.variant||{}
 const inheritedOrigin=!!entry.release_code&&!p.variant
 const declarations=inheritedOrigin?[p.printing_language,p.source_language]:[p.source_language,card.source_language,entry.language]
 const languages=[...new Set(declarations.map(actualLanguage).filter(Boolean))]
 const language=languages.length===1?languages[0]:'und'
 const languageStatus=languages.length>1?'conflict':language==='und'?'unknown':'documented'
 const source=https(entry.source_url)
 const explicit=['normal','holo','reverse','metal','lenticular'].includes(v.type)
 const curated=typeof p.holo==='boolean'&&entry.release_year&&entry.tags?.some(t=>t.startsWith('family:'))
 const scope=p.metadata_scope==='card-metadata-only'?'card':explicit||curated?'printing':'card'
 const imageLanguage=actualLanguage(p.image_language)
 const photo=scope==='printing'&&language!=='und'&&!p.reference_image_only&&p.image_scope==='printing-language'&&imageLanguage===language&&source?https(entry.image_url):null
 const verified=!!photo&&entry.verification==='reviewed'&&p.image_reviewed===true
 const reference=https(entry.image_url)||(['found','uploaded'].includes(card.image_status)?https(card.image_url):null)
 const attributes={}
 for(const field of ['type','foil','subtype','stamp','stamps','size','variantId'])if(v[field]!=null)attributes[field]=v[field]
 if(curated&&!explicit)attributes.type=p.holo?'holo':'normal'
 const hasLink=link&&typeof link.sigla==='string'&&Number.isInteger(link.numero)&&link.numero>0&&typeof link.variante==='string'
 const proposed=explicit?variantKey(v,p.has_normal_variant):null
 const mappingReason=hasLink?(link.pending_reason||(scope==='printing'&&explicit&&(!proposed||!equivalentVariant(link.variante,proposed))?'variant_identity_requires_review':null)):null
 const mapped=hasLink&&!mappingReason
 return {canonical_mapping_status:mapped?'linked':mappingReason?'review':'pending',mapping_reason:mappingReason,record_key:entry.entry_key,source_entry_key:entry.entry_key,card_id:entry.card_id,scope,language,language_status:languageStatus,
  name:entry.name||card.nome||'',source_set_code:entry.set_code,collector_number:entry.collector_number??null,denominator:entry.denominator??null,
  release_code:entry.release_code??null,release_year:entry.release_year??null,deck_code:entry.deck_code??null,deck_number:entry.deck_number??null,
  attributes,tags:entry.tags||[],facts:entry.facts||{},source_url:source,verification:entry.verification,
  canonical_sigla:mapped?link.sigla:null,canonical_numero:mapped?link.numero:null,canonical_variante:mapped?link.variante:null,
  image_url:photo,image_hd:photo?https(p.image_hd):null,image_source_url:photo?https(p.image_source_url)||source:null,
  image_status:verified?'verified':photo?'candidate':'missing',image_evidence:photo?{scope:p.image_scope,language:imageLanguage,reviewed:verified,source:source}:{},reference_image_url:reference,reference_source_url:reference?source:null,
  source_updated_at:entry.updated_at,deleted:false}
}
const check=async query=>{try{const {data,error}=await query;if(error)throw error;return data}catch(error){throw databaseError(error)}}
export async function syncPrintingInventory({db,limit=100,log=console.log}){
 const queued=await check(db.rpc('catalog_inventory_queue',{batch_size:limit}))
 if(!queued.length)return {processed:0,printings:0,cardOnly:0,missingImages:0}
 const records=queued.map(row=>inventoryRecord({entry:row.entry,card:row.card,link:row.link}))
 await check(db.from('catalog_printing_inventory').upsert(records,{onConflict:'record_key'}))
 await check(db.rpc('catalog_inventory_ack',{items:queued.map(row=>({entry_key:row.entry.entry_key,requested_at:row.requested_at}))}))
 const result={processed:records.length,printings:records.filter(r=>r.scope==='printing').length,cardOnly:records.filter(r=>r.scope==='card').length,missingImages:records.filter(r=>r.scope==='printing'&&r.image_status==='missing').length}
 await log(`Inventario Bindex: ${result.processed} dichiarazioni esportabili, ${result.printings} versioni descritte, ${result.cardOnly} carte con versione da identificare, ${result.missingImages} versioni senza foto specifica.`)
 return result
}

export async function runInventorySession({db,log=console.log,onProgress=()=>{},budgetMs=8*60000,clock=Date.now,processBatch=syncPrintingInventory}){
 const deadline=clock()+budgetMs
 const summary={processed:0,printings:0,cardOnly:0,missingImages:0,deferred:false,seed_complete:false}
 let seedPaused=false
 while(clock()<deadline-20000){
  if(!seedPaused&&!summary.seed_complete){
   try{const seed=await check(db.rpc('catalog_inventory_seed',{batch_size:100}));summary.seed_complete=seed.complete}
   catch(error){
    if(!isTransientDatabaseError(error))throw error
    seedPaused=true;summary.deferred=true;summary.deferred_reason=String(error)
    await log('Preparazione inventario rinviata: '+String(error)+'. Continuo sui record già in coda.',true)
   }
  }
  let result
  try{result=await processBatch({db,log,limit:100})}
  catch(error){
   if(!isTransientDatabaseError(error))throw error
   summary.deferred=true;summary.deferred_reason=String(error)
   await log('Inventario sospeso per database occupato. Il lotto non confermato resta in coda: '+String(error),true)
   break
  }
  for(const k of ['processed','printings','cardOnly','missingImages'])summary[k]+=result[k]
  onProgress({...summary})
  if(!result.processed)break
 }
 onProgress({...summary})
 return summary
}
