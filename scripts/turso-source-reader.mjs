const identifier=/^[a-z][a-z0-9_]*$/
export function validateTable(table){
 if(!table||!identifier.test(table.table_name)||!Array.isArray(table.primary_key)||!table.primary_key.length||table.primary_key.some(k=>!identifier.test(k)))throw Error('Schema di origine non valido.')
 return table
}
function valueLiteral(value){
 if(typeof value==='number'&&Number.isSafeInteger(value))return String(value)
 if(typeof value==='string')return JSON.stringify(value)
 throw Error('Valore della chiave primaria non rappresentabile senza perdita.')
}
export function sourcePageQuery(table,cursor=null,limit=400){
 validateTable(table)
 if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Dimensione pagina non valida.')
 const q=new URLSearchParams({select:'*',order:table.primary_key.map(k=>k+'.asc').join(','),limit:String(limit)})
 if(cursor){
  if(cursor.length!==table.primary_key.length)throw Error('Cursore incompleto.')
  const parts=table.primary_key.map((key,i)=>{
   const comparisons=table.primary_key.slice(0,i).map((k,j)=>k+'.eq.'+valueLiteral(cursor[j]))
   comparisons.push(key+'.gt.'+valueLiteral(cursor[i]))
   return comparisons.length===1?comparisons[0]:'and('+comparisons.join(',')+')'
  })
  q.set('or','('+parts.join(',')+')')
 }
 return q
}
export function createSourceReader({url,key,fetcher=fetch,allowLoopback=false,attempts=3,wait=attempt=>new Promise(r=>setTimeout(r,1000*Math.min(30,2**attempt)))}){
 const parsed=new URL(url)
 // The local copy is read through a PostgREST on this machine (http, loopback only).
 const loopback=allowLoopback&&parsed.protocol==='http:'&&parsed.hostname==='127.0.0.1'
 if((parsed.protocol!=='https:'&&!loopback)||parsed.username||parsed.password||!key)throw Error('Configurazione Supabase di origine non valida.')
 const base=parsed.origin+'/rest/v1/',headers={apikey:key,Authorization:'Bearer '+key}
 async function request(table,query,method='GET',extraHeaders={}){
  validateTable(table)
  for(let attempt=0;;attempt++){
   let response
   try{response=await fetcher(base+table.table_name+'?'+query,{method,headers:{...headers,...extraHeaders},signal:AbortSignal.timeout(30000)})}
   catch{if(attempt>=attempts-1)throw Error('Origine '+table.table_name+': richiesta interrotta.');await wait(attempt);continue}
   if(response.ok)return response
   if(attempt<attempts-1&&[429,500,502,503,504].includes(response.status)){await wait(attempt);continue}
   let code='';try{code=(await response.json()).code||''}catch{}
   throw Error('Origine '+table.table_name+': HTTP '+response.status+(code?' · '+String(code).replace(/[^A-Za-z0-9_]/g,''):''))
  }
 }
 return {
  async count(table){
   const response=await request(table,new URLSearchParams({select:table.primary_key[0],limit:'1'}),'HEAD',{Prefer:'count=exact'})
   const match=response.headers.get('content-range')?.match(/\/(\d+)$/)
   if(!match||!Number.isSafeInteger(Number(match[1])))throw Error('Conteggio esatto non disponibile: '+table.table_name)
   return Number(match[1])
  },
  async page(table,cursor,limit){const result=await(await request(table,sourcePageQuery(table,cursor,limit))).json();if(!Array.isArray(result))throw Error('Pagina non valida: '+table.table_name);return result}
 }
}
