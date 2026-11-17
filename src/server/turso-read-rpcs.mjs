import {CatalogRestError,qid} from './turso-rest.mjs'
import {normalizeCatalog,catalogNumber,utcTimestamp,utcSortSql} from './turso-values.mjs'
export async function identifyCards(client,{tokens=[],required_tags=[],card_number=null,card_denominator=null,wanted_year=null,wanted_language=null,observations={},page_offset=0,page_size=24}={}){
 if(!Array.isArray(tokens)||tokens.length>20||tokens.some(t=>typeof t!=='string')||!Array.isArray(required_tags)||required_tags.length>100||required_tags.some(t=>typeof t!=='string'))throw new CatalogRestError('Filtri non validi.')
 const limit=Math.min(Math.max(Number(page_size)||24,1),48),offset=Math.min(Math.max(Number(page_offset)||0,0),10000),args=[],bind=v=>{args.push(v);return '?'}
 const known=Object.fromEntries(Object.entries(observations||{}).filter(([k,v])=>/^[a-z][a-z0-9_]*$/.test(k)&&typeof v==='boolean'))
 const observation=bind(JSON.stringify(known)),where=[]
 const query=tokens.map(normalizeCatalog).filter(Boolean).map(t=>'"'+t.replaceAll('"','""')+'"*').join(' AND ')
 if(query)where.push(`e._entry_rowid IN(SELECT rowid FROM _catalog_entry_fts WHERE _catalog_entry_fts MATCH ${bind(query)})`)
 for(const tag of required_tags)where.push(`e._entry_rowid IN(SELECT entry_rowid FROM _catalog_entry_tags WHERE tag=${bind(tag)})`)
 for(const [field,value]of [['collector_number',card_number==null?null:catalogNumber(card_number)],['denominator',card_denominator],['release_year',wanted_year],['language',wanted_language]])if(value!=null)where.push('e.'+field+'='+bind(value))
 const sql=`WITH observations AS(SELECT key,value FROM json_each(${observation})),candidates AS MATERIALIZED(
 SELECT e.entry_key,e.card_id,e.verification,e._row,c.image_url reference_image_url,c.image_status,e.facts known_facts,
 (SELECT count(*) FROM observations o WHERE json_type(e.facts,'$.'||json_quote(o.key))=CASE o.value WHEN 1 THEN 'true' ELSE 'false' END) matched,
 (SELECT count(*) FROM observations o WHERE json_type(e.facts,'$.'||json_quote(o.key)) IS NOT NULL AND json_type(e.facts,'$.'||json_quote(o.key))<>CASE o.value WHEN 1 THEN 'true' ELSE 'false' END) contradicted,
 (SELECT count(*) FROM observations o WHERE json_type(e.facts,'$.'||json_quote(o.key)) IS NULL) unknown
 FROM catalog_search_entries e JOIN cards c ON c.id=e.card_id WHERE ${where.join(' AND ')||'1'}
 ),deduplicated AS MATERIALIZED(SELECT * FROM candidates r WHERE r.verification<>'catalog' OR NOT EXISTS(SELECT 1 FROM candidates p WHERE p.card_id=r.card_id AND p.verification<>'catalog')),
 page AS(SELECT *,matched*3-contradicted*4 score FROM deduplicated ORDER BY score DESC,CASE verification WHEN 'reviewed' THEN 2 WHEN 'source' THEN 1 ELSE 0 END DESC,card_id,entry_key LIMIT ${bind(limit)} OFFSET ${bind(offset)})
 SELECT (SELECT count(*) FROM deduplicated) total,p.* FROM page p`
 const rows=(await client.execute({sql,args})).rows
 const results=rows.map(r=>{const {search_vector,search_text,source_payload,...row}=JSON.parse(r._row);return {...row,reference_image_url:r.reference_image_url,image_status:r.image_status,known_facts:JSON.parse(r.known_facts||'{}'),matched:Number(r.matched),contradicted:Number(r.contradicted),unknown:Number(r.unknown),score:Number(r.score)}})
 if(rows.length)return {total:Number(rows[0].total),results}
 // An empty page past the end still needs the correct total.
 const countSql=sql.slice(0,sql.indexOf(',\n page AS'))+' SELECT count(*) total FROM deduplicated'
 return {total:Number((await client.execute({sql:countSql,args:args.slice(0,-2)})).rows[0].total),results}
}
const FEEDS={cards:{table:'set_carte',keys:['sigla','numero','variante'],fields:['sigla','numero','variante','nome','rarita','codice','cardmarket_id','cardmarket_url','immagine','immagine_hd','tag','aggiornato_il','eliminata']},sets:{table:'set_espansioni',keys:['sigla'],fields:['sigla','tcgdex_id','nome','carte_base','carte_totali','data_uscita','lingua','aggiornato_il']},photos:{table:'set_carte_immagini',keys:['sigla','numero','variante','lingua'],fields:['sigla','numero','variante','lingua','immagine','immagine_hd','fonte','aggiornato_il']}}
export async function bindexExportPage(client,{kind='cards',after_time='1970-01-01',after_key=[],until_time=null,page_size=1000}={},now=Date.now()){
 const feed=FEEDS[kind];if(!feed||!Array.isArray(after_key)||![0,feed.keys.length].includes(after_key.length))throw new CatalogRestError('Tipo o cursore di esportazione non valido.')
 const after=utcTimestamp(after_time),cutoff=utcTimestamp(new Date(now-60000).toISOString()),until=until_time?utcTimestamp(until_time)<cutoff?utcTimestamp(until_time):cutoff:cutoff
 const limit=Math.min(Math.max(Number(page_size)||1000,1),1000),time=utcSortSql('aggiornato_il'),keys=feed.keys.map(k=>qid(k)),cursor=feed.keys.map((k,i)=>k==='numero'?Number(after_key[i]??0):String(after_key[i]??''))
 if(cursor.some(v=>typeof v==='number'&&!Number.isSafeInteger(v)))throw new CatalogRestError('Chiave del cursore non valida.')
 const tuple=keys.length===1?keys[0]:'('+keys.join(',')+')',values=keys.length===1?'?':'('+keys.map(()=>'?').join(',')+')'
 const rows=(await client.execute({sql:`SELECT _row FROM ${qid(feed.table)} WHERE (${time}>? OR (${time}=? AND ${tuple}>${values})) AND ${time}<=? ORDER BY ${time},${keys.join(',')} LIMIT ?`,args:[after,after,...cursor,until,limit]})).rows.map(r=>JSON.parse(r._row))
 const items=rows.map(r=>Object.fromEntries(feed.fields.map(k=>[k,r[k]??null]))),last=rows.at(-1)
 return {contract:'bindex-v1',kind,until,items,next_cursor:last?{time:last.aggiornato_il,key:feed.keys.map(k=>last[k])}:null,complete:rows.length<limit}
}
export async function bindexPrintingPage(client,{after_time='1970-01-01',after_key='',until_time=null,page_size=200}={},now=Date.now()){
 const after=utcTimestamp(after_time),cutoff=utcTimestamp(new Date(now-60000).toISOString()),until=until_time?utcTimestamp(until_time)<cutoff?utcTimestamp(until_time):cutoff:cutoff,limit=Math.min(Math.max(Number(page_size)||200,1),500),time=utcSortSql('updated_at')
 if(typeof after_key!=='string')throw new CatalogRestError('Cursore inventario non valido.')
 const rows=(await client.execute({sql:`SELECT _row FROM catalog_printing_inventory WHERE (${time}>? OR (${time}=? AND record_key>?)) AND ${time}<=? ORDER BY ${time},record_key LIMIT ?`,args:[after,after,after_key,until,limit]})).rows.map(r=>JSON.parse(r._row))
 const items=rows.map(r=>{const {canonical_sigla,canonical_numero,canonical_variante,source_entry_key,...item}=r;return {...item,canonical_key:canonical_sigla!=null?{sigla:canonical_sigla,numero:canonical_numero,variante:canonical_variante}:null,canonical_mapping_status:r.canonical_mapping_status}}),last=rows.at(-1)
 return {contract:'bindex-printings-v1',record_type:'source_evidence',until,items,next_cursor:last?{time:last.updated_at,key:last.record_key}:null,complete:rows.length<limit}
}
export async function bindexContractReport(client){
 const invalidCode="codice IS NOT NULL AND (length(codice)=0 OR substr(codice,1,1) NOT GLOB '[A-Z0-9]' OR codice GLOB '*[^A-Z0-9. -]*' OR length(codice)-length(replace(codice,' ',''))>1 OR (instr(codice,' ')>0 AND (substr(codice,instr(codice,' ')+1)='' OR substr(codice,instr(codice,' ')+1) GLOB '*[^A-Z0-9]*')))"
 const invalidVariant="variante IS NULL OR variante='' OR variante GLOB '*[^a-z0-9-]*' OR substr(variante,1,1)='-' OR substr(variante,-1)='-' OR instr(variante,'--')>0"
 const prefix='https://www.cardmarket.com/it/Pokemon/Products/'
 const invalidMarket=`cardmarket_url IS NOT NULL AND (substr(cardmarket_url,1,${prefix.length})<>'${prefix}' OR length(cardmarket_url)<=${prefix.length} OR instr(cardmarket_url,'?')>0 OR instr(cardmarket_url,'#')>0)`
 const row=(await client.execute(`SELECT count(*) cards,sum(CASE WHEN nome IS NULL OR trim(nome)='' OR numero<=0 OR (${invalidVariant}) OR (${invalidCode}) OR (${invalidMarket}) THEN 1 ELSE 0 END) blocking,sum(codice IS NULL) missing_code,count(cardmarket_url) canonical_cardmarket_pages,count(cardmarket_id) cardmarket_ids,sum(eliminata=1) tombstones FROM set_carte`)).rows[0]
 return {contract:'bindex-v1',...Object.fromEntries(Object.entries(row).map(([k,v])=>[k,Number(v||0)])),checked_at:new Date().toISOString()}
}
export async function variantCoverage(client){
 const terms=(await client.execute('SELECT _row FROM catalog_terms ORDER BY kind,label')).rows.map(r=>JSON.parse(r._row))
 const counts=new Map((await client.execute("SELECT j.value code,count(*) n FROM catalog_search_entries e,json_each(e.tags)j WHERE e.verification<>'catalog' GROUP BY j.value")).rows.map(r=>[r.code,Number(r.n)]))
 const indexed=Number((await client.execute("SELECT count(*) n FROM catalog_search_entries WHERE verification<>'catalog'")).rows[0].n),pending=Number((await client.execute('SELECT count(*) n FROM cards WHERE source_card_id IS NOT NULL AND traits_checked_at IS NULL')).rows[0].n)
 return {terms:terms.map(t=>({code:t.code,label:t.label,kind:t.kind,count:counts.get(t.code)||0})),indexed_printings:indexed,pending_cards:pending}
}
