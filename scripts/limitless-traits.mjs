// Traits read from Limitless card pages for Limitless cards that have none of
// their own and no twin: Pokémon type, HP, card type, stage, illustrator,
// regulation mark and (English pages) rarity. They are saved on the card's
// own Limitless search entry; facts.limitless_checked marks the page as read,
// so each night continues where the previous one stopped.
import {createClient} from '@supabase/supabase-js'
import {readFile} from 'node:fs/promises'
import {loadAll} from './run-twin-traits.mjs'
import {planTwinTraits,FAMILIES} from './twin-traits.mjs'

const decode=s=>String(s||'').replace(/&amp;/g,'&').replace(/&#039;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&eacute;/g,'é')
const text=s=>decode(String(s||'').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim()
export const slug=s=>String(s||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
const block=(html,cls)=>String(html).match(new RegExp(`class="${cls}">([\\s\\S]*?)</p>`))?.[1]||''
const STAGES={'basic':'basic','stage 1':'stage-1','stage 2':'stage-2','vmax':'vmax','vstar':'vstar','v-union':'v-union','break':'break','mega':'mega','level-up':'level-up','restored':'restored','baby':'baby'}
const TRAINERS={'supporter':'supporter','item':'item','pokémon tool':'tool','pokemon tool':'tool','stadium':'stadium','technical machine':'technical-machine'}
export function parseLimitlessCard(html){
 const page=String(html||''),tags=[]
 const title=text(block(page,'card-text-title'))
 const hp=title.match(/(\d+)\s*HP/);if(hp)tags.push(`hp:${hp[1]}`)
 const parts=title.split(' - ').map(s=>s.trim())
 const type=parts.find(p=>/^(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless)$/.test(p));if(type)tags.push(`type:${type.toLowerCase()}`)
 const kinds=text(block(page,'card-text-type')).split(' - ').map(s=>s.trim().toLowerCase()).filter(Boolean)
 if(kinds[0]==='pokémon'||kinds[0]==='pokemon'){tags.push('card-type:pokemon');const stage=STAGES[kinds[1]];if(stage)tags.push(`stage:${stage}`)}
 else if(kinds[0]==='trainer')tags.push(`card-type:${TRAINERS[kinds[1]]||'trainer'}`)
 else if(kinds[0]==='energy')tags.push(kinds[1]==='special energy'?'card-type:special-energy':'card-type:basic-energy')
 const artist=page.match(/card-text-artist">[\s\S]*?<a[^>]*>\s*([^<]+?)\s*<\/a>/);if(artist)tags.push(`illustrator:${slug(decode(artist[1]))}`)
 const mark=page.match(/regulation-mark">\s*([A-Z])\s+Regulation Mark/);if(mark)tags.push(`regulation:${mark[1].toLowerCase()}`)
 const details=page.match(/prints-current-details">[\s\S]*?<\/span>\s*<span>\s*#[^<·]*·\s*([^<]+?)\s*<\/span>/);if(details)tags.push(`rarity:${slug(details[1])}`)
 return [...new Set(tags.filter(t=>!t.endsWith(':')))]
}
const own=tags=>(tags||[]).some(t=>FAMILIES.includes(String(t).split(':')[0]))
export async function runLimitlessTraits({db,sheets,minutes=20,fetchPage,log=console.log,clock=Date.now,delay=1100}){
 const check=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
 const end=clock()+minutes*60000
 const cards=await loadAll(()=>db.from('cards').select('id,sigla,lingua,numero,source_local_id,nome,image_status,image_url,source_uid'),{key:'id'})
 const entries=await loadAll(()=>db.from('catalog_search_entries').select('entry_key,card_id,tags,facts,source_url'),{key:'entry_key'})
 const tags=new Map();for(const e of entries){if(e.entry_key.startsWith('twin:')||!e.tags?.length)continue;const a=tags.get(e.card_id)||[];a.push(...e.tags);tags.set(e.card_id,a)}
 const twins=new Set(planTwinTraits({cards,tags,sheets}).entries.map(e=>e.card.id))
 const byKey=new Map(entries.map(e=>[e.entry_key,e]))
 const todo=cards.filter(c=>String(c.source_uid||'').startsWith('limitless:')&&!own(tags.get(c.id))&&!twins.has(c.id)).map(c=>byKey.get(c.source_uid)).filter(e=>e?.source_url&&!e.facts?.limitless_checked)
 const stats={todo:todo.length,read:0,tagged:0,errors:0}
 for(const entry of todo){
  if(clock()>end-5000)break
  try{
   const found=parseLimitlessCard(await fetchPage(entry.source_url))
   await check(db.from('catalog_search_entries').update({tags:[...new Set([...(entry.tags||[]),...found])],facts:{...(entry.facts||{}),limitless_checked:new Date(clock()).toISOString().slice(0,10)}}).eq('entry_key',entry.entry_key))
   stats.read++;if(found.length)stats.tagged++
  }catch{stats.errors++}
  if(delay)await new Promise(r=>setTimeout(r,delay))
 }
 await log(`Tag da Limitless: ${stats.read} pagine lette, ${stats.tagged} carte con nuovi tag, ${stats.errors} errori, ${stats.todo-stats.read} ancora da leggere.`)
 return stats
}
if(import.meta.url===`file://${process.argv[1]}`){
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
 const {sets}=JSON.parse(await readFile(new URL('../data/set-sheets.json',import.meta.url),'utf8'))
 const fetchPage=async url=>{const u=new URL(url);if(u.hostname!=='limitlesstcg.com')throw Error('host');const r=await fetch(u,{headers:{'User-Agent':'BindexCatalog/1.0 (+https://github.com/claudio-git-poke/pokemon-catalog)'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);return r.text()}
 console.log(JSON.stringify(await runLimitlessTraits({db,sheets:sets,minutes:Number(process.env.LIMITLESS_TRAITS_MINUTES||20),fetchPage})))
}
