import {spawn} from 'node:child_process'
import {randomBytes,createHmac} from 'node:crypto'
import {createServer} from 'node:http'

export function disposablePostgresConfiguration(env=process.env){
 if(env.CATALOG_DISPOSABLE_POSTGRES!=='1'||!['127.0.0.1','localhost','::1'].includes(env.PGHOST)||env.PGHOSTADDR&&!['127.0.0.1','::1'].includes(env.PGHOSTADDR)||!/^catalog_worker_\d+$/.test(env.PGDATABASE||'')||env.PGUSER!=='postgres'||!env.PGPASSWORD||env.PGSERVICE||env.PGSERVICEFILE)throw Error('Usare esclusivamente il PostgreSQL temporaneo locale del worker.')
 const port=Number(env.PGPORT||5432)
 if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Porta del PostgreSQL temporaneo non valida.')
 return {host:env.PGHOST,port,database:env.PGDATABASE,user:env.PGUSER,password:env.PGPASSWORD}
}
export function createPsqlSession(env=process.env){
 const pg=disposablePostgresConfiguration(env)
 const child=spawn('psql',['-X','--no-password','-qAt','--set','ON_ERROR_STOP=1','--set','VERBOSITY=sqlstate'],{env:{PATH:env.PATH,PGHOST:pg.host,PGPORT:String(pg.port),PGDATABASE:pg.database,PGUSER:pg.user,PGPASSWORD:pg.password,PGOPTIONS:'',PGPASSFILE:'/dev/null',LC_ALL:'C.UTF-8'},stdio:['pipe','pipe','pipe']})
 let active=null,failed=null,queue=Promise.resolve(),closed=false
 const abort=error=>{failed??=error;if(active){active.reject(failed);active=null}}
 child.on('error',()=>abort(Error('Impossibile avviare il client PostgreSQL temporaneo.')))
 child.on('exit',code=>{closed=true;if(code!==0||active)abort(Error('Sessione PostgreSQL temporanea interrotta.'))})
 child.stderr.setEncoding('utf8');child.stderr.on('data',text=>{const code=text.match(/ERROR:\s*([A-Z0-9]{5})\b/)?.[1];if(code)abort(Error('PostgreSQL temporaneo: SQLSTATE '+code))})
 child.stdout.setEncoding('utf8');child.stdout.on('data',text=>{
  if(!active)return
  active.output+=text
  if(Buffer.byteLength(active.output)>60*1024*1024){abort(Error('Risposta PostgreSQL troppo grande.'));child.kill();return}
  const ending=active.marker+'\n',index=active.output.indexOf(ending)
  if(index>=0){const resolve=active.resolve,value=active.output.slice(0,index).trim();active=null;resolve(value)}
 })
 const executeSql=sql=>{
  queue=queue.then(()=>new Promise((resolve,reject)=>{
   if(failed||closed){reject(failed||Error('Sessione PostgreSQL chiusa.'));return}
   const marker='__CATALOG_'+randomBytes(16).toString('hex')+'__'
   active={marker,resolve,reject,output:''}
   child.stdin.write(sql+'\n;\n\\echo '+marker+'\n',error=>{if(error)abort(Error('Invio al PostgreSQL temporaneo interrotto.'))})
  }))
  return queue
 }
 return {executeSql,async query(sql){const output=await executeSql("SELECT coalesce(json_agg(q),'[]'::json) FROM ("+sql.replace(/;\s*$/,'')+')q;');return JSON.parse(output)},async close(){await queue.catch(()=>{});if(!closed){child.stdin.end('\\q\n');await new Promise(resolve=>{child.once('exit',resolve);setTimeout(()=>{child.kill();resolve()},1000).unref()})}}}
}
export async function startWorkerRest({env=process.env,binary='./postgrest',mask=()=>{}}={}){
 const pg=disposablePostgresConfiguration(env),secret=randomBytes(32).toString('hex'),now=Math.floor(Date.now()/1000)
 const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),payload=Buffer.from(JSON.stringify({role:'service_role',iat:now,exp:now+7200})).toString('base64url'),unsigned=header+'.'+payload
 const token=unsigned+'.'+createHmac('sha256',secret).update(unsigned).digest('base64url')
 mask(secret);mask(token);mask(pg.password)
 const child=spawn(binary,[],{env:{PATH:env.PATH,PGRST_DB_URI:'postgresql://'+encodeURIComponent(pg.user)+':'+encodeURIComponent(pg.password)+'@'+(pg.host.includes(':')?'['+pg.host+']':pg.host)+':'+pg.port+'/'+pg.database,PGRST_DB_ANON_ROLE:'anon',PGRST_DB_SCHEMAS:'public',PGRST_DB_MAX_ROWS:'1000',PGRST_DB_POOL:'4',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3001'},stdio:['ignore','ignore','ignore']})
 let failed=false;child.once('error',()=>{failed=true});child.once('exit',()=>{failed=true})
 try{
  let ready=false
  for(let attempt=0;attempt<60;attempt++){
   if(failed)throw Error('PostgREST temporaneo non avviato.')
   try{const result=await fetch('http://127.0.0.1:3001/cards?select=id&limit=1',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(1000)});ready=result.ok}catch{}
   if(ready)break
   await new Promise(resolve=>setTimeout(resolve,500))
  }
  if(!ready)throw Error('PostgREST temporaneo non pronto.')
  // Existing workers use the Supabase /rest/v1 prefix. Keep their requests
  // local and strip only that prefix before reaching native PostgREST.
  const proxy=createServer(async(request,response)=>{
   try{
    if(!request.url?.startsWith('/rest/v1/')){response.writeHead(404);response.end();return}
    const body=[];let size=0
    for await(const chunk of request){size+=chunk.length;if(size>8*1024*1024)throw Error('Richiesta locale troppo grande.');body.push(chunk)}
    const headers=new Headers();for(const [key,value]of Object.entries(request.headers))if(!['host','connection','content-length'].includes(key)&&typeof value==='string')headers.set(key,value)
    const result=await fetch('http://127.0.0.1:3001'+request.url.slice('/rest/v1'.length),{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:Buffer.concat(body),signal:AbortSignal.timeout(120000)})
    const resultHeaders={};for(const [key,value]of result.headers)if(!['transfer-encoding','connection','content-encoding','content-length'].includes(key))resultHeaders[key]=value
    response.writeHead(result.status,resultHeaders);response.end(Buffer.from(await result.arrayBuffer()))
   }catch{response.writeHead(503,{'Content-Type':'application/json'});response.end('{"message":"Database temporaneo non disponibile"}')}
  })
  await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(3000,'127.0.0.1',resolve)})
  return {url:'http://127.0.0.1:3000',token,async close(){await new Promise(resolve=>proxy.close(resolve));child.kill()}}
 }catch(error){child.kill();throw error}
}
