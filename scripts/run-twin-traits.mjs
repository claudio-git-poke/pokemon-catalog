// Worker step: copies language-independent traits (and same-language photos)
// from twin cards, see scripts/twin-traits.mjs. DRY_RUN=true only counts.
import {readFile} from 'node:fs/promises'
import {createClient} from '@supabase/supabase-js'
import {planTwinTraits,twinEntry} from './twin-traits.mjs'
const check=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
export async function loadAll(query,{key,size=1000}){
 const rows=[];let last=null
 for(;;){let q=query();if(last!==null)q=q.gt(key,last);const page=await check(q.order(key).limit(size));rows.push(...page);if(page.length<size)return rows;last=page.at(-1)[key]}
}
export async function runTwinTraits({db,sheets,dryRun=false,log=console.log}){
 const cards=await loadAll(()=>db.from('cards').select('id,sigla,lingua,numero,source_local_id,nome,image_status,image_url'),{key:'id'})
 const entries=await loadAll(()=>db.from('catalog_search_entries').select('entry_key,card_id,tags'),{key:'entry_key'})
 const tags=new Map(),existing=new Map()
 for(const e of entries){
  if(e.entry_key.startsWith('twin:')){existing.set(e.entry_key,e);continue}
  if(!e.tags?.length)continue
  const a=tags.get(e.card_id)||[];a.push(...e.tags);tags.set(e.card_id,a)
 }
 const plan=planTwinTraits({cards,tags,sheets})
 const rows=plan.entries.map(twinEntry)
 const changed=rows.filter(r=>{const old=existing.get(r.entry_key);return !old||old.card_id!==r.card_id||JSON.stringify([...(old.tags||[])].sort())!==JSON.stringify(r.tags)})
 const wanted=new Set(rows.map(r=>r.entry_key)),stale=[...existing.keys()].filter(k=>!wanted.has(k))
 const summary={cards:cards.length,...plan.stats,twin_entries:rows.length,to_write:changed.length,stale:stale.length,photos:plan.photos.length,dry_run:dryRun}
 await log(`Gemelle: ${summary.with_twin} carte senza tag completate dalla stessa stampa in altre lingue (${changed.length} righe da scrivere, ${stale.length} da togliere), ${summary.photos} foto dalla stessa lingua; ${summary.rejected_names} gemelle scartate perché il Pokémon non coincide.`)
 if(dryRun)return summary
 for(let i=0;i<changed.length;i+=500)await check(db.from('catalog_search_entries').upsert(changed.slice(i,i+500).map(r=>({...r,updated_at:new Date().toISOString()})),{onConflict:'entry_key'}))
 for(let i=0;i<stale.length;i+=200)await check(db.from('catalog_search_entries').delete().in('entry_key',stale.slice(i,i+200)))
 for(const {card,donor} of plan.photos)await check(db.from('cards').update({image_url:donor.image_url,image_status:'found',image_source:'twin',image_last_error:null}).eq('id',card.id).neq('image_status','found'))
 return summary
}
if(import.meta.url===`file://${process.argv[1]}`){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY
 if(!url||!secret)throw Error('Configurare URL e SERVICE_ROLE_KEY del PostgREST locale.')
 const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
 const {sets}=JSON.parse(await readFile(new URL('../data/set-sheets.json',import.meta.url),'utf8'))
 const summary=await runTwinTraits({db,sheets:sets,dryRun:process.env.DRY_RUN==='true'})
 console.log(JSON.stringify(summary))
}
