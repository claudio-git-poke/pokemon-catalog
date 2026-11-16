import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import {postgresClient} from './helpers/postgres-client.mjs'
import {runCoverageAudit} from '../scripts/coverage-audit.mjs'
import {sourceManifest} from '../scripts/catalog-manifest.mjs'
const sql=name=>readFile(new URL(`../db/${name}.sql`,import.meta.url),'utf8')
async function fixture(){
 const pg=new PGlite();try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table cards(id bigint primary key,sigla text,lingua text,source_uid text,source_card_id text,source_local_id text,source_language text,image_status text,image_url text,traits_checked_at timestamptz,traits_last_error text);
 create table catalog_search_entries(entry_key text primary key,card_id bigint references cards(id),tags text[],facts jsonb,verification text,name text,set_code text,source_payload jsonb,collector_number text);create index on catalog_search_entries(card_id);
 create table catalog_printing_inventory(record_key text primary key,card_id bigint references cards(id),scope text,language text,source_set_code text,image_status text,canonical_mapping_status text,deleted boolean default false);
 create table catalog_sync_sets(source_uid text primary key,provider text,source_language text,set_id text,name text,last_sync_at timestamptz,next_sync_at timestamptz,last_error text,reported_count int);
 create table catalog_releases(code text,name text,source_url text);
 create table set_carte(sigla text,numero int,variante text,tag text[],immagine text,immagine_verificata boolean,eliminata boolean);
 create table set_carte_immagini(immagine text,sigla text,numero int,variante text,verificata boolean);
 create table catalog_quality_cache(scope text primary key,report jsonb,updated_at timestamptz default clock_timestamp());
 create function catalog_number(v text) returns text language sql immutable as $$select ltrim(v,'0')$$;
 grant select on catalog_sync_sets,catalog_releases,catalog_quality_cache to anon;grant all on all tables in schema public to service_role;
 insert into catalog_quality_cache values('catalog','{"old":true}',now()-interval '2 days');`)
 await pg.exec(await sql('catalog-coverage-register'))
 await pg.exec(await sql('coverage-audit'))
 await pg.exec(await sql('source-manifest-audit'))
 await pg.exec(await sql('coverage-audit-report'))
 await pg.exec(`insert into cards values
 (1,'BOO@INT','INT','tcgdex:en:test-1','test-1','1','en','found','https://image.test/generic.png',null,null),
 (2,'TEST@INT','INT','tcgdex:en:test-2','test-2','2','en','placeholder',null,now(),null),
 (3,'SVJL@JP','JP','atlas:ja:SVJL-45801','SVJL-45801','001','ja','found','https://image.test/generic-jp.png',null,null),
 (4,'OLD','INT',null,null,null,null,'missing',null,null,null);
 insert into catalog_search_entries values
 ('tcgdex:a',1,array['finish:holo'],'{}','source','A','BOO@INT','{"id":"test-1","localId":"1"}','1'),
 ('tcgdex:b',2,array['finish:normal','finish:holo'],'{}','source','B','TEST@INT','{"id":"test-2","localId":"2"}','2');
 insert into catalog_printing_inventory values
 ('a',1,'printing','EN','BOO@INT','candidate','pending',false),('b',2,'printing','EN','TEST@INT','missing','linked',false),
 ('c',3,'card','JP','SVJL@JP','missing','pending',false),('d',4,'printing','und','OLD','missing','pending',true);
 insert into catalog_sync_sets(source_uid,provider,source_language,set_id,name,last_sync_at,reported_count,coverage_scope) values
 ('tcgdex:en:test','tcgdex','en','test','Test',now(),2,'physical'),('tcgdex:fr:new','tcgdex','fr','new','New set',null,100,'physical'),
 ('tcgdex:en:A1','tcgdex','en','A1','Pocket',now(),100,'digital');
 insert into set_carte values('TEST',1,'normale','{}',null,false,false),('TEST',2,'holo',array['finish:holo'],'https://image.test/card.png',true,false),('TEST',3,'holo','{}',null,false,true);
 insert into set_carte_immagini values('https://image.test/shared.png','TEST',1,'normale',true),('https://image.test/shared.png','TEST',2,'holo',true);
 set role service_role;`)
 return pg
 }catch(e){await pg.close();throw e}
}
function dbFor(pg){return {...postgresClient(pg),rpc:async(name,args={})=>{
 try{if(!/^[a-z_]+$/.test(name)||Object.keys(args).some(k=>!/^[a-z_]+$/.test(k)))throw Error('Invalid RPC')
 const entries=Object.entries(args),values=entries.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v)
 const q=`select public.${name}(${entries.map(([k],i)=>`${k}=>$${i+1}`).join(',')}) data`
 return {data:(await pg.query(q,values)).rows[0].data,error:null}
 }catch(e){return {data:null,error:{message:e.message,code:e.code}}}
 }}}

test('bounded coverage scan resumes without double counts, separates generic images and publishes only a completed result',async()=>{
 const pg=await fixture();try{
 const db=dbFor(pg);let fail=true
 const paused={...db,rpc:async(name,args)=>{if(name==='catalog_coverage_card_batch'&&args.after_id===2&&fail){fail=false;return {error:{message:'statement timeout',code:'57014'}}}return db.rpc(name,args)}}
 const opts={log:()=>{},cardBatchSize:2,inventoryBatchSize:2,checkpointMs:0,minAgeMs:0}
 const first=await runCoverageAudit({...opts,db:paused});assert.equal(first.deferred,true)
 assert.equal((await pg.query("select report from catalog_quality_cache where scope='catalog'")).rows[0].report.old,true)
 assert.equal((await pg.query("select count(*)::int n from catalog_coverage_snapshots where scope='latest'")).rows[0].n,0)
 const result=await runCoverageAudit({...opts,db});assert.equal(result.complete,true)
 const r=(await pg.query("select report from catalog_coverage_snapshots where scope='latest'")).rows[0].report
 assert.equal(r.totals.total,4);assert.equal(r.inventory.inventory_entries,3);assert.equal(r.inventory.printing_entries,2)
 assert.equal(r.inventory.missing_exact,1);assert.equal(r.inventory.candidate_exact,1);assert.equal(r.inventory.verified_exact,0);assert.equal(r.inventory.unidentified_entries,1)
 assert.equal(r.groups.find(g=>g.source_provider==='tcgdex').origin_set,'test','a manual classification is kept separate from the original source list')
 assert.equal(r.groups.find(g=>g.source_provider==='atlas').origin_set,'svjl','Atlas external ID suffix is not its printed collector number')
 assert.ok(r.groups.some(g=>g.origin_language==='und'),'legacy INT is not guessed to be English')
 const quality=(await pg.query("select report from catalog_quality_cache where scope='catalog'")).rows[0].report
 assert.equal(quality.warnings.total,1);assert.equal(quality.warnings.by_reason.finish_conflict,1);assert.equal(quality.published.total,2);assert.equal(quality.warnings.shared_verified_images,1)
 assert.equal((await pg.query("select report->>'phase' phase from catalog_coverage_snapshots where scope='checkpoint'")).rows[0].phase,'complete')
 assert.equal((await runCoverageAudit({db,log:()=>{}})).skipped,true)
 }finally{await pg.close()}
})

test('coverage never turns unmeasured lists into zero missing cards and preserves pending counts and language evidence',async()=>{
 const pg=await fixture();try{
 const missing=sourceManifest(['test-1','test-2'],['test-1'])
 await postgresClient(pg).from('catalog_sync_sets').update(missing).eq('source_uid','tcgdex:en:test')
 const initial=(await pg.query('select catalog_coverage_audit_report() r')).rows[0].r
 assert.equal(initial.snapshot,null);assert.equal(initial.rows.find(r=>r.source_set==='new').missing_count,null);assert.equal(initial.rows.find(r=>r.source_set==='new').cards,null)
 await runCoverageAudit({db:dbFor(pg),log:()=>{},minAgeMs:0,cardBatchSize:2,inventoryBatchSize:2})
 await pg.exec('reset role;set role anon')
 const report=(await pg.query('select catalog_coverage_audit_report() r')).rows[0].r
 const row=report.rows.find(r=>r.source_set==='test');assert.equal(row.cards,2);assert.equal(row.missing_count,1);assert.equal(row.pending_identity,1);assert.equal(row.missing_exact,1);assert.deepEqual(row.coverage_detail.missing_ids,['test-2'])
 assert.ok(!report.rows.some(r=>r.source_set==='a1'));assert.ok(report.stats.unmeasured>0);assert.equal(report.stats.known_missing_ids,1)
 assert.equal((await pg.query("select catalog_coverage_audit_report('cards') r")).rows[0].r.total,1)
 assert.equal((await pg.query("select count(*)::int n from catalog_coverage_snapshots where scope='checkpoint'")).rows[0].n,0)
 await assert.rejects(pg.exec('select catalog_coverage_scan_bounds()'),/permission denied/)
 await assert.rejects(pg.exec("insert into catalog_coverage_snapshots values('latest','{}',now())"),/permission denied/)
 }finally{await pg.close()}
})

test('importer refresh requests do not execute an expensive aggregate, and incomplete publication preserves the saved report',async()=>{
 const pg=await fixture();try{
 await pg.exec('select catalog_refresh_quality_cache()')
 assert.equal((await pg.query("select report from catalog_quality_cache where scope='catalog'")).rows[0].report.old,true)
 assert.equal((await pg.query("select count(*)::int n from catalog_coverage_snapshots where scope='request'")).rows[0].n,1)
 await assert.rejects(pg.query('select catalog_publish_coverage_audit($1,$2)',[JSON.stringify({complete:false}),JSON.stringify({})]),/incompleta/)
 assert.equal((await pg.query("select report from catalog_quality_cache where scope='catalog'")).rows[0].report.old,true)
 }finally{await pg.close()}
})

test('page manifests expose missing exact links, preserve unknown extra IDs and never invent inventory zeroes',async()=>{
 const pg=await fixture();try{
  await pg.exec(`insert into catalog_sync_sets(source_uid,provider,source_language,set_id,name,last_sync_at) values
   ('official:page:1','supplement-th','th','1','Official page',now());`)
  const manifest=sourceManifest(['asia-official:th:1','asia-official:th:2'],['asia-official:th:1'])
  manifest.coverage_detail={...manifest.coverage_detail,comparison_scope:'expected_source_links',unexpected_count:null}
  assert.equal((await pg.query('select catalog_save_manifest_audit($1,$2,$3,$4) ok',['official:page:1','1',null,JSON.stringify(manifest)])).rows[0].ok,true)
  await runCoverageAudit({db:dbFor(pg),log:()=>{},minAgeMs:0})
  await pg.exec("update catalog_sync_sets set manifest_last_attempt_at=now(),manifest_last_error='HTTP 503' where source_uid='official:page:1';reset role;set role anon")
  const row=(await pg.query("select * from catalog_coverage_audit_rows where target_key='official:page:1'")).rows[0]
  assert.equal(row.missing_count,1);assert.equal(row.unexpected_count,null);assert.equal(row.cards,null);assert.equal(row.inventory_entries,null);assert.match(row.reason,/503/)
 }finally{await pg.close()}
})

test('source manifest identifies missing and unexpected IDs with equal totals and limits example storage',()=>{
 const details=sourceManifest(['a','b'],['a','c']).coverage_detail
 assert.equal(details.missing_count,1);assert.equal(details.unexpected_count,1);assert.deepEqual(details.missing_ids,['b']);assert.deepEqual(details.unexpected_ids,['c'])
 assert.equal(sourceManifest(['a','a'],['a']).coverage_detail.duplicate_count,1)
 const many=sourceManifest(Array.from({length:100},(_,i)=>String(i)),[]).coverage_detail
 assert.equal(many.missing_count,100);assert.equal(many.missing_ids.length,30)
})

test('new imports do not extend an active scan and are included in the next completed scan',async()=>{
 const pg=await fixture();try{
  const db=dbFor(pg);let inserted=false
  const live={...db,rpc:async(name,args)=>{const result=await db.rpc(name,args);if(name==='catalog_coverage_scan_bounds'&&!inserted){inserted=true;await pg.exec("insert into cards(id,sigla,lingua,image_status) values(99,'OLD','INT','missing')")}return result}}
  await runCoverageAudit({db:live,log:()=>{},minAgeMs:0,cardBatchSize:2,inventoryBatchSize:2})
  assert.equal((await pg.query("select report->'totals'->>'total' n from catalog_coverage_snapshots where scope='latest'")).rows[0].n,'4')
  await runCoverageAudit({db,log:()=>{},minAgeMs:0,cardBatchSize:2,inventoryBatchSize:2})
  assert.equal((await pg.query("select report->'totals'->>'total' n from catalog_coverage_snapshots where scope='latest'")).rows[0].n,'5')
 }finally{await pg.close()}
})
