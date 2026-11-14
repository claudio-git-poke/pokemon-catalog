import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
test('coverage separates unknown sources, pending, retry and insufficient data; checks only coherent printings and respects RLS',async()=>{
 const pg=new PGlite()
 try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table cards(id bigint primary key,sigla text,lingua text,source_uid text,source_card_id text,traits_checked_at timestamptz,traits_last_error text,image_status text,image_url text);
 create table catalog_search_entries(entry_key text,card_id bigint,name text,set_code text,tags text[],facts jsonb,source_payload jsonb,verification text,collector_number text);
 create table set_carte_immagini(sigla text,numero int,variante text,immagine text,verificata boolean);
 create table set_carte(tag text[],immagine text,immagine_verificata boolean,eliminata boolean);
 create function catalog_number(text) returns text language sql immutable as 'select ltrim($1,''0'')';
 insert into cards values
 (1,'A','INT','tcgdex:1','1',null,null,'missing',null),
 (2,'A','INT','tcgdex:2','2',now(),null,'found','photo'),
 (3,'A','INT','atlas:3','3',null,null,'placeholder','placeholder'),
 (4,'A','INT','tcgdex:4','4',null,'timeout','missing',null),
 (5,'A','INT','tcgdex:5','5',now(),null,'found','photo'),
 (6,'SECRET','INT',null,null,null,null,'missing',null),
 (7,'A','INT',null,null,null,null,'missing',null);
 insert into catalog_search_entries values
 ('tcgdex:a',5,'Card','A',array['finish:normal'],'{}','{}','source','5'),
 ('tcgdex:b',5,'Card','A',array['finish:holo'],'{}','{}','source','5'),
 ('tcgdex:c',2,'Card','A','{}','{}','{}','source','2');
 alter table cards enable row level security;
 create policy read_cards on cards for select to anon using(id<>6);
 grant select on cards,catalog_search_entries,set_carte,set_carte_immagini to anon;`)
 await pg.exec(await readFile(new URL('../db/catalog-quality.sql',import.meta.url),'utf8'))
 await pg.exec('set role anon')
 const report=async()=>(await pg.query('select catalog_quality_report() r')).rows[0].r
 const r=await report()
 assert.equal(r.totals.total,6);assert.equal(r.totals.pending,2);assert.equal(r.totals.retry,1)
 assert.equal(r.totals.unsupported,1);assert.equal(r.totals.insufficient,1);assert.equal(r.totals.tagged,1)
 assert.equal(r.warnings.total,0,'separate normal and holo printings are valid')
 assert.ok(!r.groups.some(g=>g.sigla==='SECRET'))
 await pg.exec(`reset role;update catalog_search_entries set tags=array['finish:normal','visual:shiny'] where entry_key='tcgdex:a';set role anon;`)
 assert.equal((await report()).warnings.by_reason.finish_conflict,1)
 }finally{await pg.close()}
})
