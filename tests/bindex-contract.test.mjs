import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {validatePublication,canonicalMarketPage,publicationPhoto} from '../scripts/bindex-contract.mjs'
test('publication gate validates canonical identities and requires documented photo language',()=>{
 const row={sigla:'PAL',numero:50,variante:'normale',nome:'Pikachu',codice:'PAL 050',tag:[]}
 assert.equal(validatePublication(row),null)
 assert.equal(validatePublication({...row,numero:'50'}),'invalid_canonical_identity')
 assert.equal(validatePublication({...row,variante:undefined}),'invalid_canonical_identity')
 assert.equal(validatePublication({...row,codice:'PAL ?'}),'invalid_printed_code')
 assert.equal(canonicalMarketPage('https://www.cardmarket.com/it/Pokemon/Products?idProduct=100'),null)
 assert.ok(canonicalMarketPage('https://www.cardmarket.com/it/Pokemon/Products/Singles/Paldea/Pikachu'))
 const e={image_url:'https://images.test/en.jpg',source_url:'https://source.test/card',source_payload:{source_language:'en'},verification:'source'}
 assert.equal(publicationPhoto(e,{}).image_language,'EN')
 assert.equal(publicationPhoto(e,{}).image_verified,false)
 assert.equal(publicationPhoto({...e,source_payload:{reference_image_only:true,source_language:'en'}},{}),null)
 assert.equal(publicationPhoto({...e,source_payload:{}},{}),null)
})
test('Bindex contract repairs URLs without changing keys, preserves Italian photos, and pages tied timestamps including tombstones',async()=>{
 const pg=new PGlite()
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create table cards(id bigint primary key,link_cardmarket text);
  create table catalog_search_entries(entry_key text primary key,card_id bigint references cards(id),verification text default 'source',source_payload jsonb default '{}',updated_at timestamptz default now());`)
  for(const file of ['bindex-export.sql','catalog-cardmarket.sql'])await pg.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'))
  await pg.exec(`insert into set_espansioni(sigla,nome,lingua) values('PAL','Paldea','INT');
  insert into set_carte(sigla,numero,variante,nome,cardmarket_id) values('PAL',1,'normale','First',100),('PAL',2,'normale','Second',200),('PAL',3,'reverse','Third',300);`)
  await pg.exec(await readFile(new URL('../db/bindex-contract.sql',import.meta.url),'utf8'))
  assert.equal((await pg.query('select bindex_repair_urls(10) n')).rows[0].n,3)
  await pg.exec('alter table set_carte validate constraint set_carte_cardmarket_url_check')
  assert.deepEqual((await pg.query('select numero,cardmarket_id,cardmarket_url from set_carte order by numero')).rows.map(r=>[r.numero,Number(r.cardmarket_id),r.cardmarket_url]),[[1,100,null],[2,200,null],[3,300,null]])
  // A stale worker cannot reintroduce a redirect, while the product ID survives.
  await pg.exec("update set_carte set cardmarket_url='https://www.cardmarket.com/it/Pokemon/Products?idProduct=100' where numero=1")
  assert.equal((await pg.query('select count(cardmarket_url) n from set_carte')).rows[0].n,0)
  await pg.exec("select bindex_publish_photo('PAL',1,'normale','EN','https://img.test/en.jpg',null,'https://source.test',false)")
  await pg.exec("select bindex_publish_photo('PAL',1,'normale','IT','https://img.test/it.jpg',null,'https://source.test',true)")
  await pg.exec("select bindex_publish_photo('PAL',1,'normale','FR','https://img.test/fr.jpg',null,'https://source.test',false)")
  await pg.exec("select bindex_publish_photo('PAL',1,'normale','IT','https://img.test/weaker.jpg',null,'https://source.test',false)")
  assert.equal((await pg.query('select immagine from set_carte where numero=1')).rows[0].immagine,'https://img.test/it.jpg')
  assert.equal((await pg.query('select count(*) n from set_carte_immagini')).rows[0].n,3)
  await assert.rejects(pg.exec("select bindex_publish_photo('PAL',1,'normale','INT','https://img.test/x.jpg',null,'source',false)"),/Lingua/)
  const before=(await pg.query('select aggiornato_il from set_carte where numero=2')).rows[0].aggiornato_il
  await pg.exec('update set_carte set eliminata=true where numero=2')
  assert.ok((await pg.query('select aggiornato_il from set_carte where numero=2')).rows[0].aggiornato_il>before)
  await assert.rejects(pg.exec('update set_carte set numero=99 where numero=2'),/immutabile/)
  await pg.exec(`alter table set_carte disable trigger bindex_stable_card;update set_carte set aggiornato_il='2020-01-01T00:00:00.123456Z';alter table set_carte enable trigger bindex_stable_card;`)
  await pg.exec(await readFile(new URL('../db/bindex-feed.sql',import.meta.url),'utf8'))
  await pg.exec('set role anon')
  const first=(await pg.query("select bindex_export_page('cards','1970-01-01','[]','2021-01-01',2) p")).rows[0].p
  assert.deepEqual(first.items.map(r=>r.numero),[1,2]);assert.equal(first.items[1].eliminata,true);assert.equal(first.complete,false)
  assert.match(first.next_cursor.time,/123456/)
  const next=(await pg.query("select bindex_export_page('cards',$1,$2,$3,2) p",[first.next_cursor.time,JSON.stringify(first.next_cursor.key),first.until])).rows[0].p
  assert.deepEqual(next.items.map(r=>r.numero),[3]);assert.equal(next.complete,true)
  assert.equal((await pg.query('select bindex_contract_report() r')).rows[0].r.blocking,0)
  await assert.rejects(pg.exec("select bindex_publish_photo('PAL',1,'normale','EN','https://img.test/bad.jpg',null,'source',false)"),/permission denied/)
 }finally{await pg.close()}
})

import {publishBindex} from '../scripts/publish-bindex.mjs'
test('publisher validates first and sends language photos through the protected RPC',async()=>{
 const writes=[],rpcs=[]
 const entry={entry_key:'tcgdex:1:holo',card_id:1,verification:'source',tags:[],language:'INT',set_code:'SV02@INT',collector_number:'50',updated_at:'2020-01-01T00:00:00.123456Z',image_url:'https://img.test/photo.jpg',source_url:'https://source.test',source_payload:{source_language:'en',set:{id:'sv02'},variant:{type:'normal'},has_normal_variant:true}}
 const db={from(table){let mutation=false;const q={select(){return q},eq(){return q},in(){return q},order(){return q},range(){return q},limit(){return q},upsert(row){mutation=true;writes.push({table,row});return q},delete(){mutation=true;return q},then(resolve){let data=[];if(!mutation){if(table==='catalog_export_state')data=[{ready:true}];if(table==='set_espansioni')data=[{sigla:'PAL',lingua:'INT',tcgdex_id:'sv02'}];if(table==='cards')data=[{id:1,nome:'Pikachu',sigla:'SV02@INT',source_language:'en'}]}return Promise.resolve({data}).then(resolve)}};return q},async rpc(name,args){rpcs.push({name,args});return {data:name==='catalog_export_queue'?[entry]:null}}}
 const result=await publishBindex({db,log:()=>{}})
 assert.equal(result.published,1)
 const card=writes.find(w=>w.table==='set_carte').row
 assert.equal(card.sigla,'PAL');assert.equal(card.numero,50);assert.equal('immagine' in card,false);assert.equal('immagine_verificata' in card,false)
 const photo=rpcs.find(r=>r.name==='bindex_publish_photo').args
 assert.equal(photo.image_language,'EN');assert.equal(photo.image_verified,false)
 assert.equal(writes.some(w=>w.table==='set_carte_immagini'),false)
})
