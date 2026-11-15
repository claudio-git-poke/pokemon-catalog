import {NextRequest,NextResponse} from 'next/server'
import {createClient} from '@supabase/supabase-js'
export const dynamic='force-dynamic'
export async function GET(req:NextRequest){
 const p=req.nextUrl.searchParams,limit=Number(p.get('limit')||48),after=p.get('after')||''
 if(!Number.isInteger(limit)||limit<1||limit>100||after&&!/^[a-f0-9]{32}$/.test(after))return NextResponse.json({error:'Limite o cursore non valido'},{status:400})
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}})
 let query=db.from('catalog_visual_assets').select('*').gt('asset_key',after).order('asset_key').limit(limit+1)
 if(p.get('all')!=='true')query=query.not('match_mode','is',null)
 if(p.get('kind'))query=query.eq('kind',p.get('kind')!)
 if(p.get('language'))query=query.eq('source_language',p.get('language')!)
 const {data,error}=await query
 if(error)return NextResponse.json({error:error.message},{status:503})
 const results=(data||[]).slice(0,limit)
 return NextResponse.json({contract:'bindex-visual-v1',results,has_more:(data||[]).length>limit,next_key:results.at(-1)?.asset_key||null,image_match_is_not_verified_by_automatic_link:true},{headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}})
}
