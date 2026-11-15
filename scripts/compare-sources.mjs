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
 const names=[...left.keys].filter(([key,items])=>items.length===1&&right.keys.get(key)?.length===1&&items[0].normalized!==right.keys.get(key)[0].normalized).map(([number,items])=>({number,primary:items[0].name,secondary:right.keys.get(number)[0].name}))
 const ambiguous=left.invalid.length+right.invalid.length+left.duplicates.length+right.duplicates.length>0
 const status=ambiguous||(!primary.length&&!secondary.length)?'uncomparable':onlyPrimary.length||onlySecondary.length||names.length?'differences':'concordant'
 const fingerprint=data=>digest([...data.keys].map(([n,items])=>[n,items.map(i=>i.normalized).sort()]).sort((a,b)=>a[0].localeCompare(b[0],'en')))
 return {status,primary_count:primary.length,secondary_count:secondary.length,only_primary_count:onlyPrimary.length,only_secondary_count:onlySecondary.length,name_difference_count:names.length,
  only_primary:onlyPrimary.slice(0,20),only_secondary:onlySecondary.slice(0,20),name_differences:names.slice(0,20),duplicate_primary:left.duplicates.slice(0,20),duplicate_secondary:right.duplicates.slice(0,20),unnumbered_primary:left.invalid.length,unnumbered_secondary:right.invalid.length,
  primary_digest:fingerprint(left),secondary_digest:fingerprint(right),scope:'base_card_lists',independence_status:'unestablished',variants_status:'unverified',
  reason:ambiguous?'Numeri ripetuti, assenti o nomi mancanti: abbinamento delle stampe non determinabile.':!primary.length&&!secondary.length?'Due elenchi vuoti non dimostrano copertura.':status==='differences'?'Gli elenchi delle due fonti differiscono: controllare numeri e nomi.':'Numeri e nomi concordano fra questi elenchi; identità delle varianti e indipendenza delle fonti non certificate.'}
}
const check=async q=>{const{data,error}=await q;if(error)throw Error(error.message);return data}
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
  const result=compareCardLists(detail.cards,secondary.map(c=>({id:c.source_uid,localId:c.local_id,name:c.name})))
  if(pair.secondary_error){result.status='uncomparable';result.reason='L’archivio secondario segnala un’ambiguità: '+pair.secondary_error}
  result.secondary_snapshot_at=pair.secondary_checked_at
  await save({status:result.status,result,last_error:null,last_success_at:at,next_check_at:new Date(clock()+(result.status==='differences'?86400000:7*86400000)).toISOString()})
  return result
 }catch(error){await save({status:'error',result:pair.result||{},last_success_at:pair.last_success_at||null,last_error:String(error),next_check_at:new Date(clock()+6*3600000).toISOString()});return {status:'error',reason:String(error)}}
}
