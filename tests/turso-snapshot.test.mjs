import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {canonicalJson,hash,initializeSnapshot,copyTable,verifyTable,snapshotReport} from '../scripts/turso-snapshot.mjs'
import {sourcePageQuery,createSourceReader} from '../scripts/turso-source-reader.mjs'
import {freezeSourceWorkers,SOURCE_WORKFLOWS} from '../scripts/freeze-supabase-workers.mjs'
function memoryClient(){
 const db=new DatabaseSync(':memory:')
 const client={async execute(input){const {sql,args=[]}=typeof input==='string'?{sql:input}:input;const statement=db.prepare(sql);if(statement.columns().length)return {rows:statement.all(...args)};const r=statement.run(...args);return {rows:[],rowsAffected:Number(r.changes)}},async batch(statements){db.exec('BEGIN IMMEDIATE');try{const result=[];for(const statement of statements)result.push(await client.execute(statement));db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}},close(){db.close()}}
 return client
}
const table={table_name:'cards',primary_key:['id']}
function sourceFor(rows){return {async count(){return rows.length},async page(table,cursor,limit){const selected=cursor?rows.filter(r=>r.id>cursor[0]):rows;return selected.slice(0,limit)}}}
test('snapshot replay survives an interrupted page, preserves every manual empty/null value and verifies contents',async()=>{
 const client=memoryClient(),rows=Array.from({length:405},(_,i)=>({id:i+1,name:'エネルギー '+i,tags:i===3?[]:['type:fire'],image_url:null,manual_overrides:i===3?{tags:{by:'manual'},image_url:{by:'manual'}}:{},payload:{set:{name:'A, "B"'},value:i}})),source=sourceFor(rows)
 await initializeSnapshot(client,[table],'fixture')
 const original=client.batch;let batches=0
 client.batch=async (...args)=>{if(++batches===2)throw Error('network interruption');return original(...args)}
 await assert.rejects(copyTable({client,source,table,batchRows:150}),/network/)
 assert.equal((await client.execute('SELECT n FROM _catalog_snapshot_state')).rows[0].n,0)
 assert.equal((await client.execute('SELECT count(*) n FROM _copy_cards')).rows[0].n,150)
 client.batch=original
 await copyTable({client,source,table});await verifyTable({client,source,table})
 const report=await snapshotReport(client);assert.equal(report.rows,405);assert.equal(report.manual_rows,1);assert.equal(report.verified,1)
 const saved=JSON.parse((await client.execute({sql:'SELECT _row FROM _copy_cards WHERE _key=?',args:['[4]']})).rows[0]._row)
 assert.deepEqual(saved,rows[3]);assert.deepEqual(saved.tags,[]);assert.equal(saved.image_url,null)
 const before=report.tables[0].chain;await copyTable({client,source,table});assert.equal((await snapshotReport(client)).tables[0].chain,before)
 client.close()
})
test('verification detects altered contents, counts and table/source identity without touching source data',async()=>{
 const client=memoryClient(),rows=[{id:1,manual_overrides:{tags:true},tags:[]}],source=sourceFor(rows)
 await initializeSnapshot(client,[table],'fixture');await copyTable({client,source,table})
 await client.execute(`UPDATE _copy_cards SET _row=json_set(_row,'$.tags',json_array('changed'))`)
 await assert.rejects(verifyTable({client,source,table}),/contenuto fallita/)
 await assert.rejects(initializeSnapshot(client,[table],'another-source'),/differente/)
 assert.deepEqual(rows[0].tags,[]);client.close()
})
test('composite cursors quote source values and HTTP source transport only uses GET/HEAD',async()=>{
 const composite={table_name:'set_carte',primary_key:['sigla','numero','variante']}
 const q=sourcePageQuery(composite,['A, "B"',7,'日本語'],50)
 assert.equal(q.get('order'),'sigla.asc,numero.asc,variante.asc')
 assert.equal(q.get('or'),'(sigla.gt."A, \\"B\\"",and(sigla.eq."A, \\"B\\"",numero.gt.7),and(sigla.eq."A, \\"B\\"",numero.eq.7,variante.gt."日本語"))'.replaceAll('\\\\','\\'))
 assert.throws(()=>sourcePageQuery({table_name:'cards;drop table cards',primary_key:['id']}))
 assert.throws(()=>canonicalJson({id:9007199254740992}),/senza perdita/)
 const methods=[],reader=createSourceReader({url:'https://source.supabase.co',key:'private',fetcher:async(url,options)=>{methods.push(options.method);return new Response(options.method==='HEAD'?null:'[{"id":1}]',{headers:{'content-range':'0-0/1'}})}})
 assert.equal(await reader.count(table),1);assert.deepEqual(await reader.page(table,null,10),[{id:1}]);assert.deepEqual(methods,['HEAD','GET'])
 assert.equal(hash(canonicalJson({b:1,a:[]})),hash(canonicalJson({a:[],b:1})))
})
test('a changed source count prevents a completed checkpoint',async()=>{
 const client=memoryClient();let calls=0
 const source={async count(){return ++calls===1?1:2},async page(){return [{id:1}]}}
 await initializeSnapshot(client,[table],'fixture')
 await assert.rejects(copyTable({client,source,table}),/Conteggio origine cambiato/)
 assert.equal((await client.execute('SELECT n FROM _catalog_snapshot_state')).rows[0].n,0);client.close()
})
test('freezing source writers leaves CI and migration workflows alone, waits for cancellation and stores no token',async()=>{
 const mutations=[],token='private',repo='claudio-git-poke/pokemon-catalog'
 const result=await freezeSourceWorkers({token,repo,runId:99,wait:async()=>{},log:()=>{},fetcher:async(url,options)=>{
  const path=new URL(url).pathname
  if(options.method!=='GET'){mutations.push(path);return new Response(null,{status:options.method==='PUT'?204:202})}
  if(path.includes('/workflows/'))return Response.json({id:SOURCE_WORKFLOWS.indexOf(path.split('/').at(-1))+1,state:'active'})
  return Response.json({workflow_runs:url.includes('status=queued')?[{id:50,workflow_id:1},{id:99,workflow_id:100}]:[]})
 }})
 assert.equal(result.workflows.length,SOURCE_WORKFLOWS.length);assert.equal(result.cancelled,1)
 assert.ok(mutations.every(p=>!p.includes('ci.yml')&&!p.includes('turso-')))
 assert.ok(!JSON.stringify(result).includes(token))
})
