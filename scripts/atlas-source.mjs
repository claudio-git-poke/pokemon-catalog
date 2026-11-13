import { readdir,readFile } from 'node:fs/promises'
import path from 'node:path'
export const ATLAS_LANGUAGES=[['jp','ja','JP'],['ko','ko','KOR'],['tc','zh-tw','CHN-T']]
export const normalizedSet=s=>s.split('@')[0].trim().toLowerCase()
export const normalizedNumber=n=>String(n).split('/')[0].trim().replace(/^0+(?=\d)/,'').toUpperCase()
export async function atlasSets(root) {
 const result=[]
 for(const [folder,lang,localLanguage] of ATLAS_LANGUAGES) {
  const dirs=await readdir(path.join(root,`data_${folder}`),{withFileTypes:true})
  for(const d of dirs.filter(d=>d.isDirectory())) result.push({source_uid:`atlas:${lang}:${d.name}`,provider:'atlas',source_language:lang,set_id:d.name,name:`${d.name} · archivio ufficiale ${localLanguage}`})
 }
 return result
}
export async function atlasCards(root,set) {
 const entry=ATLAS_LANGUAGES.find(([,lang])=>lang===set.source_language)
 if(!entry || ['.','..'].includes(set.set_id) || !/^[^/\\]+$/.test(set.set_id))throw Error('Set archivio non valido')
 const dir=path.join(root,`data_${entry[0]}`,set.set_id)
 const files=(await readdir(dir)).filter(f=>f.endsWith('.json')).sort()
 const cards=[]
 for(const filename of files) {
  const data=JSON.parse(await readFile(path.join(dir,filename),'utf8'))
  const validLanguage=data.lang===entry[0] || data.lang===entry[1] || entry[0]==='jp' && data.jp_id
  if(!data.name || !validLanguage)continue
  if(data.set_name && normalizedSet(data.set_name)!==normalizedSet(set.set_id))continue
  // Some upstream files use `image`; current Card Atlas schema uses `img`.
  const image=data.img || data.image || null
  const allowed={jp:'www.pokemon-card.com',ko:'cards.image.pokemonkorea.co.kr',tc:'asia.pokemon-card.com'}
  if(image){try{const url=new URL(image);if(url.protocol!=='https:' || url.hostname!==allowed[entry[0]])continue}catch{continue}}
  cards.push({id:`${set.set_id}-${filename.slice(0,-5)}`,localId:data.number ? String(data.number) : `UNNUMBERED:${filename.slice(0,-5)}`,name:data.name,image,sourcePage:data.url || null,localLanguage:entry[2]})
 }
 return cards
}
export function externalRecord(card,set) {
 return {source_uid:`atlas:${set.source_language}:${card.id}`,provider:`atlas-official-${set.source_language}`,language:card.localLanguage,set_code:normalizedSet(set.set_id),local_id:normalizedNumber(card.localId),name:card.name,image_url:card.image,page_url:card.sourcePage,updated_at:new Date().toISOString()}
}
export async function importAtlasSet({db,set,root,loadCards=atlasCards,newCard,summary,deadline,log=async()=>{}}) {
 const check=async q=>{const{data,error}=await q;if(error)throw Error(error.message);return data}
 const cards=await loadCards(root,set)
 await log(`Card Atlas ${set.set_id}: ${cards.length} carte da confrontare.`)
 if(!cards.length)throw Error('Archivio senza carte utilizzabili')
 const records=cards.map(c=>externalRecord(c,set))
 for(let i=0;i<records.length;i+=300)await check(db.from('catalog_external_cards').upsert(records.slice(i,i+300),{onConflict:'source_uid'}))
 const language=cards[0].localLanguage
 const names=[set.set_id,set.set_id.toUpperCase(),`${set.set_id}@${language}`,`${set.set_id.toUpperCase()}@${language}`]
 const existing=[]
 for(let offset=0;;offset+=500){const rows=await check(db.from('cards').select('*').eq('lingua',language).in('sigla',names).range(offset,offset+499));existing.push(...rows);if(rows.length<500)break}
 let ambiguous=0
 for(const card of cards){
  if(Date.now()>deadline-120000)throw Error('Budget archivio raggiunto; ripresa alla prossima esecuzione')
  const uid=`atlas:${set.source_language}:${card.id}`
  if(existing.some(c=>c.source_uid===uid))continue
  const number=normalizedNumber(card.localId)
  const matches=existing.filter(c=>normalizedNumber(c.source_local_id || c.numero)===number && ['normale','normal',''].includes(c.variante || ''))
  const repeated=cards.filter(c=>normalizedNumber(c.localId)===number).length>1
  if(matches.length>1 || matches.length && repeated){ambiguous++;summary.ambiguous++;await log(`Ambigua: ${card.name} · ${card.localId}, lasciata da verificare.`);continue}
  const match=matches[0]
  if(match && !match.source_uid){
   await check(db.from('cards').update({source_uid:uid,source_card_id:card.id,source_language:set.source_language,source_local_id:card.localId}).eq('id',match.id).is('source_uid',null).select('id').single())
   match.source_uid=uid;summary.linked++
   await log(`Collegata: ${card.name} · ${set.set_id}/${card.localId} · ${language}.`)
  }else if(match && !match.source_uid.startsWith('atlas:')){
   // Exact regional set/number already imported from TCGdex: attach alternative in the index, keep primary identity.
   summary.alternatives=(summary.alternatives || 0)+1
  }else{
   const row={...newCard(card,set.set_id,set.source_language,language),source_uid:uid,file_name:`${set.set_id}_${language}_${card.id.replace(/[^a-z0-9-]/gi,'_')}.jpg`,notes:`Importazione archivio ${set.source_language}. Fonte: ${card.sourcePage || 'Card Atlas'}`}
   await check(db.from('cards').upsert(row,{onConflict:'source_uid',ignoreDuplicates:true}))
   existing.push(row);summary.added++
   await log(`Inserita: ${card.name} · ${set.set_id}/${card.localId} · ${language}.`)
  }
 }
 await check(db.from('catalog_sync_sets').update({last_sync_at:new Date().toISOString(),next_sync_at:new Date(Date.now()+7*86400000).toISOString(),card_count:cards.length,last_error:ambiguous?`${ambiguous} numeri ripetuti: variante da verificare.`:null}).eq('source_uid',set.source_uid))
 summary.processedSets++
}
