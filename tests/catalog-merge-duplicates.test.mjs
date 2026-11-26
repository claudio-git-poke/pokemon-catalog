import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
// psql meta-commands are dropped; the transaction is committed explicitly.
const body=(await readFile(new URL('../db/catalog-merge-duplicates.sql',import.meta.url),'utf8')).split('\n').filter(l=>!l.startsWith('\\')&&!/^(commit|rollback);$/.test(l)).join('\n')
test('duplicates from evidence sources are merged into the main card without losing sources',async()=>{
 const pg=new PGlite();try{
  await pg.exec(`create table cards(id bigint primary key,source_uid text unique,nome text,sigla text,lingua text,numero integer,variante text,image_url text,image_status text,image_source text,image_last_error text,manual_overrides jsonb default '{}');
   create table catalog_search_entries(entry_key text primary key,card_id bigint references cards(id) on delete cascade);
   create table catalog_printing_inventory(record_key text primary key,card_id bigint references cards(id) on delete set null);
   create table catalog_packaging_links(candidate_key text,card_id bigint not null references cards(id),primary key(candidate_key,card_id));
   insert into cards values
    (1,'atlas:a','Ho-Oh','30C@EN','EN',12,'normale',null,'placeholder',null,null,'{}'),
    (2,'limitless:en:30C:12','ho-oh ','30C@EN','EN',12,'da-identificare','https://l/12.png','found','limitless',null,'{}'),
    (3,'atlas:b','Mew','30C@EN','EN',14,'normale','https://a/14.png','found','atlas',null,'{}'),
    (4,'limitless:en:30C:14','Mew','30C@EN','EN',14,'da-identificare','https://l/14.png','found','limitless',null,'{"nome":"x"}'),
    (5,'atlas:c','Lugia','30C@EN','EN',13,'normale',null,'missing',null,null,'{}'),
    (6,'atlas:d','Lugia','30C@EN','EN',13,'reverse',null,'missing',null,null,'{}'),
    (7,'limitless:en:30C:13','Lugia','30C@EN','EN',13,'da-identificare','https://l/13.png','found','limitless',null,'{}'),
    (8,'pkmncards:x','Pikachu','MEP@EN','EN',1,'da-identificare',null,'missing',null,null,'{}'),
    (9,'limitless:en:MEP:1','Pikachu','MEP@EN','EN',1,'da-identificare','https://l/p.png','found','limitless',null,'{}');
   insert into catalog_search_entries values('card:2',2),('limitless:en:30C:12',2),('card:1',1),('card:9',9),('limitless:en:MEP:1',9);
   insert into catalog_printing_inventory values('r2',2),('r9',9);
   insert into catalog_packaging_links values('k1',8),('k1',9),('k2',9);`)
  await pg.exec(body)
  const ids=(await pg.query('select id from cards order by id')).rows.map(r=>Number(r.id))
  assert.deepEqual(ids,[1,3,4,5,6,7,8],'copies 2 and 9 merged; manual edit (4) and repeated provider group (5,6,7) untouched')
  const one=(await pg.query('select image_url,image_status,variante from cards where id=1')).rows[0]
  assert.deepEqual(one,{image_url:'https://l/12.png',image_status:'found',variante:'normale'})
  const pika=(await pg.query('select image_url from cards where id=8')).rows[0];assert.equal(pika.image_url,'https://l/p.png')
  const entries=Object.fromEntries((await pg.query('select entry_key,card_id from catalog_search_entries')).rows.map(r=>[r.entry_key,Number(r.card_id)]))
  assert.deepEqual(entries,{'card:1':1,'limitless:en:30C:12':1,'limitless:en:MEP:1':8})
  assert.deepEqual((await pg.query('select record_key,card_id from catalog_printing_inventory order by 1')).rows.map(r=>[r.record_key,Number(r.card_id)]),[['r2',1],['r9',8]])
  assert.deepEqual((await pg.query('select candidate_key,card_id from catalog_packaging_links order by 1')).rows.map(r=>[r.candidate_key,Number(r.card_id)]),[['k1',8],['k2',8]])
 }finally{await pg.close()}
})
