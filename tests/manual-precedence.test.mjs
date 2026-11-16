import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import {resolvePublication} from '../scripts/bindex-identity.mjs'
import {selectedManualFields,protectionExpectedValues} from '../src/lib/manual-fields.ts'
const sql=async name=>readFile(new URL(`../db/${name}.sql`,import.meta.url),'utf8')
async function fixture({legacy=false,history=false,review=false}={}){
 const pg=new PGlite()
 try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table cards(id bigint primary key,nome text,sigla text,lingua text,numero integer,variante text,codice text,source_local_id text,source_card_id text,source_uid text,source_language text,image_url text,image_status text,image_source text,notes text,link_cardmarket text,updated_at timestamptz default now());`)
 await pg.exec(await sql('catalog-identification'))
 await pg.exec(await sql('bindex-export'))
 await pg.exec(await sql('catalog-cardmarket'))
 await pg.exec(await sql('bindex-contract'))
 await pg.exec(await sql('catalog-code-reviews'))
 await pg.exec(`create table catalog_visual_links(asset_key text,entry_key text,status text,image_match_status text,position text,primary key(asset_key,entry_key));
 create table catalog_visual_assets(asset_key text primary key,name text);
 create table catalog_printing_inventory(record_key text primary key,name text,tags text[],updated_at timestamptz);`)
 await pg.exec(`insert into cards(id,nome,sigla,lingua,numero,variante,codice,image_url,image_status) values(1,'Pikachu','PAL','INT',52,'normale','PAL 052','https://source.test/placeholder.png','missing');
 insert into set_espansioni(sigla,nome,lingua) values('PAL','Paldea','INT'),('BOO','Halloween','INT');
 insert into set_carte(sigla,numero,variante,nome,tag,codice,cardmarket_id,cardmarket_url) values('PAL',52,'normale','Pikachu',array['finish:holo'],'PAL 052',123,'https://www.cardmarket.com/it/Pokemon/Products/Singles/Original'),('BOO',52,'normale','Pikachu',array['family:trick-or-trade'],'PAL 052',null,null);
 insert into catalog_search_entries(entry_key,card_id,name,set_code,language,tags,facts,source_payload,verification) values('source:1',1,'Pikachu','PAL','INT',array['finish:holo','pattern:cosmo-holo'],'{"shiny":true}','{"variant":{"type":"holo","thirdParty":{"cardmarket":123}}}','source');
 insert into catalog_export_links(entry_key,sigla,numero,variante,method) values('source:1','PAL',52,'normale','source');`)
 if(legacy)await pg.exec(`update cards set image_status='manual',image_url='https://manual.test/legacy.png' where id=1;update catalog_search_entries set verification='reviewed' where entry_key='source:1';`)
 await pg.exec(await sql('manual-precedence'))
 await pg.exec('grant all on all tables in schema public to service_role;grant select,update on cards to anon;grant select on catalog_search_entries to anon;')
 if(history){
  await pg.exec(`alter table cards add column file_name text;
   create schema auth;create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;`)
  if(review)await pg.exec(`set role service_role;insert into catalog_code_reviews(sigla,numero,variante,cardmarket_id,status,proposed_code,source_urls,method,note,cardmarket_access) values('PAL',52,'normale',123,'verified','PAL 052',array['https://source.test/verified'],'source-review','checked','ok');reset role;`)
  await pg.exec(await sql('manual-review-history'))
 }
 return pg
 }catch(error){await pg.close();throw error}
}
const row=async(pg,table,where='true')=>(await pg.query(`select * from ${table} where ${where}`)).rows[0]

test('all manual card fields, empty values and repeated corrections survive stale workers; other fields still enrich',async()=>{
 const pg=await fixture();try{
  await pg.exec(`update cards set sigla='BOO',nome='Nome corretto',lingua='IT',numero=53,variante='reverse',codice=null,notes='Mia nota',image_url=null where id=1;`)
  await pg.exec('set role service_role')
  for(let i=0;i<2;i++)await pg.exec(`update cards set sigla='PAL',nome='Fonte',lingua='EN',numero=52,variante='holo',codice='PAL 052',notes='Fonte',image_url='https://source.test/a.png',image_status='found',link_cardmarket='https://source.test/product',manual_overrides='{}' where id=1;`)
  const c=await row(pg,'cards','id=1')
  assert.deepEqual([c.sigla,c.nome,c.lingua,c.numero,c.variante,c.codice,c.notes,c.image_url,c.image_status],['BOO','Nome corretto','IT',53,'reverse',null,'Mia nota',null,'missing'])
  assert.equal(c.link_cardmarket,'https://source.test/product')
  assert.equal((await row(pg,'catalog_search_entries',"entry_key='source:1'")).set_code,'BOO','existing variant search follows the parent manual set')
  await pg.exec(`update catalog_search_entries set set_code='PAL',name='Fonte',language='INT',tags=array['finish:holo'] where entry_key='source:1'`)
  const e=await row(pg,'catalog_search_entries',"entry_key='source:1'");assert.equal(e.set_code,'BOO');assert.equal(e.name,'Nome corretto');assert.equal(e.language,'IT');assert.match(e.search_text,/boo/)
  await pg.exec('delete from cards where id=1');assert.ok(await row(pg,'cards','id=1'))
  await pg.exec(`reset role;update cards set nome='Seconda correzione' where id=1;set role service_role;update cards set nome='Fonte' where id=1`)
  assert.equal((await row(pg,'cards','id=1')).nome,'Seconda correzione')
 }finally{await pg.close()}
})

test('tags are exact manual replacements, false facts and null links remain authoritative after source UPSERT',async()=>{
 const pg=await fixture();try{
  await pg.exec(`update catalog_search_entries set tags='{}',facts='{"shiny":false}',cardmarket_url=null,cardmarket_id=null,set_code='BOO' where entry_key='source:1';set role service_role;`)
  await pg.exec(`insert into catalog_search_entries(entry_key,card_id,name,set_code,language,tags,facts,source_payload,verification) values('source:1',1,'Fonte','PAL','INT',array['pattern:cosmo-holo'],'{"shiny":true}','{"variant":{"thirdParty":{"cardmarket":100}}}','source') on conflict(entry_key) do update set name=excluded.name,set_code=excluded.set_code,tags=excluded.tags,facts=excluded.facts,source_payload=excluded.source_payload;`)
  const e=await row(pg,'catalog_search_entries',"entry_key='source:1'");assert.deepEqual(e.tags,[]);assert.deepEqual(e.facts,{shiny:false});assert.equal(e.cardmarket_id,null);assert.equal(e.cardmarket_url,null);assert.equal(e.set_code,'BOO')
  assert.match(e.search_text,/boo/);assert.doesNotMatch(e.search_text,/cosmo/)
 }finally{await pg.close()}
})

test('published values beat source normalizers, reviewed-code triggers, photo RPC and link reassignments',async()=>{
 const pg=await fixture();try{
  await pg.exec(`insert into catalog_code_reviews(sigla,numero,variante,status,proposed_code,source_urls,method,note,cardmarket_access) values('PAL',52,'normale','verified','PAL 052',array['https://source.test'],'source','test','ok');
 update set_carte set nome='Mio nome',tag='{}',codice=null,cardmarket_url=null where sigla='PAL';
 insert into set_carte_immagini(sigla,numero,variante,lingua,immagine,fonte) values('PAL',52,'normale','IT','https://manual.test/foto.png','manuale');
 update catalog_export_links set sigla='BOO',method='manuale' where entry_key='source:1';set role service_role;`)
  await pg.exec(`insert into set_carte(sigla,numero,variante,nome,tag,codice,cardmarket_url) values('PAL',52,'normale','Nome fonte',array['finish:holo'],'PAL 052','https://www.cardmarket.com/it/Pokemon/Products/Singles/Test') on conflict(sigla,numero,variante) do update set nome=excluded.nome,tag=excluded.tag,codice=excluded.codice,cardmarket_url=excluded.cardmarket_url;
 select bindex_publish_photo('PAL',52,'normale','IT','https://source.test/other.png',null,'source',true);
 update catalog_export_links set sigla='PAL',method='source' where entry_key='source:1';`)
  const c=await row(pg,'set_carte',"sigla='PAL'");assert.equal(c.nome,'Mio nome');assert.deepEqual(c.tag,[]);assert.equal(c.codice,null);assert.equal(c.cardmarket_url,null)
  assert.equal((await row(pg,'set_carte_immagini')).immagine,'https://manual.test/foto.png');assert.equal((await row(pg,'catalog_export_links')).sigla,'BOO')
 }finally{await pg.close()}
})

test('editor choices lock even already-empty fields, automatic anon fallback does not create locks, and stale saves cannot erase locks',async()=>{
 const pg=await fixture();try{
  await pg.exec(`set role anon;update cards set notes=null,manual_overrides='{"notes":null}' where id=1;`)
  assert.ok(Object.hasOwn((await row(pg,'cards')).manual_overrides,'notes'))
  await pg.exec(`update cards set image_url='https://manual.test/new.png',manual_overrides='{}' where id=1;`)
  assert.ok(Object.hasOwn((await row(pg,'cards')).manual_overrides,'notes'))
  await pg.exec(`select set_config('request.headers','{"x-catalog-write-mode":"automatic"}',false);update cards set notes='Automatico',link_cardmarket='Fonte' where id=1;`)
  const c=await row(pg,'cards');assert.equal(c.notes,null);assert.equal(c.link_cardmarket,'Fonte');assert.ok(!Object.hasOwn(c.manual_overrides,'link_cardmarket'))
  await assert.rejects(pg.exec('update set_carte set nome=\'abuso\''),/permission denied/)
 }finally{await pg.close()}
})

test('explicit historical manual and reviewed markers are protected on migration',async()=>{
 const pg=await fixture({legacy:true});try{
  await pg.exec(`set role service_role;update cards set image_url='https://source.test/new.png',image_status='found' where id=1;update catalog_search_entries set tags='{}',verification='source' where entry_key='source:1';`)
  assert.equal((await row(pg,'cards')).image_url,'https://manual.test/legacy.png');const e=await row(pg,'catalog_search_entries',"entry_key='source:1'");assert.equal(e.verification,'reviewed');assert.equal(e.tags.length,2)
 }finally{await pg.close()}
})

test('publication respects manual BOO identity and suspends an ambiguous target instead of trusting upstream',()=>{
 const e={tags:[],set_code:'PAL',language:'INT',source_payload:{set:{id:'sv02'},variant:{type:'normal'}}}
 const c={nome:'Pikachu',sigla:'BOO',numero:52,variante:'normale',manual_overrides:{sigla:'BOO'}}
 const target={sigla:'BOO',numero:52,variante:'normale'}
 assert.equal(resolvePublication(e,c,[],[target]).row.sigla,'BOO')
 assert.equal(resolvePublication(e,c,[],[]).reason,'manual_identity_requires_explicit_mapping')
})

test('confirming existing values locks only selected fields and records human changes without logging worker noise',async()=>{
 const pg=await fixture({history:true});try{
  const c=await row(pg,'cards','id=1')
  await pg.exec('set role anon')
  const r=await pg.query('select catalog_protect_card_fields($1,$2,$3) r',[1,['nome','codice'],JSON.stringify(protectionExpectedValues(c,['nome','codice']))])
  assert.deepEqual(r.rows[0].r.protected_fields,['codice','nome'])
  await assert.rejects(pg.exec('select * from catalog_manual_history'),/permission denied/)
  await assert.rejects(pg.exec("insert into catalog_manual_history(table_name) values('fake')"),/permission denied/)
  await pg.exec(`set role service_role;update cards set nome='Nome automatico',codice='TEST 001',notes='Nota automatica' where id=1`)
  const saved=await row(pg,'cards','id=1');assert.equal(saved.nome,'Pikachu');assert.equal(saved.codice,'PAL 052');assert.equal(saved.notes,'Nota automatica')
  let log=(await pg.query('select * from catalog_manual_history order by id')).rows
  assert.equal(log.length,1);assert.equal(log[0].actor_role,'anon');assert.equal(log[0].reason,'confirm_existing_card_fields');assert.deepEqual(log[0].changed_fields,['codice','nome'])
  await assert.rejects(pg.exec('delete from catalog_manual_history'),/permission denied/)
  await pg.exec(`set role anon;update cards set nome='Correzione successiva' where id=1;set role service_role`)
  log=(await pg.query('select * from catalog_manual_history order by id')).rows
  assert.equal(log.length,2);assert.equal(log[1].before_values.nome,'Pikachu');assert.equal(log[1].after_values.nome,'Correzione successiva')
 }finally{await pg.close()}
})

test('protection rejects stale selections and forbidden fields and preserves a deliberate empty photo',async()=>{
 const pg=await fixture({history:true});try{
  const old=await row(pg,'cards','id=1')
  await pg.exec(`set role service_role;update cards set nome='Fonte aggiornata',image_url=null where id=1;set role anon;`)
  await assert.rejects(pg.query('select catalog_protect_card_fields($1,$2,$3)',[1,['nome'],JSON.stringify(protectionExpectedValues(old,['nome']))]),/cambiato/)
  assert.equal((await row(pg,'cards','id=1')).nome,'Fonte aggiornata')
  await assert.rejects(pg.query('select catalog_protect_card_fields($1,$2,$3)',[1,['source_uid'],'{}']),/Campo non modificabile/)
  const current=await row(pg,'cards','id=1')
  const result=await pg.query('select catalog_protect_card_fields($1,$2,$3) r',[1,['image_url'],JSON.stringify(protectionExpectedValues(current,['image_url']))])
  assert.deepEqual(result.rows[0].r.protected_fields,selectedManualFields(['image_url']))
  await pg.exec(`set role service_role;update cards set image_url='https://source.test/new.png',image_status='found',notes='new' where id=1`)
  assert.equal((await row(pg,'cards','id=1')).image_url,null);assert.equal((await row(pg,'cards','id=1')).notes,'new')
  assert.equal((await pg.query('select count(*)::int n from catalog_manual_history')).rows[0].n,1)
 }finally{await pg.close()}
})

test('historical verified code reviews are protected with recorded evidence, without claiming an inferred human origin',async()=>{
 const pg=await fixture({history:true,review:true});try{
  const log=(await pg.query('select * from catalog_manual_history order by id')).rows
  assert.equal(log.length,2);assert.ok(log.every(r=>r.reason==='existing_verified_code_review'))
  await pg.exec(`set role service_role;update catalog_code_reviews set status='pending',proposed_code=null;update set_carte set codice='TEST 001' where sigla='PAL';`)
  assert.equal((await row(pg,'catalog_code_reviews')).status,'verified');assert.equal((await row(pg,'set_carte',"sigla='PAL'")).codice,'PAL 052')
 }finally{await pg.close()}
})

test('documented generic rarity survives reindexing, honors manual empties and rejects another source identity',async()=>{
 const pg=await fixture();try{
  const migration=await sql('visual-card-fallback');await pg.exec(migration);await pg.exec(migration)
  await pg.exec(`set role service_role;update cards set source_card_id='sv02-269',source_language='it' where id=1;
   update catalog_search_entries set source_payload='{"id":"sv02-269","source_language":"it","rarity":"Rara illustrazione speciale","variant":{"type":"holo"}}',source_url='https://api.tcgdex.net/v2/it/cards/sv02-269' where entry_key='source:1';`)
  assert.equal((await pg.query('select catalog_backfill_generic_rarity() r')).rows[0].r.updated,1)
  let generic=await row(pg,'catalog_search_entries',"entry_key='card:1'")
  assert.ok(generic.tags.includes('rarity:special-illustration-rare'));assert.equal(generic.source_payload.variant,undefined);assert.equal(generic.verification,'catalog')
  assert.equal((await pg.query('select catalog_backfill_generic_rarity() r')).rows[0].r.updated,0,'a completed backfill is repeatable')
  await pg.exec("reset role;update cards set nome='Correzione assoluta' where id=1;")
  generic=await row(pg,'catalog_search_entries',"entry_key='card:1'");assert.ok(generic.tags.includes('rarity:special-illustration-rare'))
  await pg.exec("update catalog_search_entries set tags='{}',source_payload='{}' where entry_key='card:1';set role service_role;")
  assert.equal((await pg.query('select catalog_backfill_generic_rarity() r')).rows[0].r.updated,0)
  await pg.exec("update cards set nome='Fonte' where id=1;")
  generic=await row(pg,'catalog_search_entries',"entry_key='card:1'");assert.deepEqual(generic.tags,[]);assert.equal(generic.name,'Correzione assoluta')
  await pg.exec(`reset role;update catalog_search_entries set manual_overrides='{}' where entry_key='card:1';set role service_role;
   update catalog_search_entries set source_payload='{"id":"different-card","source_language":"it","rarity":"Common"}' where entry_key='source:1';`)
  assert.equal((await pg.query('select catalog_backfill_generic_rarity() r')).rows[0].r.updated,0)
  await pg.exec('reset role;set role anon');await assert.rejects(pg.exec('select catalog_backfill_generic_rarity()'),/permission denied/)
 }finally{await pg.close()}
})
