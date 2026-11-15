import {readFile,readdir} from 'node:fs/promises'
import {createClient} from '@supabase/supabase-js'
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const stable=v=>JSON.stringify(v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k])??'null')])):Array.isArray(v)?v.map(x=>JSON.parse(stable(x)??'null')):v)
let imported=0,changed=0
for(const file of (await readdir(new URL('../data/visual-archive/',import.meta.url))).filter(x=>/^\d+\.json$/.test(x)).sort()){
 const rows=JSON.parse(await readFile(new URL('../data/visual-archive/'+file,import.meta.url),'utf8'))
 const old=await db.from('catalog_visual_assets').select('*').in('asset_key',rows.map(r=>r.asset_key))
 if(old.error)throw Error(file+': '+old.error.message)
 const before=new Map(old.data.map(r=>[r.asset_key,r])),updates=rows.filter(r=>stable(before.get(r.asset_key))!==stable(r))
 for(const row of updates){
  if(before.has(row.asset_key)&&before.get(row.asset_key).image_sha256!==row.image_sha256){
   const {error}=await db.from('catalog_visual_links').update({image_match_status:'candidate'}).eq('asset_key',row.asset_key)
   if(error)throw Error(error.message)
  }
 }
 if(updates.length){const {error}=await db.from('catalog_visual_assets').upsert(updates,{onConflict:'asset_key'});if(error)throw Error(file+': '+error.message)}
 changed+=updates.length
 imported+=rows.length;console.log(`Simboli: ${imported} riferimenti controllati, ${changed} nuovi o cambiati; immagini conservate fuori dal database.`)
}
console.log('Registro visivo pronto. I collegamenti automatici non verificano la grafica esatta né la posizione sulla carta.')
