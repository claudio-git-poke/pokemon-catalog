import {CatalogRestError,readCatalogRows} from './turso-rest.mjs'
import {canonicalJson,hash} from '../../scripts/turso-snapshot.mjs'

const FIELDS=new Set('file_name nome sigla lingua numero variante codice link_cardmarket image_url image_status image_source notes'.split(' '))
const AUTOMATIC=new Set(['image_url','image_status','image_source','notes'])
const PHOTO=['image_url','image_status','image_source']
const own=(value,key)=>Object.hasOwn(value,key)
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)
async function writeTransaction(client,operation){
 const tx=await client.transaction('write')
 try{const value=await operation(tx);await tx.commit();return value}
 catch(error){await tx.rollback();throw error}
 finally{tx.close()}
}
async function saveRow(tx,row,patch,mode,reason){
 const next={...row,...patch,updated_at:new Date().toISOString()}
 // The form can submit stale copies of unrelated locks. Merge only fields in
 // this edit, under the same write transaction as the current document read.
 next.manual_overrides=mode==='automatic'?row.manual_overrides:{...row.manual_overrides,...Object.fromEntries(Object.entries(patch).filter(([k])=>FIELDS.has(k)))}
 const key=JSON.stringify([row.id])
 await tx.execute({sql:'UPDATE _catalog_write_context SET mode=?,reason=? WHERE id=1',args:[mode,reason]})
 await tx.execute({sql:'UPDATE _copy_cards SET _row=? WHERE _key=?',args:[canonicalJson(next),key]})
 const saved=JSON.parse((await tx.execute({sql:'SELECT _row FROM _copy_cards WHERE _key=?',args:[key]})).rows[0]._row)
 await tx.execute({sql:'UPDATE _copy_cards SET _hash=? WHERE _key=?',args:[hash(canonicalJson(saved)),key]})
 await tx.execute("UPDATE _catalog_write_context SET mode='manual',reason=NULL WHERE id=1")
 return saved
}
export async function updateCard(client,schema,params,patch,mode='manual'){
 const id=params.get('id')?.match(/^eq\.(\d+)$/)?.[1]
 if(!id||!Number.isSafeInteger(Number(id))||Number(id)<1||[...params.keys()].some(k=>!['id','select'].includes(k)))throw new CatalogRestError('Specificare una sola carta tramite id.')
 if(!object(patch))throw new CatalogRestError('Modifica non valida.')
 const allowed=mode==='automatic'?AUTOMATIC:FIELDS,clean={}
 for(const [key,value]of Object.entries(patch)){
  if(key==='manual_overrides')continue
  if(!allowed.has(key))throw new CatalogRestError('Campo non modificabile: '+key,'42501',403)
  const column=schema.tables.find(t=>t.table_name==='cards').columns.find(c=>c.name===key)
  if(value===null&&!column.nullable||value!==null&&(key==='numero'?(!Number.isSafeInteger(value)||value<0):typeof value!=='string'||value.length>8000))throw new CatalogRestError('Valore non valido: '+key)
  if(key==='image_status'&&!['missing','placeholder','found','manual'].includes(value))throw new CatalogRestError('Stato immagine non valido.')
  clean[key]=value
 }
 if(!Object.keys(clean).length)throw new CatalogRestError('Nessun campo da modificare.')
 return writeTransaction(client,async tx=>{
  const result=await tx.execute({sql:'SELECT _row FROM _copy_cards WHERE _key=?',args:[JSON.stringify([Number(id)])]})
  if(!result.rows.length)return {rows:[]}
  await saveRow(tx,JSON.parse(result.rows[0]._row),clean,mode,'card_editor')
  return readCatalogRows(tx,schema,'cards',params)
 })
}
export async function protectCardFields(client,{target_card_id,field_names,expected_values}={}){
 if(!Number.isSafeInteger(target_card_id)||target_card_id<1||!Array.isArray(field_names)||!field_names.length||field_names.length>FIELDS.size||field_names.some(k=>!FIELDS.has(k))||!object(expected_values))throw new CatalogRestError('Seleziona i campi da proteggere.')
 const fields=[...new Set(field_names.some(k=>PHOTO.includes(k))?[...field_names,...PHOTO]:field_names)].sort()
 return writeTransaction(client,async tx=>{
  const record=(await tx.execute({sql:'SELECT _row FROM _copy_cards WHERE _key=?',args:[JSON.stringify([target_card_id])]})).rows[0]
  if(!record)throw new CatalogRestError('Carta non trovata o non accessibile.','P0001',404)
  const row=JSON.parse(record._row),patch={}
  for(const key of fields){
   if(!own(expected_values,key)||canonicalJson(expected_values[key])!==canonicalJson(row[key]))throw new CatalogRestError('Il campo '+key+' è cambiato: ricarica la carta prima di proteggerlo.','P0001',409)
   patch[key]=row[key]
  }
  const saved=await saveRow(tx,row,patch,'manual','confirm_existing_card_fields')
  return {id:saved.id,protected_fields:fields,manual_overrides:saved.manual_overrides}
 })
}
