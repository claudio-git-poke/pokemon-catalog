import {readdir,readFile} from 'node:fs/promises'
import path from 'node:path'
const check=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
const text=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n))).replace(/&quot;/g,'"').replace(/&#0*39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim()
const block=(html,tag,cls)=>html.match(new RegExp(`<${tag}\\b[^>]*class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)</${tag}>`,'i'))?.[1]||''
export function sourceImage(value,lang){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null
 if(lang==='en')return u.hostname==='pkmncards.com'&&u.pathname.startsWith('/wp-content/uploads/')?u.href:null
 return u.hostname==='asia.pokemon-card.com'&&u.pathname.startsWith(`/${lang}/card-img/`)?u.href:null
 }catch{return null}
}
export function asiaList(html,lang){
 if(!['th','id'].includes(lang))throw Error('Lingua ufficiale non supportata')
 const raw=text(block(html,'p','resultNumber'))
 const total=/^\d+$/.test(raw)?Number(raw):NaN
 const ids=[...new Set([...html.matchAll(new RegExp(`/${lang}/card-search/detail/(\\d+)/`,'g'))].map(m=>m[1]))]
 if(!Number.isSafeInteger(total)||total<1||!ids.length||ids.length>20)throw Error('Elenco ufficiale cambiato o vuoto: avanzamento sospeso')
 return {total,pages:Math.ceil(total/20),ids}
}
export function asiaDetail(html,lang,id){
 if(!['th','id'].includes(lang)||!/^\d+$/.test(id))throw Error('Identità ufficiale non valida')
 const name=text(block(html,'h1','cardDetail').replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi,''))
 const image=sourceImage(block(html,'div','cardImage').match(/\bsrc=["']([^"']+)["']/i)?.[1],lang)
 const printed=text(block(html,'span','collectorNumber'))
 const section=block(html,'section','expansionLinkColumn')
 const codes=[...new Set([...section.matchAll(/expansionCodes=([^&"'\s<>]+)/g)].map(m=>decodeURIComponent(m[1])))]
 // Product codes come from the page, never from guesses about symbol filenames.
 if(!name||!image||codes.length!==1||!/^[-A-Za-z0-9_]+$/.test(codes[0]))throw Error('Scheda ufficiale incompleta o espansione ambigua')
 return {uid:`asia-official:${lang}:${id}`,lang,language:lang.toUpperCase(),set:codes[0],number:printed.split('/')[0]||null,denominator:printed.includes('/')?printed.split('/')[1]:null,name,image,url:`https://asia.pokemon-card.com/${lang}/card-search/detail/${id}/`,provider:`asia-official-${lang}`}
}
export function englishRecord(data,series,set,file){
 let u;try{u=new URL(data.url)}catch{return null}
 if(u.protocol!=='https:'||u.hostname!=='pkmncards.com'||!u.pathname.startsWith('/card/')||u.username||u.password||!data.name||data.set_name!==set||data.lang&&data.lang!=='en')return null
 const image=sourceImage(data.img||data.image,'en');if(!image)return null
 return {uid:`pkmncards:${series}:${set}:${file}`,lang:'en',language:'EN',set,number:data.number?String(data.number):null,denominator:data.set_total?String(data.set_total):null,name:data.name,image,url:u.href,provider:'pkmncards-via-atlas'}
}
export async function englishSets(root){
 const rows=[];let dirs;try{dirs=await readdir(path.join(root,'data_en'),{withFileTypes:true})}catch(e){if(e.code==='ENOENT')return rows;throw e}
 for(const series of dirs.filter(x=>x.isDirectory()))for(const set of (await readdir(path.join(root,'data_en',series.name),{withFileTypes:true})).filter(x=>x.isDirectory()))rows.push({source_uid:`supplement:en:${series.name}:${set.name}`,provider:'supplement-en',source_language:'en',set_id:JSON.stringify([series.name,set.name]),name:`PkmnCards · ${series.name} · ${set.name}`})
 return rows
}
export async function persistEvidence(db,records){
 if(!records.length)return {added:0,changed:0}
 const existing=await check(db.from('cards').select('id,source_uid').in('source_uid',records.map(r=>r.uid)))
 const known=new Map(existing.map(r=>[r.source_uid,r.id]))
 const missing=records.filter(r=>!known.has(r.uid))
 if(missing.length){const saved=await check(db.from('cards').upsert(missing.map(r=>({source_uid:r.uid,source_language:r.lang,source_local_id:r.number,source_card_id:null,nome:r.name,sigla:`${r.set.toUpperCase()}@${r.language}`,lingua:r.language,numero:Number.parseInt(r.number,10)||0,variante:'da-identificare',codice:`${r.set} ${r.number||''}`,file_name:r.uid.replace(/[^a-zA-Z0-9_-]/g,'_')+'.jpg',image_status:'found',image_url:r.image,image_source:r.provider,notes:`Immagine di riferimento della carta; finitura e stampini da verificare. Fonte: ${r.url}`})),{onConflict:'source_uid',ignoreDuplicates:true}).select('id,source_uid'))
 for(const row of saved)known.set(row.source_uid,row.id)
 // Recover a concurrent insert without overwriting its data.
 if(records.some(r=>!known.has(r.uid)))for(const row of await check(db.from('cards').select('id,source_uid').in('source_uid',records.map(r=>r.uid))))known.set(row.source_uid,row.id)
 }
 const entries=records.map(r=>({entry_key:r.uid,card_id:known.get(r.uid),name:r.name,set_code:r.set,language:r.language,collector_number:r.number,denominator:r.denominator,tags:[],facts:{},source_url:r.url,source_payload:{provider:r.provider,source_language:r.lang,metadata_scope:'card-metadata-only',reference_image_only:true},verification:'source',image_url:r.image,label:'Carta documentata · variante e foto della finitura da verificare',search_text:`${r.name} ${r.set} ${r.number||''}`.toLowerCase()}))
 const before=await check(db.from('catalog_search_entries').select('entry_key,name,set_code,language,collector_number,denominator,image_url,source_url,verification').in('entry_key',entries.map(r=>r.entry_key)))
 const byKey=new Map(before.map(r=>[r.entry_key,r]));const fields=['name','set_code','language','collector_number','denominator','image_url','source_url']
 const changed=entries.filter(e=>!byKey.has(e.entry_key)||(byKey.get(e.entry_key).verification!=='reviewed'&&fields.some(k=>byKey.get(e.entry_key)[k]!==e[k])))
 if(changed.length)await check(db.from('catalog_search_entries').upsert(changed.map(r=>({...r,updated_at:new Date().toISOString()})),{onConflict:'entry_key'}))
 return {added:missing.length,changed:changed.length}
}
export async function runSupplemental({db,root,budgetMs=8*60000,fetchHtml=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`Fonte HTTP ${r.status}`);return r.text()},log=console.log}){
 const deadline=Date.now()+budgetMs,now=()=>new Date().toISOString(),later=d=>new Date(Date.now()+d*86400000).toISOString(),stats={added:0,changed:0,pages:0,errors:0}
 const queue=[]
 if(root){
  const index=await check(db.from('catalog_sync_sets').select('next_sync_at').eq('source_uid','supplement:index:en').maybeSingle())
  if(!index?.next_sync_at||index.next_sync_at<=now())queue.push(...await englishSets(root))
 }
 for(const lang of ['th','id']){
  try{
   const index=await check(db.from('catalog_sync_sets').select('next_sync_at').eq('source_uid',`supplement:index:${lang}`).maybeSingle())
   if(index?.next_sync_at&&index.next_sync_at>now())continue
   const list=asiaList(await fetchHtml(`https://asia.pokemon-card.com/${lang}/card-search/list/?pageNo=1`),lang)
   await log(`Fonte ufficiale ${lang}: ${list.total} schede dichiarate, ${list.pages} pagine. Non sono un conteggio di varianti uniche.`,true)
   for(let page=1;page<=list.pages;page++)queue.push({source_uid:`supplement:${lang}:page:${page}`,provider:`supplement-${lang}`,source_language:lang,set_id:String(page),name:`Catalogo ufficiale ${lang} · pagina ${page}`})
   // Save index only after all page jobs are durable (below).
  }catch(error){stats.errors++;await log(`Indice ufficiale ${lang}: ${String(error)}`,true)}
 }
 for(let i=0;i<queue.length;i+=200)await check(db.from('catalog_sync_sets').upsert(queue.slice(i,i+200),{onConflict:'source_uid',ignoreDuplicates:true}))
 for(const lang of ['th','id','en'])if(queue.some(r=>r.source_language===lang))await check(db.from('catalog_sync_sets').upsert({source_uid:`supplement:index:${lang}`,provider:`supplement-${lang}`,source_language:lang,set_id:'__index__',name:`Indice ufficiale ${lang}`,next_sync_at:later(1),last_sync_at:now()},{onConflict:'source_uid'}))
 // Round-robin languages. Each page/set is checkpointed only after every record is saved.
 const jobs=[]
 for(const provider of ['supplement-th','supplement-id','supplement-en']){
  const rows=await check(db.from('catalog_sync_sets').select('*').eq('provider',provider).neq('set_id','__index__').lte('next_sync_at',now()).order('next_sync_at').order('source_uid').limit(20));jobs.push(rows)
 }
 for(let n=0;n<20;n++)for(const group of jobs){
  const job=group[n];if(!job)continue
  if(Date.now()>deadline-30000)return {...stats,deferred:true}
  try{
   let records=[],detailErrors=[]
   if(job.source_language==='en'){
    const [series,set]=JSON.parse(job.set_id)
    if(!root||![series,set].every(v=>typeof v==='string'&&v!=='.'&&v!=='..'&&!/[\\/]/.test(v)))throw Error('Percorso archivio inglese non valido')
    const dir=path.join(root,'data_en',series,set)
    for(const file of (await readdir(dir)).filter(f=>f.endsWith('.json')).sort()){
     const r=englishRecord(JSON.parse(await readFile(path.join(dir,file),'utf8')),series,set,file);if(r)records.push(r)
    }
    if(!records.length)throw Error('Nessuna scheda inglese valida')
   }else{
    const lang=job.source_language
    const list=asiaList(await fetchHtml(`https://asia.pokemon-card.com/${lang}/card-search/list/?pageNo=${job.set_id}`),lang)
    for(const id of list.ids){
     if(Date.now()>deadline-30000)return {...stats,deferred:true}
     await new Promise(resolve=>setTimeout(resolve,1000))
     try{records.push(asiaDetail(await fetchHtml(`https://asia.pokemon-card.com/${lang}/card-search/detail/${id}/`),lang,id))}catch(error){detailErrors.push(id);await log(`Scheda ufficiale ${lang}/${id}: ${String(error)}`,true)}
    }
   }
   for(let i=0;i<records.length;i+=100){const result=await persistEvidence(db,records.slice(i,i+100));stats.added+=result.added;stats.changed+=result.changed}
   if(detailErrors.length)throw Error(`${detailErrors.length} schede da riprovare: ${detailErrors.join(', ')}. Le altre sono state conservate.`)
   await check(db.from('catalog_sync_sets').update({last_sync_at:now(),next_sync_at:later(7),last_error:null,card_count:records.length}).eq('source_uid',job.source_uid))
   stats.pages++;await log(`${job.name}: ${records.length} schede controllate; nuove ${stats.added}, evidenze cambiate ${stats.changed}.`,true)
  }catch(error){stats.errors++;await check(db.from('catalog_sync_sets').update({next_sync_at:later(1),last_error:String(error)}).eq('source_uid',job.source_uid));await log(`${job.name}: ${String(error)}; la pagina resta da completare.`,true)}
 }
 return stats
}
