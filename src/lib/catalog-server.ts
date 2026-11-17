import {createClient} from '@supabase/supabase-js'
import {catalogTursoFetch,tursoEnabled} from '../server/turso-runtime.mjs'

export function createCatalogServerClient({automatic=false}={}){
 if(tursoEnabled())return createClient('http://catalog.internal/api/catalog-db','catalog-public',{
  auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:((input:RequestInfo|URL,init?:RequestInit)=>catalogTursoFetch(input,init,automatic?'automatic':'manual')) as typeof fetch}
 })
 return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,automatic?(process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!):process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
  auth:{persistSession:false,autoRefreshToken:false},
  global:{headers:automatic?{'x-catalog-write-mode':'automatic'}:{},fetch:(input,init)=>fetch(input,{...init,cache:'no-store'})}
 })
}
