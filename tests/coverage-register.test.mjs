import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {sourceManifest} from '../scripts/catalog-manifest.mjs'
import {CATALOG_LANGUAGES} from '../src/lib/catalog-languages.ts'
import {resolvePublication} from '../scripts/bindex-identity.mjs'
test('manifests detect different identities with equal counts and preserve regional separation',()=>{
 const same=sourceManifest(['b','a'],['a','b']);assert.equal(same.manifest_digest,same.resolved_digest)
 const different=sourceManifest(['a','b'],['a','c']);assert.notEqual(different.manifest_digest,different.resolved_digest)
 assert.equal(sourceManifest(['a','a'],['a']).resolved_count,1)
 assert.equal(CATALOG_LANGUAGES.length,16);assert.equal(new Set(CATALOG_LANGUAGES.map(l=>l.code)).size,16)
 assert.equal(resolvePublication({language:'ES-LA',tags:[],set_code:'sv09',source_payload:{}},{},[],[]).reason,'regional_identity_requires_verified_mapping')
})
test('coverage requires fresh manifest evidence, records gaps and excludes digital cards; public clients cannot certify it',async()=>{
 const pg=new PGlite()
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create table catalog_sync_sets(source_uid text primary key,provider text default 'tcgdex',source_language text,set_id text,name text,last_sync_at timestamptz,next_sync_at timestamptz default now(),last_error text,card_count int default 0,reported_count int);
  create table catalog_releases(code text,name text,source_url text);
  grant select on catalog_sync_sets,catalog_releases to anon;
  insert into catalog_sync_sets(source_uid,source_language,set_id,name,last_sync_at,reported_count) values('legacy','en','old','Old import',now(),2),('pending','en','p','Pending',null,2);
  insert into catalog_releases values('boo24','BOO 2024','https://source.test');`)
  await pg.exec(await readFile(new URL('../db/catalog-coverage-register.sql',import.meta.url),'utf8'))
  await pg.exec(`insert into catalog_sync_sets(source_uid,source_language,set_id,name,last_sync_at,reported_count,manifest_count,resolved_count,manifest_digest,resolved_digest,coverage_checked_at,coverage_scope) values
  ('aligned','en','a','Aligned',now(),2,2,2,'same','same',now(),'physical'),
  ('mismatch','en','b','Mismatch',now(),2,2,2,'left','right',now(),'physical'),
  ('stale','en','c','Stale',now(),2,2,2,'same','same',now()-interval '9 days','physical'),
  ('digital','en','A1','Pocket',now(),null,null,null,null,null,null,'digital');
  insert into catalog_sync_sets(source_uid,source_language,set_id,name,last_sync_at) values('index:en','en','__index__','Index',now());`)
  const states=(await pg.query("select target_key,status from catalog_coverage_register where target_type='set'")).rows
  const get=k=>states.find(r=>r.target_key===k).status
  assert.equal(get('legacy'),'to_review');assert.equal(get('pending'),'to_import');assert.equal(get('aligned'),'aligned');assert.equal(get('mismatch'),'to_review');assert.equal(get('stale'),'to_review');assert.equal(get('digital'),'excluded')
  assert.equal((await pg.query("select probe_status from catalog_language_sources where source_language='en'")).rows[0].probe_status,'available')
  assert.equal((await pg.query('select count(*) n from catalog_language_sources')).rows[0].n,CATALOG_LANGUAGES.length)
  await pg.exec('set role anon')
  const report=(await pg.query("select catalog_coverage_report('aligned',null,null,'',0,25) r")).rows[0].r
  assert.equal(report.total,1);assert.equal(report.rows[0].target_key,'aligned');assert.equal(report.rows[0].variants_status,'unverified')
  await assert.rejects(pg.exec("update catalog_language_sources set probe_status='available'"),/permission denied/)
 }finally{await pg.close()}
})
