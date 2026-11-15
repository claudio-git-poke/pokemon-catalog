import {NextRequest,NextResponse} from 'next/server'
import {createClient} from '@supabase/supabase-js'
export const dynamic='force-dynamic'
export async function GET(req:NextRequest,{params}:{params:{asset:string}}){
 const p=req.nextUrl.searchParams,limit=Number(p.get('limit')||24)
 if(!/^[a-f0-9]{32}$/.test(params.asset)||!Number.isInteger(limit)||limit<1||limit>100)return NextResponse.json({error:'Simbolo o limite non valido'},{status:400})
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}})
 const {data,error}=await db.rpc('catalog_visual_cards',{symbol_key:params.asset,after_key:p.get('after')||'',page_size:limit,include_review:p.get('review')==='true'})
 if(error)return NextResponse.json({error:error.message},{status:503})
 return NextResponse.json(data,{status:data?.error?404:200,headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}})
}
