import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createPlatform,platformConfiguration,validDatabaseName,uploadDatabaseFile,ensureGroup} from '../scripts/turso-platform.mjs'
test('platform client sends scoped requests and never needs the token in a URL',async()=>{
 const calls=[]
 const fetchImpl=async(url,init)=>{calls.push({url,method:init.method,auth:init.headers.authorization,body:init.body});const path=new URL(url).pathname
  const body=path.endsWith('/databases')&&init.method==='POST'?{database:{Name:'catalogo',Hostname:'catalogo-demo.aws.turso.io'}}:path.endsWith('/tokens')?{jwt:'db-jwt'}:path.endsWith('/groups')?{groups:[{name:'default'}]}:{}
  return {ok:true,async text(){return JSON.stringify(body)}}}
 const platform=createPlatform({token:'t',organization:'demo'},{fetchImpl})
 assert.deepEqual(await platform.groups(),[{name:'default'}])
 assert.equal((await platform.createUploadDatabase('catalogo','default')).Hostname,'catalogo-demo.aws.turso.io')
 assert.equal(await platform.databaseToken('catalogo'),'db-jwt')
 assert.deepEqual(JSON.parse(calls[1].body),{name:'catalogo',group:'default',seed:{type:'database_upload'}})
 assert.ok(calls.every(c=>c.auth==='Bearer t'&&!c.url.includes('Bearer')))
 assert.match(calls[2].url,/\/databases\/catalogo\/auth\/tokens\?expiration=2h&authorization=full-access$/)
})
test('configuration and names are validated before any request',async()=>{
 assert.throws(()=>platformConfiguration({}),/TURSO_API_TOKEN/)
 assert.throws(()=>platformConfiguration({TURSO_API_TOKEN:'t',TURSO_ORGANIZATION:'a/b'}),/non valido/)
 assert.throws(()=>validDatabaseName('Catalogo_1'),/non valido/)
 const failing=createPlatform({token:'t',organization:'demo'},{fetchImpl:async()=>({ok:false,status:402,async text(){return 'quota'}})})
 await assert.rejects(failing.usage(),/HTTP 402/)
 await assert.rejects(uploadDatabaseFile({hostname:'h',jwt:'j',body:Buffer.from('x'),fetchImpl:async()=>({ok:false,status:413,async text(){return 'too large'}})}),/HTTP 413/)
})
test('a missing group is created next to the Vercel functions',async()=>{
 const created=[]
 const platform={async groups(){return []},async locations(){return ['aws-eu-west-1','aws-us-east-1']},async createGroup(name,location){created.push([name,location])}}
 assert.equal(await ensureGroup(platform),'default');assert.deepEqual(created,[['default','aws-us-east-1']])
 assert.equal(await ensureGroup({async groups(){return [{name:'altro'}]}}),'altro')
})
