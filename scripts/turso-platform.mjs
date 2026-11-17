// Minimal Turso Platform API client used by the file-based migration.
// The Platform token stays in GitHub secrets; database tokens are minted per
// run with a short expiration and are never printed.
const API='https://api.turso.tech/v1'
export function platformConfiguration(env=process.env){
 const token=env.TURSO_API_TOKEN?.trim(),organization=env.TURSO_ORGANIZATION?.trim()
 if(!token||!organization)throw Error('Configurare TURSO_API_TOKEN e TURSO_ORGANIZATION nei segreti del repository.')
 if(!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(organization))throw Error('TURSO_ORGANIZATION non valido.')
 return {token,organization}
}
export function validDatabaseName(name){
 if(!/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(name))throw Error('Nome del database non valido: usare minuscole, cifre e trattini.')
 return name
}
export function createPlatform({token,organization},{fetchImpl=fetch}={}){
 async function call(method,path,body){
  const response=await fetchImpl(API+'/organizations/'+organization+path,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})
  const text=await response.text()
  if(!response.ok)throw Error(`Platform API ${method} ${path.replace(/\?.*$/,'')}: HTTP ${response.status} ${text.slice(0,200)}`)
  return text?JSON.parse(text):{}
 }
 return {
  async usage(){
   const usage=(await call('GET','/usage'))?.organization?.usage
   const values={rows_written:Number(usage?.rows_written),rows_read:Number(usage?.rows_read),storage_bytes:Number(usage?.storage_bytes)}
   if(!Object.values(values).every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('Risposta dei consumi Turso non valida.')
   return values
  },
  async groups(){return (await call('GET','/groups')).groups||[]},
  async locations(){
   const response=await fetchImpl(API+'/locations',{headers:{authorization:'Bearer '+token}})
   if(!response.ok)throw Error('Elenco delle località Turso non disponibile: HTTP '+response.status)
   return Object.keys((await response.json()).locations||{})
  },
  async createGroup(name,location){
   if(!/^[a-z0-9-]{1,40}$/.test(name)||!/^[a-z0-9-]{2,40}$/.test(location))throw Error('Gruppo o località non validi.')
   return (await call('POST','/groups',{name,location})).group
  },
  async databases(){return (await call('GET','/databases')).databases||[]},
  async createUploadDatabase(name,group){
   const database=(await call('POST','/databases',{name:validDatabaseName(name),group,seed:{type:'database_upload'}})).database
   if(!database?.Hostname)throw Error('Risposta di creazione del database senza indirizzo.')
   return database
  },
  async databaseToken(name,{expiration='2h',authorization='full-access'}={}){
   const jwt=(await call('POST','/databases/'+validDatabaseName(name)+'/auth/tokens?expiration='+encodeURIComponent(expiration)+'&authorization='+authorization))?.jwt
   if(!jwt)throw Error('Token del database non ricevuto.')
   return jwt
  },
  async deleteDatabase(name){return call('DELETE','/databases/'+validDatabaseName(name))}
 }
}
// Vercel runs the site functions in iad1 (US East) unless configured otherwise:
// the database group stays next to them.
export const PREFERRED_LOCATIONS=['aws-us-east-1','iad','aws-us-east-2','aws-eu-west-1']
export async function ensureGroup(platform,log=()=>{}){
 const groups=await platform.groups()
 const existing=groups.find(g=>g.name==='default')||groups[0]
 if(existing)return existing.name
 const available=await platform.locations()
 const location=PREFERRED_LOCATIONS.find(l=>available.includes(l))||available[0]
 if(!location)throw Error('Nessuna località Turso disponibile per creare il gruppo.')
 await platform.createGroup('default',location)
 log({phase:'group-created',group:'default',location})
 return 'default'
}
// Upload a WAL-checkpointed SQLite file as the initial content of a database
// created with seed type database_upload.
export async function uploadDatabaseFile({hostname,jwt,body,size,fetchImpl=fetch}){
 const response=await fetchImpl('https://'+hostname+'/v1/upload',{method:'POST',headers:{authorization:'Bearer '+jwt,'content-type':'application/octet-stream',...(size?{'content-length':String(size)}:{})},body,duplex:'half'})
 if(!response.ok)throw Error('Caricamento del file non riuscito: HTTP '+response.status+' '+(await response.text()).slice(0,200))
}
