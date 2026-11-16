import {readFile,readdir} from 'node:fs/promises'
import {createClient} from '@supabase/supabase-js'
import {importVisualAssetBatch} from './visual-asset-import.mjs'
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
let imported=0,changed=0
for(const file of (await readdir(new URL('../data/visual-archive/',import.meta.url))).filter(x=>/^\d+\.json$/.test(x)).sort()){
 const rows=JSON.parse(await readFile(new URL('../data/visual-archive/'+file,import.meta.url),'utf8'))
 const result=await importVisualAssetBatch(db,rows)
 changed+=result.changed
 imported+=rows.length;console.log(`Simboli: ${imported} riferimenti controllati, ${changed} nuovi o cambiati; immagini conservate fuori dal database.`)
}
console.log('Registro visivo pronto. I collegamenti automatici non verificano la grafica esatta né la posizione sulla carta.')
