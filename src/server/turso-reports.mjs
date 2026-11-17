const cache=new WeakMap()
const compare=(a,b)=>String(a??'')<String(b??'')?-1:String(a??'')>String(b??'')?1:0
async function allRows(client,name){
 let tables=cache.get(client);if(!tables){tables=new Map();cache.set(client,tables)}
 const saved=tables.get(name);if(saved&&Date.now()<saved.until)return saved.promise
 if(!/^[a-z][a-z0-9_]*$/.test(name))throw Error('Invalid report table')
 const promise=(async()=>{const rows=[];let after=0;for(;;){const page=(await client.execute({sql:'SELECT _row,_position FROM "_copy_'+name+'" WHERE _position>? ORDER BY _position LIMIT 500',args:[after]})).rows;rows.push(...page.map(r=>JSON.parse(r._row)));if(page.length<500)break;after=Number(page.at(-1)._position)}return rows})()
 tables.set(name,{until:Date.now()+30000,promise});try{return await promise}catch(error){tables.delete(name);throw error}
}
export async function coverageRegister(client,now=Date.now()){
 const [sets,languages,releases]=await Promise.all([allRows(client,'catalog_sync_sets'),allRows(client,'catalog_language_sources'),allRows(client,'catalog_releases')]),languageMap=new Map(languages.map(l=>[l.source_language,l]))
 const rows=sets.filter(s=>s.set_id!=='__index__').map(s=>{
  const l=languageMap.get(s.source_language),stale=!s.coverage_checked_at||Date.parse(s.coverage_checked_at)<now-8*86400000
  const mismatch=s.manifest_count!==s.resolved_count||s.manifest_digest!==s.resolved_digest
  const status=s.coverage_scope==='digital'?'excluded':!s.last_sync_at?'to_import':s.last_error||s.coverage_scope!=='physical'||stale||s.manifest_count==null||s.manifest_count===0||mismatch||s.manifest_digest==null||s.reported_count!=null&&s.reported_count!==s.manifest_count?'to_review':'aligned'
  const reason=s.coverage_scope==='digital'?'Pokémon TCG Pocket escluso dal catalogo fisico.':s.last_error||(!s.last_sync_at?'Prima importazione non completata.':!s.coverage_checked_at?'Importazione precedente: confronto degli identificativi ancora da registrare.':s.coverage_scope!=='physical'?'Ambito fisico/digitale da classificare.':stale?'Confronto da aggiornare.':mismatch?'Identificativi mancanti o discordanti rispetto all’elenco della fonte.':s.reported_count!=null&&s.reported_count!==s.manifest_count?'Quantità dichiarata ed elenco della fonte discordanti.':'Elenco delle carte confrontato con questa fonte; tutte le varianti non sono certificate.')
  return {target_key:s.source_uid,target_type:'set',provider:s.provider,source_language:s.source_language,language_label:l?.label??s.source_language,region:l?.region??'Da documentare',release_code:s.set_id,name:s.name,coverage_scope:s.coverage_scope,expected_count:s.reported_count??s.manifest_count,resolved_count:s.resolved_count,checked_at:s.coverage_checked_at,next_sync_at:s.next_sync_at,status,reason,source_url:s.provider==='tcgdex'?'https://api.tcgdex.net/v2/'+s.source_language+'/sets/'+s.set_id:'https://github.com/type-null/PTCG-database',variants_status:'unverified'}
 })
 for(const l of languages){
  const sets=rows.filter(r=>r.provider==='tcgdex'&&r.coverage_scope!=='digital'&&r.source_language===l.source_language)
  const status=['unprobed','empty','error'].includes(l.probe_status)?'not_covered':!sets.length||sets.some(s=>s.status==='to_import')?'to_import':'to_review'
  const reason=l.probe_status==='error'?l.last_error||'Fonte non disponibile al controllo.':['unprobed','empty'].includes(l.probe_status)?'Nessun elenco utilizzabile verificato.':!sets.length?'Elenco disponibile: espansioni da scoprire nel prossimo worker aggiornato.':'Percorso linguistico registrato; conteggi in espansioni. La copertura mondiale e le varianti restano da confrontare.'
  rows.push({target_key:'language:'+l.source_language,target_type:'language',provider:'tcgdex',source_language:l.source_language,language_label:l.label,region:l.region,release_code:null,name:l.label,coverage_scope:'physical',expected_count:l.listed_sets,resolved_count:sets.length,checked_at:l.last_probe_at,next_sync_at:null,status,reason,source_url:l.source_url,variants_status:'unverified'})
 }
 for(const r of releases)rows.push({target_key:'release:'+r.code,target_type:'release',provider:'curated',source_language:'und',language_label:'Lingue da verificare',region:'Distribuzione promozionale',release_code:r.code,name:r.name,coverage_scope:'physical',expected_count:null,resolved_count:null,checked_at:null,next_sync_at:null,status:'to_review',reason:'Distribuzione registrata: elenco, lingue e varianti da confrontare con fonti indipendenti.',source_url:r.source_url,variants_status:'unverified'})
 return {rows,languages,sets}
}
function stats(rows){const result={};for(const r of rows)result[r.status]=(result[r.status]||0)+1;return result}
const pageOptions=p=>({limit:Math.min(Math.max(Number(p.page_size)||25,1),100),offset:Math.max(Number(p.page_offset)||0,0)})
export async function coverageReport(client,p={}){
 const data=await coverageRegister(client),query=String(p.query_text||'').toLowerCase(),{limit,offset}=pageOptions(p)
 const filtered=data.rows.filter(r=>(p.wanted_status==null||r.status===p.wanted_status)&&(p.wanted_language==null||r.source_language===p.wanted_language)&&(p.wanted_provider==null||r.provider===p.wanted_provider)&&(!query||String(r.name||'').toLowerCase().includes(query)||String(r.release_code||'').toLowerCase().includes(query)))
 filtered.sort((a,b)=>compare(a.target_type,b.target_type)||compare(a.source_language,b.source_language)||compare(a.name,b.name)||compare(a.target_key,b.target_key))
 return {generated_at:new Date().toISOString(),scope:'Carte fisiche; allineamento agli elenchi delle fonti, non certificazione di tutte le varianti.',stats:stats(data.rows),total:filtered.length,rows:filtered.slice(offset,offset+limit),languages:data.languages.sort((a,b)=>compare(a.label,b.label))}
}
export async function crossSourceReport(client,p={}){
 const [sets,languages,comparisons]=await Promise.all([allRows(client,'catalog_sync_sets'),allRows(client,'catalog_language_sources'),allRows(client,'catalog_source_comparisons')]),langs=new Map(languages.map(l=>[l.source_language,l.label])),saved=new Map(comparisons.map(c=>[c.primary_uid+'|'+c.secondary_uid,c])),secondary=new Map()
 for(const b of sets.filter(s=>s.provider==='atlas'&&s.coverage_scope!=='digital')){const key=b.source_language+'|'+b.set_id.toLowerCase();secondary.set(key,[...(secondary.get(key)||[]),b])}
 const rows=[]
 for(const a of sets.filter(s=>s.provider==='tcgdex'&&s.set_id!=='__index__'&&s.coverage_scope!=='digital'))for(const b of secondary.get(a.source_language+'|'+a.set_id.toLowerCase())||[]){
  const pair_key=a.source_uid+'|'+b.source_uid,c=saved.get(pair_key)
  rows.push({pair_key,primary_uid:a.source_uid,secondary_uid:b.source_uid,source_language:a.source_language,language_label:langs.get(a.source_language)??a.source_language,primary_set:a.set_id,secondary_set:b.set_id,name:a.name,status:c?.status??'pending',checked_at:c?.checked_at??null,next_check_at:c?.next_check_at??null,last_success_at:c?.last_success_at??null,result:c?.result??{},last_error:c?.last_error??null,secondary_checked_at:b.last_sync_at,secondary_expected_count:b.card_count,secondary_error:b.last_error,primary_url:'https://api.tcgdex.net/v2/'+a.source_language+'/sets/'+a.set_id,secondary_url:'https://github.com/type-null/PTCG-database',match_basis:'same_language_and_set_code',independence_status:'unestablished',variants_status:'unverified'})
 }
 const filtered=rows.filter(r=>p.wanted_status==null||r.status===p.wanted_status),order={differences:0,uncomparable:1,error:2,concordant:3,pending:4};filtered.sort((a,b)=>(order[a.status]??4)-(order[b.status]??4)||compare(a.pair_key,b.pair_key))
 const offset=Math.max(Number(p.page_offset)||0,0);return {stats:stats(rows),total:filtered.length,rows:filtered.slice(offset,offset+20)}
}
export async function coverageAuditReport(client,p={}){
 const [data,snapshots]=await Promise.all([coverageRegister(client),allRows(client,'catalog_coverage_snapshots')]),report=snapshots.find(s=>s.scope==='latest')?.report??null,observed=new Map((report?.groups||[]).map(o=>[[o.source_provider,o.origin_language,o.origin_set].join('|'),o])),meta=new Map(),langs=new Map(data.languages.map(l=>[l.source_language,l.label])),registry=new Map(data.rows.filter(r=>r.target_type==='set').map(r=>[r.target_key,r]))
 const ordered=[...data.sets].filter(s=>s.set_id!=='__index__').sort((a,b)=>compare(a.provider,b.provider)||compare(a.source_language,b.source_language)||compare(a.set_id.toLowerCase(),b.set_id.toLowerCase())||compare(b.coverage_checked_at??'',a.coverage_checked_at??'')||compare(a.source_uid,b.source_uid))
 for(const s of ordered){const key=[s.provider,s.source_language,s.set_id.toLowerCase()].join('|');if(!meta.has(key))meta.set(key,s)}
 const rows=[],countFields=['cards','reference_missing','placeholder','source_printings','inventory_entries','printing_entries','unidentified_entries','pending_identity','missing_exact','candidate_exact','verified_exact','unknown_language']
 for(const key of new Set([...meta.keys(),...observed.keys()])){
  const m=meta.get(key),o=observed.get(key);if(m?.coverage_scope==='digital')continue
  const r=m?registry.get(m.source_uid):null,provider=m?.provider??o.source_provider,language=m?.source_language??o.origin_language,set=m?.set_id.toLowerCase()??o.origin_set,d=m?.coverage_detail||{}
  const equal=m?.manifest_digest!=null&&m.manifest_digest===m.resolved_digest
  const missing=typeof d.missing_count==='number'?d.missing_count:equal?0:null,unexpected=typeof d.unexpected_count==='number'?d.unexpected_count:d.comparison_scope==='expected_source_links'?null:equal?0:null
  const row={target_key:m?.source_uid??'['+[provider,language,set].map(JSON.stringify).join(', ')+']',provider,source_language:language,language_label:langs.get(language)??'Lingua non determinata',source_set:set,name:m?.name??set,status:r?.status??'unregistered',reason:(r?.reason??'Voci importate: manca un elenco di riferimento abbinato con certezza.')+(m?.manifest_last_error?' Ultimo confronto rinviato: '+m.manifest_last_error:''),source_url:r?.source_url??null,reported_count:m?.reported_count??null,manifest_count:m?.manifest_count??null,resolved_count:m?.resolved_count??null,checked_at:m?.coverage_checked_at??null,missing_count:missing,unexpected_count:unexpected,coverage_detail:m?.coverage_detail??null,manifest_last_attempt_at:m?.manifest_last_attempt_at??null,manifest_last_error:m?.manifest_last_error??null}
  for(const field of countFields)row[field]=report&&(o||['tcgdex','atlas'].includes(provider))?o?.[field]??0:null
  rows.push(row)
 }
 const query=String(p.query_text||'').toLowerCase(),{limit,offset}=pageOptions(p),filtered=rows.filter(r=>(p.wanted_language==null||r.source_language===p.wanted_language)&&(p.wanted_provider==null||r.provider===p.wanted_provider)&&(!query||String(r.name||'').toLowerCase().includes(query)||r.source_set.toLowerCase().includes(query))&&(p.wanted_issue==null||p.wanted_issue==='cards'&&(r.missing_count>0||r.unexpected_count>0)||p.wanted_issue==='unchecked'&&r.missing_count==null||p.wanted_issue==='identity'&&(r.pending_identity>0||r.unidentified_entries>0)||p.wanted_issue==='photos'&&r.missing_exact>0))
 const rank=r=>r.missing_count>0||r.unexpected_count>0?0:r.pending_identity>0?1:r.missing_exact>0?2:r.missing_count==null?3:4
 filtered.sort((a,b)=>rank(a)-rank(b)||compare(a.source_language,b.source_language)||compare(a.provider,b.provider)||compare(a.source_set,b.source_set)||compare(a.target_key,b.target_key))
 const snapshot=report?Object.fromEntries(Object.entries(report).filter(([k])=>k!=='groups')):null
 return {generated_at:new Date().toISOString(),snapshot,stats:{lists:rows.length,unmeasured:rows.filter(r=>r.missing_count==null).length,known_missing_ids:rows.reduce((n,r)=>n+(r.missing_count||0),0),identity_lists:rows.filter(r=>r.pending_identity>0||r.unidentified_entries>0).length,photo_lists:rows.filter(r=>r.missing_exact>0).length},total:filtered.length,rows:filtered.slice(offset,offset+limit),languages:data.languages.map(l=>({source_language:l.source_language,label:l.label})).sort((a,b)=>compare(a.label,b.label)),providers:[...new Set(rows.map(r=>r.provider))].sort()}
}
