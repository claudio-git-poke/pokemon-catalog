import {NextResponse} from 'next/server'
import {createClient} from '@supabase/supabase-js'
export const dynamic='force-dynamic'
export const fetchCache='force-no-store'
export async function GET(){
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,cache:'no-store'})}})
 const [state,cards,sets,images]=await Promise.all([
  db.from('catalog_export_state').select('*').eq('id','bindex').single(),
  db.from('set_carte').select('*',{count:'exact',head:true}),
  db.from('set_espansioni').select('*',{count:'exact',head:true}),
  db.from('set_carte_immagini').select('*',{count:'exact',head:true})
 ])
 const error=[state,cards,sets,images].find(r=>r.error)?.error
 if(error)return NextResponse.json({ready:false,error:error.message},{status:503})
 return NextResponse.json({ready:state.data.ready,contract:'bindex-v1',direction:'catalogo → Bindex',tables:{cards:'set_carte',sets:'set_espansioni',images:'set_carte_immagini'},counts:{cards:cards.count,sets:sets.count,images:images.count},state:state.data},{headers:{'Cache-Control':'no-store'}})
}