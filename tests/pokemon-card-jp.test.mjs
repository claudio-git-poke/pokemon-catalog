import {test} from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {postgresClient} from './helpers/postgres-client.mjs'
import {detailNumber,isPromoFolder,sameSpecies,officialRecord,persistOfficialPromos} from '../scripts/pokemon-card-jp.mjs'
test('promo number, folder and species are read from the official site',()=>{
 assert.deepEqual(detailNumber('<p><img src="/assets/images/card/regulation_logo_1/SMP.gif" alt="SMP">&nbsp;007&nbsp;/&nbsp;SM-P</p>'),{number:'7',set:'SM-P'})
 assert.deepEqual(detailNumber('<span>095 / XY-P</span>'),{number:'95',set:'XY-P'})
 assert.equal(detailNumber('<span>012/100</span>'),null)
 assert.equal(isPromoFolder('/assets/images/card_images/large/SMP/033217_P_KUWAGANON.jpg'),true)
 assert.equal(isPromoFolder('/assets/images/card_images/large/SM1p/033250_P_KUWAGANONGX.jpg'),false)
 assert.equal(isPromoFolder('/assets/images/card_images/large/SV7/045974_P_KUWAGANON.jpg'),false)
 assert.equal(sameSpecies('クワガノン','Vikavolt'),true)
 assert.equal(sameSpecies('アローラニャース','Alolan Meowth'),true)
 assert.equal(sameSpecies('ピカチュウ','Pikachu (event)'),true)
 assert.equal(sameSpecies('エルレイドEX','Warm Pikachu'),false)
 assert.equal(sameSpecies('基本水エネルギー','Energia Acqua'),null)
})
test('official promos fill missing photos only on the card with the same number and Pokémon',async()=>{
 const pg=new PGlite();try{
  await pg.exec(`create table cards(id bigint generated always as identity primary key,source_uid text unique,source_language text,source_local_id text,source_card_id text,nome text,sigla text,lingua text,numero integer,variante text,codice text,file_name text,image_status text,image_url text,image_source text,image_last_error text,notes text);
   create table catalog_search_entries(entry_key text primary key,card_id bigint references cards(id),name text,set_code text,language text,collector_number text,denominator text,tags text[],facts jsonb,source_url text,source_payload jsonb,verification text,image_url text,label text,search_text text,updated_at timestamptz default now());
   insert into cards(nome,sigla,lingua,numero,variante,image_status) values
    ('Vikavolt','SM-P@JP','JP',7,'normale','placeholder'),
    ('Gallade EX','XY-P@JP','JP',95,'normale','placeholder'),('Warm Pikachu','XY-P@JP','JP',95,'da-identificare','found'),
    ('Pikachu','SM-P@JP','JP',8,'normale','found'),
    ('Energia Acqua','SM-P@JP','JP',79,'normale','placeholder');`)
  const card=(id,thumb,name)=>({cardID:id,cardThumbFile:thumb,cardNameAltText:name})
  const records=[
   officialRecord(card('33217','/assets/images/card_images/large/SMP/033217_P_KUWAGANON.jpg','クワガノン'),'<p>007 / SM-P</p>'),
   officialRecord(card('30001','/assets/images/card_images/large/XYP/030001_P_ERUREIDOEX.jpg','エルレイドEX'),'<p>095 / XY-P</p>'),
   officialRecord(card('33300','/assets/images/card_images/large/SMP/033300_P_PIKACHU.jpg','ピカチュウ'),'<p>008 / SM-P</p>'),
   officialRecord(card('33400','/assets/images/card_images/large/SMP/033400_E_MIZU.jpg','基本水エネルギー'),'<p>079 / SM-P</p>')]
  const db=postgresClient(pg)
  assert.deepEqual(await persistOfficialPromos(db,records),{added:0,changed:3,photos:2,unmatched:1})
  const cards=(await pg.query('select nome,image_status,image_url from cards order by id')).rows
  assert.equal(cards.length,5,'no card is created')
  assert.equal(cards[0].image_url,'https://www.pokemon-card.com/assets/images/card_images/large/SMP/033217_P_KUWAGANON.jpg')
  assert.equal(cards[1].image_status,'found','Gallade EX gets the official Gallade photo, not the twin')
  assert.equal(cards[2].image_url,null);assert.equal(cards[3].image_url,null,'an existing photo is kept')
  assert.equal(cards[4].image_status,'placeholder','energy without a Pokémon name is left alone')
  assert.deepEqual(await persistOfficialPromos(db,records),{added:0,changed:0,photos:0,unmatched:1})
 }finally{await pg.close()}
})
test('species names match whole words only',()=>{
 assert.equal(sameSpecies('ミュウ','Mewtwo'),false)
 assert.equal(sameSpecies('ミュウツーEX','Mewtwo EX'),true)
 assert.equal(sameSpecies('ニャース','Meowth'),true)
})
