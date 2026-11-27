// Catalogue page data: one page of cards and the counts (cached ten minutes),
// with the metadata and year filters. See src/server/catalog-list.mjs.
import sheetsData from '../../../../data/set-sheets.json'
import {createTursoClient} from '../../../../scripts/turso-client.mjs'
import {listCatalog,readFilters,yearCodes} from '@/server/catalog-list.mjs'
import {tursoEnabled} from '@/server/turso-runtime.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=30
const years=yearCodes((sheetsData as {sets:Record<string,{release_date?:string|null,abbreviation?:string|null}>}).sets)
let connection:ReturnType<typeof createTursoClient>|undefined
export async function GET(request:Request){
 if(!tursoEnabled())return Response.json({code:'CATALOG_NOT_ENABLED'},{status:503})
 try{
  connection??=createTursoClient().catch((error:unknown)=>{connection=undefined;throw error})
  const {client}=await connection
  const result=await listCatalog(client,readFilters(new URL(request.url).searchParams),{years})
  return Response.json(result,{headers:{'Cache-Control':'no-store'}})
 }catch{return Response.json({code:'CATALOG_UNAVAILABLE',message:'Catalogo temporaneamente non disponibile.'},{status:503,headers:{'Cache-Control':'no-store'}})}
}
