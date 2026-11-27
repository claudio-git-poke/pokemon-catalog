import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {postgresClient} from './helpers/postgres-client.mjs'
import {speciesOf,sameCard,cardNumber,planTwinTraits} from '../scripts/twin-traits.mjs'
import {runTwinTraits} from '../scripts/run-twin-traits.mjs'
const sheets={
 'SV08@INT':{code:'sv08',language:'INT',name:'Surging Sparks',abbreviation:'SSP',source:'tcgdex'},
 'SV08@IT':{code:'sv08',language:'IT',name:'Scintille Folgoranti',abbreviation:'SSP',source:'tcgdex'},
 'SMP@JP':{code:'SMP',language:'JP',name:'Sun and Moon Promotional Cards',source:'atlas'}}
test('species are recognised in every language and twins must be the same Pokémon',()=>{
 assert.deepEqual([...speciesOf('Glurak-GX')],[6]);assert.deepEqual([...speciesOf('リザードンex')],[6]);assert.deepEqual([...speciesOf('Dracaufeu')],[6])
 assert.deepEqual([...speciesOf('Mewtwo')],[150]);assert.deepEqual([...speciesOf('Mr. Mime')],[122]);assert.deepEqual([...speciesOf('Ho-Oh')],[250])
 assert.equal(sameCard('Glurak','Charizard'),true);assert.equal(sameCard('Mew','Mewtwo'),false)
 assert.equal(sameCard('Pozione','Potion'),true,'trainers: number only');assert.equal(sameCard('Pozione','Potion',{promo:true}),false,'not in promo sets')
 assert.equal(sameCard('Tsareena','クワガノン',{promo:true}),false)
 assert.equal(cardNumber({source_local_id:'012'}),'12');assert.equal(cardNumber({source_local_id:'SWSH001'}),'SWSH1');assert.equal(cardNumber({numero:7}),'7')
})
test('a card without traits borrows the language-independent ones from its twins, English first',()=>{
 const cards=[
  {id:1,sigla:'SV08@INT',lingua:'INT',source_local_id:'012',nome:'Charizard',image_status:'found',image_url:'en.png'},
  {id:2,sigla:'SV08@IT',lingua:'IT',source_local_id:'012',nome:'Charizard',image_status:'found',image_url:'it.png'},
  {id:3,sigla:'SSP@IT',lingua:'IT',numero:12,nome:'Charizard ex',image_status:'placeholder'},
  {id:4,sigla:'SSP@DE',lingua:'DE',numero:12,nome:'Glurak',image_status:'found',image_url:'de.png'},
  {id:5,sigla:'SSP@FR',lingua:'FR',numero:12,nome:'Pikachu',image_status:'found',image_url:'fr.png'},
  {id:6,sigla:'SV08@INT',lingua:'INT',source_local_id:'013',nome:'Ho-Oh',image_status:'found'},
  {id:7,sigla:'SSP@IT',lingua:'IT',numero:13,nome:'Ho-Oh',image_status:'found'}]
 const tags=new Map([[1,['rarity:double-rare','type:fire','hp:330','stage:stage-2','illustrator:5ban-graphics','finish:holo','stamp:set-logo']],[2,['rarity:doppia-rara','type:fire']],[6,['rarity:rare','type:fire']]])
 const plan=planTwinTraits({cards,tags,sheets})
 const byId=Object.fromEntries(plan.entries.map(e=>[e.card.id,e]))
 assert.deepEqual(byId[3].tags,['hp:330','illustrator:5ban-graphics','rarity:double-rare','stage:stage-2','type:fire'],'English twin first; finish and stamps are not copied')
 assert.deepEqual(byId[4].tags,byId[3].tags,'German name of the same Pokémon')
 assert.equal(byId[5],undefined,'a different Pokémon on the same number gets nothing')
 assert.deepEqual(byId[7].tags,['rarity:rare','type:fire'])
 assert.deepEqual(plan.photos.map(p=>[p.card.id,p.donor.id]),[[3,2]],'photo only from the same language')
 assert.equal(plan.stats.rejected_names,1)
})
test('twins in Asian promo sets need the same Pokémon on both sides',()=>{
 const cards=[{id:1,sigla:'SMP@JP',lingua:'JP',source_local_id:'007',nome:'クワガノン',image_status:'found',image_url:'v.jpg'},{id:2,sigla:'SM-P@JP',lingua:'JP',numero:7,nome:'Tsareena',image_status:'placeholder'},{id:3,sigla:'SM-P@JP',lingua:'JP',numero:7,nome:'Vikavolt',image_status:'placeholder'}]
 const plan=planTwinTraits({cards,tags:new Map([[1,['card-type:pokemon','type:lightning']]]),sheets})
 assert.deepEqual(plan.entries.map(e=>e.card.id),[3]);assert.deepEqual(plan.photos.map(p=>p.card.id),[3])
})
test('the worker step writes twin entries and photos once, and removes them when no longer needed',async()=>{
 const pg=new PGlite();try{
  await pg.exec(`create table cards(id bigint primary key,sigla text,lingua text,numero int,source_local_id text,nome text,image_status text,image_url text,image_source text,image_last_error text);
   create table catalog_search_entries(entry_key text primary key,card_id bigint references cards(id) on delete cascade,name text,set_code text,language text,collector_number text,tags text[] default '{}',facts jsonb default '{}',source_url text,source_payload jsonb default '{}',verification text,image_url text,label text,search_text text,updated_at timestamptz);
   insert into cards values(1,'SV08@INT','INT',12,'012','Charizard','found','en.png',null,null),(2,'SV08@IT','IT',12,'012','Charizard','found','it.png',null,null),(3,'SSP@IT','IT',12,null,'Charizard ex','placeholder',null,null,null);
   insert into catalog_search_entries(entry_key,card_id,tags) values('card:1',1,'{rarity:double-rare,type:fire}'),('card:3',3,'{}');`)
  const db=postgresClient(pg),logs=[]
  const first=await runTwinTraits({db,sheets,log:m=>logs.push(m)})
  assert.equal(first.to_write,2,'both Italian cards without traits');assert.equal(first.photos,1)
  const row=(await pg.query(`select card_id,tags,verification,source_payload from catalog_search_entries where entry_key='twin:3'`)).rows[0]
  assert.deepEqual(row.tags,['rarity:double-rare','type:fire']);assert.equal(row.verification,'catalog');assert.deepEqual(row.source_payload.from_card_ids,[1])
  assert.equal((await pg.query('select image_url from cards where id=3')).rows[0].image_url,'it.png')
  assert.equal((await runTwinTraits({db,sheets,log:()=>{}})).to_write,0,'nothing to write twice')
  await pg.exec(`update catalog_search_entries set tags='{rarity:special}' where entry_key='card:3'`)
  const third=await runTwinTraits({db,sheets,log:()=>{}});assert.equal(third.stale,1)
  assert.deepEqual((await pg.query(`select entry_key from catalog_search_entries where entry_key like 'twin:%'`)).rows.map(r=>r.entry_key),['twin:2'])
 }finally{await pg.close()}
})
