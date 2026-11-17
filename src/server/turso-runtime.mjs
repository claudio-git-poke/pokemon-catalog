import schemaSource from '../../data/turso-source-schema.json' with {type:'json'}
import {createTursoClient} from '../../scripts/turso-client.mjs'
import {publicCatalogSchema} from './turso-schema.mjs'
import {handleCatalogRequest} from './turso-http.mjs'
import {updateCard,protectCardFields} from './turso-writes.mjs'

const schema=publicCatalogSchema(schemaSource)
let connection
export const tursoEnabled=()=>process.env.CATALOG_DATABASE==='turso'
export async function catalogTursoFetch(input,init,mode='manual',writesEnabled=true){
 const request=new Request(input,init)
 connection??=createTursoClient().catch(error=>{connection=undefined;throw error})
 const {client}=await connection
 return handleCatalogRequest(request,{client,schema,mode,
  ready:async()=>{try{return Number((await client.execute('SELECT ready FROM _catalog_api_state WHERE id=1')).rows[0]?.ready)===1&&Number((await client.execute('SELECT version FROM _catalog_guard_version WHERE id=1')).rows[0]?.version)>=2}catch{return false}},
  writeCard:writesEnabled?(params,patch,writeMode)=>updateCard(client,schema,params,patch,writeMode):undefined,
  protectCard:writesEnabled?body=>protectCardFields(client,body):undefined})
}
