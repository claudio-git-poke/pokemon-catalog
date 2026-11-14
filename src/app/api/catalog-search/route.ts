import {NextRequest,NextResponse} from 'next/server'
import {createClient} from '@supabase/supabase-js'
import {parseIdentificationQuery,validateObservations} from '@/lib/catalog-identification'
export const maxDuration=30
export async function POST(req:NextRequest){
 try{
  const body=await req.json()
  if(typeof body.query!=='string'||body.query.length>180)return NextResponse.json({error:'Scrivi una ricerca entro 180 caratteri.'},{status:400})
  const parsed=parseIdentificationQuery(body.query),observations=validateObservations(body.observations)
  const allowed=['INT','EN','IT','JP','KOR','CHN','CHN-T','FR','DE','ES','PT','ID','TH']
  if(body.language&&!allowed.includes(body.language))return NextResponse.json({error:'Lingua non riconosciuta.'},{status:400})
  const offset=Number.isInteger(body.offset)?Math.min(10000,Math.max(0,body.offset)):0
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data,error}=await db.rpc('identify_catalog_cards',{tokens:parsed.tokens,required_tags:parsed.tags,card_number:parsed.number,card_denominator:parsed.denominator,wanted_year:parsed.year,wanted_language:body.language||null,observations,page_offset:offset,page_size:24})
  if(error)throw Error(error.message)
  return NextResponse.json({...data,interpretation:parsed,observations},{headers:{'Cache-Control':'no-store'}})
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Ricerca non disponibile.'},{status:500})}
}
