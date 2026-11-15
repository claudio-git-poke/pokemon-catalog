import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {postgresClient} from './helpers/postgres-client.mjs'
import {asiaList,asiaDetail,englishRecord,persistEvidence,sourceImage} from '../scripts/supplemental-sources.mjs'
const detail=await readFile(new URL('fixtures/official-th-detail.html',import.meta.url),'utf8')
const list=await readFile(new URL('fixtures/official-th-list.html',import.meta.url),'utf8')
test('live official Thai fixtures preserve language, product code and printed number',()=>{
 const page=asiaList(list,'th');assert.equal(page.total,9813);assert.equal(page.pages,491);assert.equal(page.ids.length,20)
 const r=asiaDetail(detail,'th','14720');assert.equal(r.name,'ทามะทามะ');assert.equal(r.set,'MA6');assert.equal(r.number,'001');assert.equal(r.denominator,'130');assert.equal(r.language,'TH')
 assert.throws(()=>asiaList(list,'id'));assert.throws(()=>asiaDetail(detail,'id','14720'))
 assert.throws(()=>asiaDetail(detail.replace('expansionCodes=MA6','unknown=MA6'),'th','14720'))
 assert.throws(()=>asiaList('<html>maintenance</html>','th'))
 assert.equal(sourceImage('https://asia.pokemon-card.com/id/card-img/id01.png','th'),null)
 assert.equal(sourceImage('http://pkmncards.com/wp-content/uploads/test.jpg','en'),null)
})
test('English archive requires its own provenance, never accepts translated or Asian images',()=>{
 const data={url:'https://pkmncards.com/card/test/',name:'Test',set_name:'G1',number:'1',img:'https://pkmncards.com/wp-content/uploads/test.jpg'}
 assert.equal(englishRecord(data,'Gym','G1','1.json').language,'EN')
 assert.equal(englishRecord({...data,lang:'jp'},'Gym','G1','1.json'),null)
 assert.equal(englishRecord({...data,img:'https://asia.pokemon-card.com/th/card-img/test.png'},'Gym','G1','1.json'),null)
 assert.equal(englishRecord({...data,url:'https://example.com/card/test/'},'Gym','G1','1.json'),null)
})
test('source IDs prevent duplicates; unchanged reruns avoid writes; repeated printed numbers stay separate',async()=>{
 const pg=new PGlite();try{
  await pg.exec(`create table cards(id bigint generated always as identity primary key,source_uid text unique,source_language text,source_local_id text,source_card_id text,nome text,sigla text,lingua text,numero integer,variante text,codice text,file_name text,image_status text,image_url text,image_source text,notes text);
   create table catalog_search_entries(entry_key text primary key,card_id bigint references cards(id),name text,set_code text,language text,collector_number text,denominator text,tags text[],facts jsonb,source_url text,source_payload jsonb,verification text,image_url text,label text,search_text text,updated_at timestamptz default now());`)
  const db=postgresClient(pg),a=asiaDetail(detail,'th','14720'),b={...a,uid:'asia-official:th:other',name:'Other stamp'}
  assert.deepEqual(await persistEvidence(db,[a,b]),{added:2,changed:2})
  const time=(await pg.query('select updated_at from catalog_search_entries order by entry_key')).rows
  assert.deepEqual(await persistEvidence(db,[a,b]),{added:0,changed:0})
  assert.deepEqual((await pg.query('select updated_at from catalog_search_entries order by entry_key')).rows,time)
  const rows=(await pg.query('select * from cards')).rows;assert.equal(rows.length,2);assert.ok(rows.every(r=>r.variante==='da-identificare'&&r.source_card_id===null))
  const entry=(await pg.query('select source_payload from catalog_search_entries limit 1')).rows[0];assert.equal(entry.source_payload.reference_image_only,true)
  await pg.exec("update catalog_search_entries set verification='reviewed'")
  assert.equal((await persistEvidence(db,[{...a,name:'changed upstream'}])).changed,0)
 }finally{await pg.close()}
})
test('live Indonesian fixture stays Indonesian even for a shared expansion and collector number',async()=>{
 const html=await readFile(new URL('fixtures/official-id-detail.html',import.meta.url),'utf8')
 const r=asiaDetail(html,'id','19647');assert.equal(r.name,'Exeggcute');assert.equal(r.language,'ID');assert.equal(r.set,'MA6');assert.equal(r.number,'001')
 assert.notEqual(r.uid,asiaDetail(detail,'th','14720').uid)
})
