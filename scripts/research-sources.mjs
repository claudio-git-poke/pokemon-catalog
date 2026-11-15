import {TAXONOMY} from '../src/lib/catalog-taxonomy.ts'
import {expandTags,printingFacts} from '../src/lib/catalog-identification.ts'
import {persistEvidence} from './supplemental-sources.mjs'
const check=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
export const clean=s=>String(s||'').replace(/<[^>]+>/g,' ').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n))).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#039;|&apos;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim()
const LANG={english:['en','EN'],italian:['it','IT'],french:['fr','FR'],german:['de','DE'],spanish:['es','ES'],portuguese:['pt','PT'],japanese:['ja','JP'],korean:['ko','KOR'],indonesian:['id','ID'],thai:['th','TH'],'simplified-chinese':['zh-cn','CHN'],dutch:['nl','NL']}
const requiredReview={identity_review_required:true}
export function pokumonRecord(row){
 if(!Number.isSafeInteger(row.id)||row.status!=='publish')throw Error('Scheda Pokumon non pubblica')
 const url=new URL(row.link);if(url.protocol!=='https:'||url.hostname!=='pokumon.com'||!url.pathname.startsWith('/card/'))throw Error('Provenienza Pokumon discordante')
 const terms=(row._embedded?.['wp:term']||[]).flat(),by=t=>terms.filter(x=>x.taxonomy===t)
 const languages=by('language'),language=languages.length===1?LANG[languages[0].slug]:null
 // The generic taxonomy "Chinese" is not sufficient to assert Traditional Chinese.
 const [lang,local]=language||['und','und'],sets=by('promo_set'),set=sets.length===1?clean(sets[0].name):'PROMO-UNRESOLVED'
 const media=row._embedded?.['wp:featuredmedia']||[]
 let image=null
 if(media.length===1){const m=media[0];try{const u=new URL(m.source_url);if(m.id!==1057&&!/placeholder|no[-_ ]?image|card[-_ ]?back/i.test([m.slug,m.title?.rendered,m.media_details?.file,m.source_url].join(' '))&&u.protocol==='https:'&&['pokumon.com','cdn6966.templcdn.com'].includes(u.hostname)&&u.pathname.startsWith('/wp-content/uploads/'))image=u.href}catch{}}
 const attributes={};for(const taxonomy of ['holofoil','additional_attributes','release_type','release_event','release_year','imagedetail'])attributes[taxonomy]=by(taxonomy).map(t=>({id:t.id,slug:t.slug,name:clean(t.name)}))
 const tags=expandTags(by('holofoil').map(t=>'pattern:'+t.slug).filter(code=>TAXONOMY.some(t=>t.code===code)))
 const number=clean(row.title?.rendered).match(/\((\d+[A-Za-z]?)\//)?.[1]||null
 const name=clean(row.title?.rendered);if(!name)throw Error('Nome Pokumon assente')
 return {uid:`pokumon:${row.id}`,lang,language:local,set,number,denominator:null,name,image,url:url.href,provider:'pokumon',tags,facts:printingFacts(tags),payload:{...requiredReview,source_terms:attributes,source_language_terms:languages.map(t=>t.slug),source_modified_at:row.modified_gmt||null},search:Object.values(attributes).flat().map(t=>t.name).join(' ')}
}
export function limitlessSets(html){
 const codes=[...new Set([...html.matchAll(/href="\/cards\/(?:[a-z]{2}\/)?([A-Z0-9][A-Za-z0-9-]{1,14})"/g)].map(m=>m[1]))]
 if(!codes.length)throw Error('Indice Limitless non riconosciuto')
 return codes
}
export function limitlessLinks(html,lang,set){
 if(!['en','it','fr','de','es','pt','jp'].includes(lang)||!/^[-A-Z0-9]+$/i.test(set))throw Error('Lingua o set Limitless non valido')
 const ids=[...new Set([...html.matchAll(new RegExp(`href="/cards/${lang}/${set}/([A-Za-z0-9-]+)"`,'g'))].map(m=>m[1]))]
 if(!ids.length)throw Error('Set Limitless privo di collegamenti nella lingua richiesta')
 return ids
}
export function limitlessRecord(html,lang,set,id){
 if(!['en','it','fr','de','es','pt','jp'].includes(lang)||!/^[-A-Z0-9]+$/i.test(set)||!/^[-A-Z0-9]+$/i.test(id))throw Error('Identità Limitless non valida')
 const main=html.match(/<div class="card-image">([\s\S]*?)<\/div>/)?.[1]||''
 const raw=main.match(/\bsrc="([^"]+)"/)?.[1],u=new URL(raw)
 const marker=lang==='jp'?'JP':lang.toUpperCase()
 // Only the main card image, never thumbnails, proxies or en.t fan translations.
 if(u.protocol!=='https:'||u.hostname!=='limitlesstcg.nyc3.cdn.digitaloceanspaces.com'||!u.pathname.endsWith(`_${marker}_LG.png`))throw Error('Immagine Limitless non confermata nella lingua richiesta')
 const nameBlock=html.match(/class="card-text-name">([\s\S]*?)<\/span>/)?.[1]||''
 if(!nameBlock.includes(`href="/cards/${lang}/${set}/${id}"`))throw Error('Identità della pagina Limitless discordante')
 const name=clean(nameBlock);if(!name)throw Error('Nome Limitless assente')
 const api=lang==='jp'?'ja':lang,local=lang==='jp'?'JP':marker
 return {uid:`limitless:${lang}:${set}:${id}`,lang:api,language:local,set,number:id,denominator:null,name,image:u.href,url:`https://limitlesstcg.com/cards/${lang}/${set}/${id}`,provider:'limitless',payload:{...requiredReview,source_name_language:'site-display'}}
}
export function bulbapediaRecord(page){
 const w=page.revisions?.[0]?.slots?.main?.['*'];if(typeof w!=='string')return null
 // Use only the explicitly English expansion/card number. Japanese equivalents are not cloned.
 const name=w.match(/\|cardname=([^\n|}]+)/)?.[1]?.trim()
 const expansion=w.match(/\|expansion=\{\{TCG\|([^|}]+)(?:\|[^}]*)?\}\}/)?.[1]?.trim()
 const number=w.match(/\|cardno=([^|}\n]+)/)?.[1]?.trim()
 if(!name||!expansion||!number||!Number.isSafeInteger(page.pageid))return null
 const release=w.match(/==Release information==([\s\S]*?)(?:\n==[^=]|$)/)?.[1]||''
 const patterns=['Smooth Cosmos','Pixel Cosmos','Cosmos Holofoil','Cracked Ice','Mirror Holofoil','Master Ball','Poké Ball','First Edition','1st Edition','Reverse Holofoil']
 const mentions=patterns.filter(p=>release.toLowerCase().includes(p.toLowerCase()))
 return {uid:`bulbapedia:${page.pageid}`,lang:'en',language:'EN',set:expansion,number,denominator:null,name,image:null,url:'https://bulbapedia.bulbagarden.net/wiki/'+encodeURIComponent(page.title.replaceAll(' ','_')),provider:'bulbapedia',payload:{...requiredReview,revision_id:page.revisions[0].revid||null,variant_mentions:mentions,mentions_scope:'release-section-may-describe-multiple-languages',attribution:'Bulbapedia contributors'},search:mentions.join(' ')}
}
const SOURCE_HOSTS=new Set(['pokumon.com','limitlesstcg.com','bulbapedia.bulbagarden.net'])
export function researchFetcher({fetchImpl=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),clock=Date.now}={}){
 const last=new Map()
 return async(url,json=false)=>{
  const u=new URL(url);if(u.protocol!=='https:'||!SOURCE_HOSTS.has(u.hostname))throw Error('URL fonte non autorizzata')
  const delay=u.hostname==='bulbapedia.bulbagarden.net'?5100:1100
  await wait(Math.max(0,(last.get(u.hostname)||0)+delay-clock()));last.set(u.hostname,clock())
  const response=await fetchImpl(u.href,{redirect:'error',headers:{'User-Agent':'BindexCatalog/1.0 (+https://github.com/claudio-git-poke/pokemon-catalog)'},signal:AbortSignal.timeout(20000)})
  if(!response.ok)throw Error(`${u.hostname} HTTP ${response.status}`)
  return {body:json?await response.json():await response.text(),pages:Number(response.headers.get('x-wp-totalpages'))||null}
 }
}
export async function runResearch({db,budgetMs=8*60000,request=researchFetcher(),log=console.log}){
 const end=Date.now()+budgetMs,now=()=>new Date().toISOString(),later=d=>new Date(Date.now()+d*86400000).toISOString(),stats={added:0,changed:0,jobs:0,errors:0}
 const put=async(rows)=>{for(let i=0;i<rows.length;i+=100)await check(db.from('catalog_sync_sets').upsert(rows.slice(i,i+100),{onConflict:'source_uid',ignoreDuplicates:true}))}
 const due=async key=>{const row=await check(db.from('catalog_sync_sets').select('*').eq('source_uid',key).maybeSingle());return !row?.next_sync_at||row.next_sync_at<=now()}
 const indexDone=async key=>check(db.from('catalog_sync_sets').upsert({source_uid:key,provider:'research-index',source_language:'multi',set_id:'__index__',name:key,last_sync_at:now(),next_sync_at:later(1)},{onConflict:'source_uid'}))
 try{
  if(await due('research:index:pokumon')){
   const r=await request('https://pokumon.com/wp-json/wp/v2/card?per_page=50&page=1&_embed=1',true)
   if(!r.pages||!Array.isArray(r.body)||!r.body.length)throw Error('Indice Pokumon privo di paginazione valida')
   await put(Array.from({length:r.pages},(_,i)=>({source_uid:`research:pokumon:${String(i+1).padStart(5,'0')}`,provider:'research-pokumon',source_language:'multi',set_id:String(i+1),name:`Pokumon · pagina ${i+1}`})))
   // The newest page gets a daily slot even while the archive is being populated.
   await check(db.from('catalog_sync_sets').update({next_sync_at:now()}).eq('source_uid','research:pokumon:00001'))
   await indexDone('research:index:pokumon');await log(`Pokumon: ${r.pages} pagine registrate.`,true)
  }
 }catch(error){stats.errors++;await log('Indice Pokumon: '+String(error),true)}
 try{
  if(await due('research:index:limitless')){
   const rows=[]
   for(const region of ['en','jp']){
    const html=(await request(region==='en'?'https://limitlesstcg.com/cards':'https://limitlesstcg.com/cards/jp')).body
    for(const set of limitlessSets(html))for(const lang of region==='en'?['it','en','fr','de','es','pt']:['jp'])rows.push({source_uid:`research:limitless:${lang}:${set}`,provider:'research-limitless',source_language:lang==='jp'?'ja':lang,set_id:JSON.stringify({lang,set,offset:0}),name:`Limitless · ${lang}/${set}`})
   }
   await put(rows);await indexDone('research:index:limitless');await log(`Limitless: ${rows.length} percorsi set/lingua registrati; disponibilità effettiva da controllare.`,true)
  }
 }catch(error){stats.errors++;await log('Indice Limitless: '+String(error),true)}
 await put(['Pokémon cards','Trainer cards','Energy cards'].map(category=>({source_uid:`research:bulbapedia:${category}`,provider:'research-bulbapedia',source_language:'en',set_id:JSON.stringify({category}),name:`Bulbapedia · ${category}`})))
 const groups=[]
 for(const provider of ['research-pokumon','research-bulbapedia','research-limitless']){
  if(provider!=='research-limitless'){
   groups.push(await check(db.from('catalog_sync_sets').select('*').eq('provider',provider).lte('next_sync_at',now()).order('next_sync_at').order('source_uid').limit(40)))
   continue
  }
  const languages=[]
  for(const lang of ['it','en','fr','de','es','pt','ja'])languages.push(await check(db.from('catalog_sync_sets').select('*').eq('provider',provider).eq('source_language',lang).lte('next_sync_at',now()).order('next_sync_at').order('source_uid').limit(6)))
  const fair=[];for(let slot=0;slot<6;slot++)for(const rows of languages)if(rows[slot])fair.push(rows[slot])
  groups.push(fair.slice(0,40))
 }
 for(let n=0;n<40;n++)for(const group of groups){
  const job=group[n];if(!job)continue
  if(Date.now()>end-30000)return {...stats,deferred:true}
  try{
   let records=[],nextId=job.set_id,complete=true,partialError=null,cooldown=false
   if(job.provider==='research-pokumon'){
    const r=await request(`https://pokumon.com/wp-json/wp/v2/card?per_page=50&page=${job.set_id}&_embed=1`,true)
    if(!Array.isArray(r.body)||!r.body.length)throw Error('Pagina Pokumon vuota o non valida')
    records=r.body.map(pokumonRecord)
   }else if(job.provider==='research-bulbapedia'){
    const state=JSON.parse(job.set_id),url=new URL('https://bulbapedia.bulbagarden.net/w/api.php')
    const params={action:'query',format:'json',generator:'categorymembers',gcmtitle:'Category:'+state.category,gcmtype:'page',gcmlimit:'20',prop:'revisions',rvprop:'ids|content',rvslots:'main',maxlag:'5',...(state.continuation||{})}
    url.search=new URLSearchParams(params).toString()
    const r=(await request(url.href,true)).body
    if(r.error||!r.query?.pages)throw Error('Risposta Bulbapedia incompleta: '+JSON.stringify(r.error||{}))
    records=Object.values(r.query.pages).map(bulbapediaRecord).filter(Boolean)
    complete=!r.continue;nextId=JSON.stringify({category:state.category,...(r.continue?{continuation:r.continue}:{})})
   }else{
    const state=JSON.parse(job.set_id),{lang,set}=state
    const ids=limitlessLinks((await request(`https://limitlesstcg.com/cards/${lang}/${set}`)).body,lang,set)
    const offset=state.offset||0,normal=offset<ids.length,selected=normal?ids.slice(offset,offset+10):(state.retry||[]).slice(0,10)
    const retry=new Set(state.retry||[]);let processed=0
    for(const id of selected){
     if(Date.now()>end-30000)break
     try{records.push(limitlessRecord((await request(`https://limitlesstcg.com/cards/${lang}/${set}/${id}`)).body,lang,set,id));retry.delete(id)}
     catch(error){retry.add(id);await log(`Limitless ${lang}/${set}/${id}: ${String(error)}`,true)}
     processed++
    }
    if(!processed)throw Error('Nessuna scheda Limitless elaborata')
    const nextOffset=normal?offset+processed:offset
    complete=nextOffset>=ids.length&&!retry.size;cooldown=nextOffset>=ids.length&&retry.size>0
    if(retry.size)partialError=`${retry.size} schede Limitless in attesa; le altre sono conservate.`
    nextId=JSON.stringify({lang,set,offset:complete?0:nextOffset,...(retry.size?{retry:[...retry]}:{})})
   }
   for(let i=0;i<records.length;i+=50){const saved=await persistEvidence(db,records.slice(i,i+50));stats.added+=saved.added;stats.changed+=saved.changed}
   await check(db.from('catalog_sync_sets').update({set_id:nextId,next_sync_at:complete?later(7):cooldown?later(1):now(),last_sync_at:complete?now():job.last_sync_at,last_error:partialError,card_count:records.length}).eq('source_uid',job.source_uid))
   if(partialError)stats.errors++;stats.jobs++;await log(`${job.name}: ${records.length} evidenze salvate; ${complete?'lotto concluso':'ripresa salvata'}. Nuove ${stats.added}, cambiate ${stats.changed}.`,true)
  }catch(error){stats.errors++;await check(db.from('catalog_sync_sets').update({next_sync_at:later(1),last_error:String(error)}).eq('source_uid',job.source_uid));await log(`${job.name}: ${String(error)}; ripresa conservata.`,true)}
 }
 return stats
}
