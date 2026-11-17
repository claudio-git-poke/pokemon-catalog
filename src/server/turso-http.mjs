import {CatalogRestError,readCatalogRows} from './turso-rest.mjs'
import {readCatalogRpc} from './turso-rpcs.mjs'

const headersFor=()=>new Headers({'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'Content-Range,Range-Unit','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'})
const response=(value,status=200,headers=headersFor())=>new Response(value===undefined?null:JSON.stringify(value),{status,headers})
export async function handleCatalogRequest(request,{client,schema,ready,writeCard,protectCard,mode='manual'}={}){
 const headers=headersFor(),method=request.method.toUpperCase()
 if(method==='OPTIONS'){
  headers.set('Access-Control-Allow-Methods','GET,HEAD,POST,PATCH,OPTIONS')
  headers.set('Access-Control-Allow-Headers','apikey,authorization,content-type,prefer,range,range-unit,x-client-info')
  return response(undefined,204,headers)
 }
 try{
  const url=new URL(request.url),path=url.pathname.split('/rest/v1/')[1]?.split('/').map(decodeURIComponent)
  if(!path||path.length>2||path.some(p=>!p))throw new CatalogRestError('Percorso non disponibile.','PGRST205',404)
  if(!await ready())throw new CatalogRestError('La copia Turso non è ancora pronta.','CATALOG_NOT_READY',503)
  if(path[0]==='rpc'&&path.length===2){
   if(method!=='POST')throw new CatalogRestError('Metodo non consentito.','405',405)
   const text=await request.text();if(text.length>32768)throw new CatalogRestError('Richiesta troppo grande.','413',413)
   let body;try{body=JSON.parse(text||'{}')}catch{throw new CatalogRestError('JSON non valido.')}
   if(path[1]==='catalog_protect_card_fields'){
    assertSameOrigin(request)
    if(!protectCard)throw new CatalogRestError('Salvataggi non disponibili.','503',503)
    return response(await protectCard(body),200,headers)
   }
   return response(await readCatalogRpc(client,path[1],body),200,headers)
  }
  if(path.length!==1)throw new CatalogRestError('Percorso non disponibile.','PGRST205',404)
  const table=path[0],params=new URLSearchParams(url.searchParams)
  if(method==='PATCH'){
   assertSameOrigin(request)
   if(table!=='cards'||!writeCard)throw new CatalogRestError('Scrittura non consentita.','42501',403)
   const text=await request.text();if(text.length>32768)throw new CatalogRestError('Richiesta troppo grande.','413',413)
   let patch;try{patch=JSON.parse(text)}catch{throw new CatalogRestError('JSON non valido.')}
   const result=await writeCard(params,patch,mode)
   const representation=(request.headers.get('prefer')||'').split(',').includes('return=representation')
   if(!representation)return response(undefined,204,headers)
   return singularResponse(request,result.rows,headers)
  }
  if(!['GET','HEAD'].includes(method))throw new CatalogRestError('Metodo non consentito.','405',405)
  const range=request.headers.get('range')
  if(range){const m=range.match(/^(\d+)-(\d+)$/);if(!m||Number(m[2])<Number(m[1]))throw new CatalogRestError('Intervallo non valido.');params.set('offset',m[1]);params.set('limit',String(Number(m[2])-Number(m[1])+1))}
  const count=/(?:^|,)\s*count=(?:exact|planned|estimated)(?:,|$)/.test(request.headers.get('prefer')||'')
  const result=await readCatalogRows(client,schema,table,params,{head:method==='HEAD',count})
  const last=result.rows.length?result.offset+result.rows.length-1:result.offset-1
  headers.set('Range-Unit','items');headers.set('Content-Range',(last>=result.offset?result.offset+'-'+last:'*')+'/'+(result.count??'*'))
  if(method==='HEAD')return response(undefined,200,headers)
  return singularResponse(request,result.rows,headers)
 }catch(error){
  if(error instanceof CatalogRestError)return response({code:error.code,message:error.message,details:null,hint:null},error.status,headers)
  // Never return database errors, SQL, tokens, or source documents to public clients.
  console.error('catalog-db request failed:',error?.code||error?.name||'Error')
  return response({code:'CATALOG_UNAVAILABLE',message:'Catalogo temporaneamente non disponibile.',details:null,hint:null},503,headers)
 }
}
function singularResponse(request,rows,headers){
 if(request.headers.get('accept')?.includes('application/vnd.pgrst.object+json')){
  if(rows.length!==1)throw new CatalogRestError('JSON object requested, multiple (or no) rows returned','PGRST116',406)
  return response(rows[0],200,headers)
 }
 return response(rows,200,headers)
}
export function assertSameOrigin(request){
 const origin=request.headers.get('origin')
 if(origin&&origin!==new URL(request.url).origin)throw new CatalogRestError('Origine della scrittura non consentita.','42501',403)
}
