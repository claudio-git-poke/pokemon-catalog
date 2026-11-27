// Worker step, off unless LEGACY_PROMOS=apply (LEGACY_PROMOS=dry only counts).
import {createClient} from '@supabase/supabase-js'
import {runLegacyPromos} from './legacy-promos.mjs'
const mode=process.env.LEGACY_PROMOS||'off'
if(mode==='off'){console.log('Unione delle promo vecchie spenta.');process.exit(0)}
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
console.log(JSON.stringify(await runLegacyPromos({db,dryRun:mode!=='apply'})))
