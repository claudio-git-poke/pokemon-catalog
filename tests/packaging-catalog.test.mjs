import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {parsePackagingCatalog,packagingIdentity,proposePackagingLinks} from '../scripts/packaging-catalog.mjs'
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8')
const original=await read('data/packaging/catalogo-sealed-2026-11-17.txt'),catalog=parsePackagingCatalog(original)
const find=id=>catalog.rows.find(r=>r.source_row_number===id)
test('all original claims, sources, uncertainty and distinct distributions survive parsing',()=>{
 assert.equal(catalog.rows.length,494);assert.deepEqual(catalog.counts,{A:36,B:371,C:87});assert.equal(catalog.document.source_manifest.length,55)
 assert.equal(catalog.rows.filter(r=>r.packaging_types.includes('S4')).length,172)
 assert.equal(new Set(catalog.rows.map(r=>r.candidate_key)).size,494)
 assert.equal(find(5).language,'und');assert.equal(find(5).raw_language,'Internazionale')
 assert.equal(find(212).card_number,find(397).card_number);assert.notEqual(find(212).candidate_key,find(397).candidate_key)
 assert.ok(find(300).uncertainties.includes('individual-pack-contents-unknown'))
 assert.equal(find(99).review_status,undefined,'a claimed A does not create a confirmation')
 assert.deepEqual(parsePackagingCatalog(original),catalog)
 assert.throws(()=>parsePackagingCatalog(original.replace('F01, F44','F999, F44')),/Fonte assente/)
 assert.throws(()=>parsePackagingCatalog(original.replace('RIGHE: 494','RIGHE: 493')),/discordante/)
})
test('candidate matching requires an explicit set, number and card language and never invents a printing',()=>{
 const cards=[{id:1,sigla:'SWSHP@INT',lingua:'INT',source_language:'en',source_local_id:'SWSH074',source_uid:'tcgdex:en:swshp-SWSH074'},
  {id:2,sigla:'SWSHP@IT',lingua:'IT',source_language:'it',source_local_id:'SWSH074'},
  {id:3,sigla:'BASEP@INT',lingua:'INT',source_language:'en',source_local_id:'074'},
  {id:4,sigla:'SWSHP@INT',lingua:'INT',source_language:'it',source_local_id:'SWSH074'}]
 const links=proposePackagingLinks([find(102)],cards)
 assert.deepEqual(links.map(l=>l.card_id),[1]);assert.equal(links[0].status,'candidate');assert.equal(links[0].entry_key,null);assert.equal(links[0].evidence_url,null)
 assert.equal(packagingIdentity('025/165','DE'),null);assert.equal(packagingIdentity('WOTC 2','und'),null)
 assert.deepEqual(packagingIdentity('004/PLAY','JP'),{set:'PLAY',number:'4',language:'JP'})
 assert.deepEqual(packagingIdentity('SM103a','INT'),{set:'SMP',number:'103a',language:'INT'})
 const twins=[{id:8,sigla:'PLAY@JP',lingua:'JP',source_local_id:'004'}, {id:9,sigla:'PLAY@JP',lingua:'JP',source_local_id:'004'}]
 assert.equal(proposePackagingLinks([find(11)],twins).length,2,'multiple plausible source identities remain candidates')
})
async function fixture(){
 const pg=new PGlite()
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema catalog_internal;
 create table cards(id bigint primary key,nome text,sigla text,lingua text,source_local_id text,source_language text,source_uid text,manual_overrides jsonb default '{}');
 create table catalog_search_entries(entry_key text primary key,card_id bigint references cards(id),verification text,source_payload jsonb);
 create table catalog_manual_history(id bigint generated always as identity primary key,table_name text,record_key jsonb,changed_fields text[],before_values jsonb,after_values jsonb,previous_overrides jsonb,new_overrides jsonb,actor_role text,actor_subject text,reason text);
 create function catalog_normalize(value text) returns text language sql immutable as $$select lower(coalesce(value,''))$$;
 insert into cards(id,nome) values(1,'Original'),(2,'Another');
 insert into catalog_search_entries values('card:1',1,'catalog','{}'),('printing:1',1,'source','{"variant":{"type":"holo"}}'),('metadata:1',1,'source','{"metadata_scope":"card-metadata-only"}'),('printing:2',2,'source','{}');
 grant all on cards,catalog_search_entries to service_role;grant select on catalog_manual_history to service_role;grant select on cards,catalog_search_entries to anon;`)
 await pg.exec((await read('db/manual-precedence.sql')).split('create or replace function public.catalog_manual_card_changed()')[0])
 await pg.exec(await read('db/packaging-catalog.sql'));await pg.exec(await read('db/packaging-catalog.sql'))
 return pg
}
test('repeatable SQL import keeps every claim pending, leaves existing cards untouched and exposes read-only public access',async()=>{
 const pg=await fixture();try{
  const before=(await pg.query('select * from cards order by id')).rows,seed=await read('db/packaging-catalog-seed.sql')
  await pg.exec(seed);await pg.exec(seed)
  assert.equal((await pg.query('select count(*)::int n from catalog_packaging_candidates')).rows[0].n,494)
  assert.equal((await pg.query("select count(*)::int n from catalog_packaging_candidates where review_status<>'pending'")).rows[0].n,0)
  assert.deepEqual((await pg.query('select * from cards order by id')).rows,before)
  assert.equal((await pg.query('select count(*)::int n from catalog_manual_history')).rows[0].n,0)
  await pg.exec('set role anon');assert.equal((await pg.query('select count(*)::int n from catalog_packaging_candidates')).rows[0].n,494)
  await assert.rejects(pg.exec("update catalog_packaging_candidates set review_status='confirmed'"),/permission denied/)
  await assert.rejects(pg.exec('insert into catalog_packaging_documents(document_key) values(\'x\')'),/permission denied/)
 }finally{await pg.close()}
})
test('manual packaging corrections, deliberate nulls and rejected card links survive repeated automatic imports with audit history',async()=>{
 const pg=await fixture();try{
  const seed=await read('db/packaging-catalog-seed.sql');await pg.exec(seed)
  const key=find(102).candidate_key
  await pg.query("update catalog_packaging_candidates set name='Mia correzione',review_note=null,manual_overrides='{\"review_note\":null,\"wrapper_front_url\":null}' where candidate_key=$1",[key])
  await pg.exec('set role service_role')
  await pg.query("insert into catalog_packaging_links(candidate_key,card_id,method) values($1,1,'exact-set-number-language')",[key])
  await pg.exec('reset role')
  await pg.query("update catalog_packaging_links set status='rejected',note='Numero corretto, stampa sbagliata' where candidate_key=$1",[key])
  await pg.exec(seed)
  await pg.exec('set role service_role')
  await pg.query("update catalog_packaging_candidates set name='Fonte',review_note='Fonte',wrapper_front_url='https://source.test/wrapper.png',manual_overrides='{}' where candidate_key=$1",[key])
  await pg.query("update catalog_packaging_links set status='candidate',note='Fonte',manual_overrides='{}' where candidate_key=$1",[key])
  const row=(await pg.query('select * from catalog_packaging_candidates where candidate_key=$1',[key])).rows[0]
  assert.equal(row.name,'Mia correzione');assert.equal(row.review_note,null);assert.equal(row.wrapper_front_url,null)
  assert.match(row.search_text,/mia correzione/)
  assert.equal((await pg.query('select status from catalog_packaging_links where candidate_key=$1',[key])).rows[0].status,'rejected')
  assert.equal((await pg.query('select count(*)::int n from catalog_manual_history')).rows[0].n,2)
  await pg.exec('set role anon');assert.equal((await pg.query('select count(*)::int n from catalog_packaging_links')).rows[0].n,0)
 }finally{await pg.close()}
})
test('confirming a packaging requires proof and its printing link must belong to the same card and an identified printing',async()=>{
 const pg=await fixture();try{
  await pg.exec(await read('db/packaging-catalog-seed.sql'));await pg.exec('reset role')
  const key=find(102).candidate_key
  await assert.rejects(pg.query("update catalog_packaging_candidates set review_status='confirmed' where candidate_key=$1",[key]),/check constraint/)
  await pg.query("update catalog_packaging_candidates set review_status='confirmed',review_source_url='https://proof.test/item',reviewed_at=now() where candidate_key=$1",[key])
  for(const entry of ['card:1','metadata:1','printing:2'])await assert.rejects(pg.query("insert into catalog_packaging_links(candidate_key,card_id,entry_key,method,status,evidence_url) values($1,1,$2,'manual','confirmed','https://proof.test/printing')",[key,entry]),/stampa|scheda|appartiene/i)
  await pg.query("insert into catalog_packaging_links(candidate_key,card_id,entry_key,method,status,evidence_url) values($1,1,'printing:1','manual','confirmed','https://proof.test/printing')",[key])
  assert.equal((await pg.query('select status from catalog_packaging_links')).rows[0].status,'confirmed')
 }finally{await pg.close()}
})
