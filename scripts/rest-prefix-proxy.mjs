import http from 'node:http'
// Supabase clients call <url>/rest/v1/...; PostgREST serves the API at its
// root. This local proxy strips the prefix so the unchanged importers work
// against the disposable worker database. It listens on 127.0.0.1 only.
const target=Number(process.env.POSTGREST_PORT||3000),port=Number(process.env.PROXY_PORT||54321)
http.createServer((request,response)=>{
 if(!request.url.startsWith('/rest/v1/')){response.writeHead(404).end();return}
 const upstream=http.request({host:'127.0.0.1',port:target,method:request.method,path:request.url.slice('/rest/v1'.length),headers:{...request.headers,host:'127.0.0.1:'+target}},reply=>{response.writeHead(reply.statusCode,reply.headers);reply.pipe(response)})
 upstream.on('error',error=>{if(!response.headersSent)response.writeHead(502,{'content-type':'application/json'});response.end(JSON.stringify({message:'PostgREST locale non raggiungibile: '+error.message}))})
 request.pipe(upstream)
}).listen(port,'127.0.0.1',()=>console.log('Proxy REST locale su 127.0.0.1:'+port))
