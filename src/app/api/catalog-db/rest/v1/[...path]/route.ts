import {catalogTursoFetch,tursoEnabled} from '@/server/turso-runtime.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=30
async function route(request:Request){
 if(!tursoEnabled()&&process.env.CATALOG_TURSO_PREVIEW!=='1')return Response.json({code:'CATALOG_NOT_ENABLED',message:'Nuovo database non ancora attivato.'},{status:503,headers:{'Cache-Control':'no-store'}})
 try{return await catalogTursoFetch(request,undefined,'manual',tursoEnabled())}catch{return Response.json({code:'CATALOG_UNAVAILABLE',message:'Catalogo temporaneamente non disponibile.'},{status:503,headers:{'Cache-Control':'no-store'}})}
}
export const GET=route
export const HEAD=route
export const POST=route
export const PATCH=route
export const OPTIONS=route
