import {sourceUid} from './catalog-core.mjs'
import {createHash} from 'node:crypto'
import {CATALOG_LANGUAGES} from '../src/lib/catalog-languages.ts'
export const printedNumber=value=>String(value??'').normalize('NFC').split('/')[0].trim().toUpperCase().replace(/^0+(?=\d)/,'')
const printedName=value=>typeof value==='string'?value.normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase():''
const digest=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex')
export function compareCardLists(primary,secondary){
 const inspect=rows=>{const keys=new Map(),invalid=[];for(const row of rows){const key=printedNumber(row.localId),name=printedName(row.name);if(!key||key==='0'||key.startsWith('UNNUMBERED:')||!name){invalid.push(String(row.id||key));continue}const items=keys.get(key)||[];items.push({name:row.name,normalized:name,id:row.id});keys.set(key,items)}return {keys,invalid,duplicates:[...keys].filter(([,items])=>items.length>1).map(([number,items])=>({number,count:items.length}))}}
 const left=inspect(primary),right=inspect(secondary)
 const onlyPrimary=[...left.keys].filter(([key])=>!right.keys.has(key)).map(([number,items])=>({number,name:items[0].name}))
 const onlySecondary=[...right.keys].filter(([key])=>!left.keys.has(key)).map(([number,items])=>({number,name:items[0].name}))
 const names=[...left.keys].filter(([key,items])=>items.length===1&&right.keys.get(key)?.length===1&&items[0].normalized!==right.keys.get(key)[0].normalized).map(([number,items])=>({number,primary:items[0].name,secondary:right.keys.get(number)[0].name,kind:items[0].normalized.replace(/\s/g,'')===right.keys.get(number)[0].normalized.replace(/\s/g,'')?'spacing_only':'other'}))
 const ambiguous=left.invalid.length+right.invalid.length+left.duplicates.length+right.duplicates.length>0
 const status=ambiguous||(!primary.length&&!secondary.length)?'uncomparable':onlyPrimary.length||onlySecondary.length||names.length?'differences':'concordant'
 const fingerprint=data=>digest([...data.keys].map(([n,items])=>[n,items.map(i=>i.normalized).sort()]).sort((a,b)=>a[0].localeCompare(b[0],'en')))
 return {comparison_version:2,status,spacing_difference_count:names.filter(n=>n.kind==='spacing_only').length,other_name_difference_count:names.filter(n=>n.kind==='other').length,primary_count:primary.length,secondary_count:secondary.length,only_primary_count:onlyPrimary.length,only_secondary_count:onlySecondary.length,name_difference_count:names.length,
  only_primary:onlyPrimary.slice(0,20),only_secondary:onlySecondary.slice(0,20),name_differences:names.slice(0,20),duplicate_primary:left.duplicates.slice(0,20),duplicate_secondary:right.duplicates.slice(0,20),unnumbered_primary:left.invalid.length,unnumbered_secondary:right.invalid.length,
  primary_digest:fingerprint(left),secondary_digest:fingerprint(right),scope:'base_card_lists',independence_status:'unestablished',variants_status:'unverified',
  reason:ambiguous?'Numeri ripetuti, assenti o nomi mancanti: abbinamento delle stampe non determinabile.':!primary.length&&!secondary.length?'Due elenchi vuoti non dimostrano copertura.':status==='differences'?'Gli elenchi delle due fonti differiscono: controllare numeri e nomi.':'Numeri e nomi concordano fra questi elenchi; identità delle varianti e indipendenza delle fonti non certificate.'}
}
const check=async q=>{const{data,error}=await q;if(error)throw Error(error.message);return data}
// Exact source links only. A missing link does not prove a physical card is absent.
export async function auditPrimaryCatalogLinks({db,primary,secondary,language,clock=Date.now}){
 const valid=row=>{const n=printedNumber(row.localId);return n&&n!=='0'&&!n.startsWith('UNNUMBERED:')&&printedName(row.name)}
 const right=new Set(secondary.filter(valid).map(row=>printedNumber(row.localId))),groups=new Map()
 for(const row of primary.filter(valid)){
  const number=printedNumber(row.localId)
  if(!right.has(number)){const rows=groups.get(number)||[];rows.push(row);groups.set(number,rows)}
 }
 const idCounts=new Map()
 for(const rows of groups.values())for(const row of rows)if(row.id)idCounts.set(row.id,(idCounts.get(row.id)||0)+1)
 const candidates=[],unknown=[]
 for(const [number,rows] of groups){
  const row=rows[0]
  if(rows.length!==1||typeof row.id!=='string'||!row.id.trim()||idCounts.get(row.id)!==1)unknown.push({number,name:row.name})
  else candidates.push({number,name:row.name,source_id:row.id,source_uid:sourceUid(language,row.id)})
 }
 try{
  if(primary.length>2500)throw Error('Elenco oltre il limite del controllo dei collegamenti')
  const found=new Map()
  for(let offset=0;offset<candidates.length;offset+=200){
   const rows=await check(db.from('cards').select('id,source_uid').in('source_uid',candidates.slice(offset,offset+200).map(c=>c.source_uid)))
   for(const row of rows)found.set(row.source_uid,row.id)
  }
  const linked=candidates.filter(c=>found.has(c.source_uid)).map(c=>({...c,catalog_id:found.get(c.source_uid)})),notLinked=candidates.filter(c=>!found.has(c.source_uid))
  return {status:'checked',scope:'primary_only_exact_source_links',checked_at:new Date(clock()).toISOString(),checked:candidates.length,linked_count:linked.length,not_linked_count:notLinked.length,uncheckable_count:unknown.length,linked:linked.slice(0,20),not_linked:notLinked.slice(0,20),uncheckable:unknown.slice(0,20)}
 }catch(error){return {status:'unavailable',scope:'primary_only_exact_source_links',checked_at:null,error:String(error)}}
}
export async function compareSourcePair({db,pair,fetchSet,clock=Date.now}){
 const at=new Date(clock()).toISOString()
 const save=async patch=>check(db.from('catalog_source_comparisons').upsert({pair_key:pair.pair_key,primary_uid:pair.primary_uid,secondary_uid:pair.secondary_uid,checked_at:at,...patch},{onConflict:'pair_key'}))
 try{
  const local=CATALOG_LANGUAGES.find(l=>l.api===pair.source_language)?.code
  if(!local)throw Error('Lingua non configurata per il confronto')
  if(!pair.secondary_checked_at||clock()-Date.parse(pair.secondary_checked_at)>8*86400000)throw Error('Archivio secondario da aggiornare: confronto rinviato')
  const secondary=[]
  for(let offset=0;;offset+=500){const page=await check(db.from('catalog_external_cards').select('source_uid,local_id,name,page_url').eq('provider','atlas-official-'+pair.source_language).eq('language',local).eq('set_code',pair.secondary_set.toLowerCase()).order('source_uid').range(offset,offset+499));secondary.push(...page);if(page.length<500)break;if(secondary.length>=2500)throw Error('Elenco oltre il limite del confronto: richiede controllo dedicato')}
  if(secondary.length!==pair.secondary_expected_count)throw Error('Snapshot secondario incompleto o non coerente con il suo ultimo import')
  const detail=fetchSet?await fetchSet(pair):await(async()=>{const r=await fetch(pair.primary_url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('TCGdex HTTP '+r.status);return r.json()})()
  if(detail.id!==pair.primary_set||detail.serie?.id==='tcgp'||!Array.isArray(detail.cards))throw Error('Identità o ambito della fonte primaria discordante')
  if(detail.cards.length>2500)throw Error('Elenco primario oltre il limite del confronto')
  const secondaryCards=secondary.map(c=>({id:c.source_uid,localId:c.local_id,name:c.name}))
  const result=compareCardLists(detail.cards,secondaryCards)
  result.catalog_links=await auditPrimaryCatalogLinks({db,primary:detail.cards,secondary:secondaryCards,language:pair.source_language,clock})
  if(pair.secondary_error){result.status='uncomparable';result.reason='L’archivio secondario segnala un’ambiguità: '+pair.secondary_error}
  result.secondary_snapshot_at=pair.secondary_checked_at
  await save({status:result.status,result,last_error:null,last_success_at:at,next_check_at:new Date(clock()+(result.status==='differences'?86400000:7*86400000)).toISOString()})
  return result
 }catch(error){await save({status:'error',result:pair.result||{},last_success_at:pair.last_success_at||null,last_error:String(error),next_check_at:new Date(clock()+6*3600000).toISOString()});return {status:'error',reason:String(error)}}
}
