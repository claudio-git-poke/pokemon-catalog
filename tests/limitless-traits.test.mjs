import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {postgresClient} from './helpers/postgres-client.mjs'
import {parseLimitlessCard,runLimitlessTraits} from '../scripts/limitless-traits.mjs'
const page=name=>readFileSync(new URL(`./fixtures/${name}.html`,import.meta.url),'utf8')
test('Limitless card pages give type, HP, card type, stage, illustrator, regulation and rarity',()=>{
 assert.deepEqual(parseLimitlessCard(page('limitless-en-SSP-12')),['hp:70','type:grass','card-type:pokemon','stage:basic','illustrator:julie-hang','regulation:h','rarity:common'])
 assert.deepEqual(parseLimitlessCard(page('limitless-jp-SV8a-1')),['hp:30','type:grass','card-type:pokemon','stage:basic','illustrator:yoriyuki-ikegami','regulation:h'],'Japanese pages have no rarity')
 assert.deepEqual(parseLimitlessCard(page('limitless-en-SSP-180')),['card-type:stadium','illustrator:imoniii','regulation:h','rarity:uncommon'])
 assert.deepEqual(parseLimitlessCard('<html></html>'),[])
})
test('only Limitless cards without traits and without twins are read, once',async()=>{
 const pg=new PGlite();try{
  await pg.exec(`create table cards(id bigint primary key,sigla text,lingua text,numero int,source_local_id text,nome text,image_status text,image_url text,source_uid text);
   create table catalog_search_entries(entry_key text primary key,card_id bigint,tags text[] default '{}',facts jsonb default '{}',source_url text);
   insert into cards values(1,'SSP@EN','EN',12,null,'Budew','found','x','limitless:en:SSP:12'),(2,'SSP@EN','EN',180,null,'Lively Stadium','found','y','limitless:en:SSP:180'),(3,'SSP@EN','EN',13,null,'Mew','found','z','limitless:en:SSP:13');
   insert into catalog_search_entries values('limitless:en:SSP:12',1,'{}','{}','https://limitlesstcg.com/cards/SSP/12'),('limitless:en:SSP:180',2,'{}','{"limitless_checked":"2026-11-27"}','https://limitlesstcg.com/cards/SSP/180'),('limitless:en:SSP:13',3,'{type:psychic}','{}','https://limitlesstcg.com/cards/SSP/13');`)
  const db=postgresClient(pg),asked=[]
  const fetchPage=async url=>{asked.push(url);return page('limitless-en-SSP-12')}
  const first=await runLimitlessTraits({db,sheets:{},fetchPage,delay:0,log:()=>{}})
  assert.deepEqual(asked,['https://limitlesstcg.com/cards/SSP/12'],'already read and already tagged cards are skipped')
  assert.equal(first.tagged,1)
  const row=(await pg.query(`select tags,facts from catalog_search_entries where entry_key='limitless:en:SSP:12'`)).rows[0]
  assert.ok(row.tags.includes('rarity:common'));assert.ok(row.facts.limitless_checked)
  await runLimitlessTraits({db,sheets:{},fetchPage,delay:0,log:()=>{}});assert.equal(asked.length,1,'read only once')
 }finally{await pg.close()}
})
