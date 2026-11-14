import {NextRequest,NextResponse} from 'next/server'
import {createClient} from '@supabase/supabase-js'
export const dynamic='force-dynamic'
export async function GET(req:NextRequest){
 try{
  const q=req.nextUrl.searchParams,kind=q.get('kind')||'cards',size=Number(q.get('limit')||1000)
  if(!['cards','sets','photos'].includes(kind)||!Number.isInteger(size)||size<1||size>1000)return NextResponse.json({error:'Tipo o limite non valido.'},{status:400})
  const key=JSON.parse(q.get('key')||'[]'),after=q.get('after')||'1970-01-01T00:00:00Z',until=q.get('until')
  if(!Array.isArray(key)||!Number.isFinite(Date.parse(after))||(until&&!Number.isFinite(Date.parse(until))))return NextResponse.json({error:'Cursore non valido.'},{status:400})
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data,error}=await db.rpc('bindex_export_page',{kind,after_time:after,after_key:key,until_time:until,page_size:size})
  if(error)return NextResponse.json({error:error.message},{status:error.code==='P0001'||error.code==='22P02'?400:503})
  return NextResponse.json(data,{headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}})
 }catch{return NextResponse.json({error:'Parametri non validi.'},{status:400})}
}
