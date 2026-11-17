import {knownRarity} from './card-metadata.mjs'
import {normalizeSearch} from '../src/lib/catalog-identification.ts'
import {databaseError,isTransientDatabaseError} from './database-errors.mjs'
export const RARITY_LANGUAGES=['de','es','pt','fr','en','it','ja']
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
export async function sourceJson(url){
 for(let attempt=0;;attempt++){
  try{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Object.assign(Error('TCGdex HTTP '+r.status),{status:r.status});return await r.json()}
  catch(error){if(attempt||error.status&&!['429','500','502','503','504'].includes(String(error.status)))throw error;await wait(750)}
 }
}
export function rarityEvidence(language,rarity,body,url){
 if(!body||normalizeSearch(body.name||'')!==normalizeSearch(rarity)||!Array.isArray(body.cards))throw Error('Risposta di rarità non coerente con la richiesta')
 const ids=new Set()
 return body.cards.map(card=>{
  if(typeof card.id!=='string'||!card.id||card.id.length>160||ids.has(card.id))throw Error('Identità duplicate o non valide nell’elenco di rarità')
  ids.add(card.id)
  return {source_uid:`tcgdex:${language}:${card.id}`,source_card_id:card.id,source_language:language,rarity,evidence_url:url}
 })
}
export function unambiguousEvidence(rows){
 const byUid=new Map(),conflicts=new Set()
 for(const r of rows){const old=byUid.get(r.source_uid);if(old&&normalizeSearch(old.rarity)!==normalizeSearch(r.rarity))conflicts.add(r.source_uid);else byUid.set(r.source_uid,r)}
 return {rows:[...byUid.values()].filter(r=>!conflicts.has(r.source_uid)),conflicts:[...conflicts]}
}
export async function collectRarityEvidence({language,fetchJson=sourceJson,log=()=>{}}){
 const base=`https://api.tcgdex.net/v2/${language}/rarities`,names=await fetchJson(base)
 if(!Array.isArray(names)||names.some(x=>typeof x!=='string'))throw Error('Indice delle rarità non valido')
 const selected=names.filter(r=>knownRarity(r,language)),rows=[],errors=[]
 let next=0
 const work=async()=>{
  while(next<selected.length){
   const name=selected[next++],url=base+'/'+encodeURIComponent(name)
   try{rows.push(...rarityEvidence(language,name,await fetchJson(url),url))}
   catch(error){errors.push({url,error:String(error)});await log(`Rarità ${language}/${name}: rinviata (${String(error)}).`)}
  }
 }
 await Promise.all(Array.from({length:Math.min(3,selected.length)},work))
 return {...unambiguousEvidence(rows),groups:selected.length,errors}
}
export async function retryRarityRpc(db,name,args){
 for(let attempt=0;;attempt++){
  const {data,error}=await db.rpc(name,args)
  if(!error)return data
  const failure=databaseError(error)
  if(attempt||!isTransientDatabaseError(failure))throw failure
  await wait(750)
 }
}
