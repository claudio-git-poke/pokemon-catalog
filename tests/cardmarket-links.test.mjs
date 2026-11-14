import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {linkCardmarket} from '../scripts/link-cardmarket.mjs'
const url=id=>`https://www.cardmarket.com/it/Pokemon/Products?idProduct=${id}`
test('Cardmarket links backfill exact products, preserve variants and survive stale workers',async()=>{
 const pg=new PGlite()
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create table cards(id bigint primary key,link_cardmarket text);
   create table catalog_search_entries(entry_key text primary key,card_id bigint references cards(id),verification text not null default 'source',source_payload jsonb not null default '{}',updated_at timestamptz default now());`)
  await pg.exec(await readFile(new URL('../db/bindex-export.sql',import.meta.url),'utf8'))
  await pg.exec(`insert into set_espansioni(sigla,nome,lingua) values('PAL','Paldea','INT');
   insert into set_carte(sigla,numero,variante,cardmarket_id) values('PAL',1,'normale',100),('PAL',1,'reverse',200);
   insert into cards(id) values(1),(2),(3),(4),(5),(6);
   insert into catalog_search_entries(entry_key,card_id,source_payload) values
   ('same:1',1,'{"variant":{"thirdParty":{"cardmarket":100}}}'),
   ('same:2',1,'{"variant":{"thirdParty":{"cardmarket":100}}}'),
   ('different:1',2,'{"variant":{"thirdParty":{"cardmarket":100}}}'),
   ('different:2',2,'{"variant":{"thirdParty":{"cardmarket":200}}}'),
   ('unknown:1',3,'{"variant":{"thirdParty":{"cardmarket":100}}}'),('unknown:2',3,'{}'),
   ('conflict',4,'{"variant":{"thirdParty":{"cardmarket":999}}}'),
   ('invalid',5,'{"variant":{"thirdParty":{"cardmarket":"bad"}}}');
   insert into catalog_export_links(entry_key,sigla,numero,variante,method) values('conflict','PAL',1,'normale','test');`)
  await pg.exec(await readFile(new URL('../db/catalog-cardmarket.sql',import.meta.url),'utf8'))
  const first=(await pg.query('select catalog_link_cardmarket(100) stats')).rows[0].stats
  assert.equal(first.published,2);assert.equal(first.printings,6);assert.equal(first.cards,1)
  const rows=(await pg.query('select * from catalog_search_entries order by entry_key')).rows
  assert.equal(rows.find(r=>r.entry_key==='conflict').cardmarket_status,'conflict')
  assert.equal(rows.find(r=>r.entry_key==='conflict').cardmarket_url,null)
  assert.equal(rows.find(r=>r.entry_key==='different:2').cardmarket_url,url(200))
  assert.equal((await pg.query('select link_cardmarket from cards where id=1')).rows[0].link_cardmarket,url(100))
  for(const id of [2,3,4,5])assert.equal((await pg.query('select link_cardmarket from cards where id=$1',[id])).rows[0].link_cardmarket,null)
  assert.deepEqual((await pg.query('select catalog_link_cardmarket(100) stats')).rows[0].stats,{published:0,printings:0,cards:0})
  await pg.exec(`update set_carte set cardmarket_url=null,cardmarket_id=null where numero=1 and variante='reverse';`)
  assert.equal((await pg.query("select cardmarket_url from set_carte where variante='reverse'")).rows[0].cardmarket_url,url(200))
  await assert.rejects(pg.exec("insert into set_carte(sigla,numero,variante,cardmarket_url) values('PAL',2,'normale','javascript:alert(1)')"),/check constraint/)
  await pg.exec(`insert into catalog_search_entries(entry_key,card_id,source_payload) values('future',6,'{"variant":{"thirdParty":{"cardmarket":300}}}');`)
  assert.equal((await pg.query("select cardmarket_url from catalog_search_entries where entry_key='future'")).rows[0].cardmarket_url,url(300))
  await pg.exec(`insert into set_carte(sigla,numero,variante,cardmarket_id) values('PAL',3,'normale',400);
   insert into catalog_export_links(entry_key,sigla,numero,variante,method) values('invalid','PAL',3,'normale','test');`)
  assert.equal((await pg.query("select cardmarket_url from catalog_search_entries where entry_key='invalid'")).rows[0].cardmarket_url,url(400))
  const stamp=(await pg.query("select updated_at from catalog_search_entries where entry_key='invalid'")).rows[0].updated_at
  await pg.exec("update catalog_export_links set method='another-method' where entry_key='invalid'")
  assert.equal((await pg.query("select updated_at from catalog_search_entries where entry_key='invalid'")).rows[0].updated_at.toISOString(),stamp.toISOString())
  await pg.exec('grant select on catalog_search_entries to anon;set role anon')
  assert.equal((await pg.query("select cardmarket_url from catalog_search_entries where entry_key='future'")).rows[0].cardmarket_url,url(300))
  await assert.rejects(pg.exec('select catalog_link_cardmarket(100)'),/permission denied/)
 }finally{await pg.close()}
})
test('Cardmarket worker logs progress and a linking failure does not stop imports',async()=>{
 const logs=[]
 assert.deepEqual(await linkCardmarket({db:{rpc:async()=>({data:{published:2,printings:3,cards:1}})},log:x=>logs.push(x)}),{published:2,printings:3,cards:1,errors:0})
 assert.match(logs[0],/2 link.*3 stampe.*1 schede/)
 assert.equal((await linkCardmarket({db:{rpc:async()=>({error:{message:'timeout'}})},log:x=>logs.push(x)})).errors,1)
 assert.match(logs[1],/rimandato: timeout/)
})
