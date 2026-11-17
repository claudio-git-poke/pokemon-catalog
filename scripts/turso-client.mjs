// Credentials stay in GitHub/Vercel secrets. Never log the client or its options.
export function tursoConfiguration(env=process.env){
 const url=env.TURSO_DATABASE_URL?.trim(),authToken=env.TURSO_AUTH_TOKEN?.trim()
 if(!url||!authToken)throw Error('Configurare TURSO_DATABASE_URL e TURSO_AUTH_TOKEN nei segreti del repository.')
 let parsed;try{parsed=new URL(url)}catch{throw Error('TURSO_DATABASE_URL non è un indirizzo valido.')}
 if(!['libsql:','turso:','https:'].includes(parsed.protocol)||!parsed.hostname||parsed.username||parsed.password||parsed.search||parsed.hash)throw Error('Usare l’indirizzo remoto del database Turso, senza credenziali nell’URL.')
 return {url,authToken,engine:parsed.protocol==='turso:'?'turso':'libsql'}
}
export async function createTursoClient(env=process.env){
 const {url,authToken,engine}=tursoConfiguration(env)
 const {createClient}=engine==='turso'?await import('@tursodatabase/serverless/compat'):await import('@libsql/client/web')
 return {client:createClient({url,authToken,concurrency:2}),engine}
}
export function safeTursoError(error,env=process.env){
 let message=String(error?.message||error)
 for(const value of [env.TURSO_AUTH_TOKEN,env.TURSO_DATABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,env.NEXT_PUBLIC_SUPABASE_URL])if(value)message=message.replaceAll(value,'[configurazione riservata]')
 return message.replace(/Bearer\s+\S+/gi,'Bearer [riservato]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[token riservato]').slice(0,700)
}
