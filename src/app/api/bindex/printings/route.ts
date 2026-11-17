import {NextRequest,NextResponse} from 'next/server'
import {createCatalogServerClient} from '@/lib/catalog-server'
export const dynamic='force-dynamic'
export async function GET(req:NextRequest){
 try{
  const q=req.nextUrl.searchParams,size=Number(q.get('limit')||200),after=q.get('after')||'1970-01-01T00:00:00Z',key=q.get('key')||'',until=q.get('until')
  if(!Number.isInteger(size)||size<1||size>500||!Number.isFinite(Date.parse(after))||(until&&!Number.isFinite(Date.parse(until))))return NextResponse.json({error:'Cursore o limite non valido.'},{status:400})
  const db=createCatalogServerClient()
  const {data,error}=await db.rpc('bindex_printing_page',{after_time:after,after_key:key,until_time:until,page_size:size})
  if(error)return NextResponse.json({error:error.message},{status:503})
  return NextResponse.json(data,{headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}})
 }catch{return NextResponse.json({error:'Parametri non validi.'},{status:400})}
}
