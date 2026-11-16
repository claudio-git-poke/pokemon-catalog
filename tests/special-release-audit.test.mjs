import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import {postgresClient} from './helpers/postgres-client.mjs'
import {releaseCardIndex,resolveReleaseCard,sourceIdentities} from '../scripts/release-card-links.mjs'
import {summarizeReleases} from '../scripts/special-release-audit.mjs'
import {enrichCatalog} from '../scripts/enrich-catalog.mjs'
import {resolvePublication} from '../scripts/bindex-identity.mjs'
test('source identity survives manual set/name changes and legacy ambiguities never choose the first row',async()=>{
 const pg=new PGlite();try{
  await pg.exec(`create table cards(id bigint primary key,nome text,sigla text,lingua text,numero int,source_uid text,source_card_id text,source_language text,source_local_id text,manual_overrides jsonb);
  insert into cards values(1,'Mio nome','BOO','INT',52,'tcgdex:en:swsh2-015','swsh2-015','en','015','{"nome":"Mio nome","sigla":"BOO"}'),
  (2,'Trevenant','SWSH2@INT','INT',15,null,null,null,'015','{}');`)
  const row={set_id:'swsh2',local_id:'015',name:'Trevenant'}
  const before=(await pg.query('select * from cards order by id')).rows
  const index=await releaseCardIndex(postgresClient(pg),[row]);assert.equal(resolveReleaseCard(row,index).card.id,1)
  assert.deepEqual((await pg.query('select * from cards order by id')).rows,before,'link discovery never changes the underlying human values')
  const legacy={id:3,nome:'Trevenant',sigla:'SWSH2@INT',lingua:'INT',numero:15}
  assert.equal(resolveReleaseCard(row,[legacy]).card.id,3)
  assert.equal(resolveReleaseCard(row,[legacy,{...legacy,id:4}]).reason,'ambiguous_legacy_identity')
  assert.equal(resolveReleaseCard({...row,set_id:null},index).reason,'printing_identity_undocumented')
  assert.ok(sourceIdentities({set_id:'swshp',local_id:'SWSH111'}).includes('tcgdex:en:swshp-SWSH111'))
 }finally{await pg.close()}
})
test('release report separates duplicate copies, unknown Energy printings and missing source manifests',()=>{
 const card={id:1,source_uid:'tcgdex:en:sm1-1',nome:'A',sigla:'SM1@INT',lingua:'INT'}
 const row={release_code:'battle-academy-2020',release_name:'BA 2020',set_id:'sm1',local_id:'1',name:'A',deck:'pikachu',deck_number:1}
 const report=summarizeReleases([row,{...row},{...row,set_id:null,local_id:null,name:'Fire Energy',deck_number:2}],[card],[],[],[{sigla:'BA20'},{sigla:'PPS3',nome:'PPS3'}],[])
 const ba=report.find(r=>r.canonical_set==='BA20');assert.equal(ba.documented,3);assert.equal(ba.unique,2);assert.equal(ba.duplicate_copies,1);assert.equal(ba.undocumented_printing,1);assert.equal(ba.source_unlinked,0)
 const pps=report.find(r=>r.canonical_set==='PPS3');assert.equal(pps.documented,null);assert.equal(pps.source_unlinked,null);assert.equal(pps.status,'source_manifest_missing')
})
test('legacy MFB identities can retrieve source variants without borrowing the canonical ordinal or overwriting names',async()=>{
 const writes=[]
 const db={from(table){const q={upsert(rows){writes.push({table,rows});return q},update(rows){writes.push({table,rows});return q},eq(){return q},in(){return q},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve)}};return q}}
 const stats=await enrichCatalog({db,log:()=>{},cardRows:[{id:25,nome:'Energia base Fuoco',sigla:'MFB',lingua:'INT',source_uid:null,source_card_id:'mfb-16',source_language:'en'}],fetchDetail:async()=>({id:'mfb-16',localId:'16',set:{id:'mfb'},variants:[{type:'normal',stamp:['charmander']}]})})
 assert.equal(stats.checked,1)
 const entry=writes.find(w=>w.table==='catalog_search_entries').rows[0];assert.equal(entry.collector_number,null);assert.equal(entry.name,'Energia base Fuoco');assert.ok(entry.tags.includes('family:my-first-battle'))
 assert.deepEqual(Object.keys(writes.find(w=>w.table==='cards').rows).sort(),['traits_checked_at','traits_last_error','traits_next_attempt_at'])
})
test('MFB translated names compare in the same normalized namespace while keeping the existing canonical ordinal',()=>{
 const result=resolvePublication({tags:['family:my-first-battle'],language:'INT',set_code:'MFB',source_payload:{variant:{type:'normal',thirdParty:{cardmarket:123}},has_normal_variant:true}},
 {nome:'Fire Energy'},[{sigla:'MFB',lingua:'INT'}],[{sigla:'MFB',numero:25,variante:'normale',nome:'Energia base Fuoco',cardmarket_id:123}])
 assert.equal(result.row.numero,25)
})
test('special audit results are readable anonymously but only workers may write them; schema replays safely',async()=>{
 const pg=new PGlite();try{
  await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;')
  const sql=await readFile(new URL('../db/special-release-audit.sql',import.meta.url),'utf8');await pg.exec(sql);await pg.exec(sql)
  await pg.exec(`set role service_role;insert into catalog_special_release_audit values('latest','{"ok":true}',now());reset role;set role anon;`)
  assert.equal((await pg.query('select report from catalog_special_release_audit')).rows[0].report.ok,true)
  await assert.rejects(pg.exec("update catalog_special_release_audit set report='{}'"),/permission denied/)
 }finally{await pg.close()}
})
