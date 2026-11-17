import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
async function fixture(){
 const pg=new PGlite()
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table cards(id bigint primary key,source_uid text unique,source_language text,image_url text);
 create table catalog_search_entries(entry_key text primary key,card_id bigint references cards(id),name text,set_code text,collector_number text,language text,tags text[],source_url text,source_payload jsonb,verification text,release_code text,release_year integer);
 create table catalog_printing_inventory(record_key text primary key,canonical_sigla text,canonical_numero integer,canonical_variante text,canonical_mapping_status text,deleted boolean);
 grant select on cards,catalog_search_entries,catalog_printing_inventory to anon;`)
 await pg.exec(await readFile(new URL('../db/visual-symbols.sql',import.meta.url),'utf8'))
 await pg.exec(await readFile(new URL('../db/visual-symbol-groups.sql',import.meta.url),'utf8'))
 await pg.exec(await readFile(new URL('../db/visual-symbol-links-repair.sql',import.meta.url),'utf8'))
 const base={kind:'set_symbol',source_code:'base3',name:'Fossil',scope:'physical',image_url:'https://example.com/symbol.png',source_url:'https://example.com/source',image_sha256:'a'.repeat(64),mime_type:'image/png',availability:'available',match_mode:'tcgdex-set',tag_code:null,tag_codes:[],match_code:null,original_path:'symbol.png',source_pack:'test',provenance:{}}
 const assets=[{...base,asset_key:'1'.repeat(32),source_language:'en'},{...base,asset_key:'2'.repeat(32),source_language:'it'},{...base,asset_key:'3'.repeat(32),source_language:'fr',source_code:'another-set'},
 {...base,asset_key:'4'.repeat(32),source_language:'en',image_sha256:'b'.repeat(64)},
 {...base,asset_key:'5'.repeat(32),source_language:'en',scope:'digital',match_mode:null},
 {...base,asset_key:'6'.repeat(32),source_language:'en',kind:'set_logo',scope:'reference',match_mode:null}]
 for(const row of assets)await pg.query('insert into catalog_visual_assets select * from jsonb_populate_record(null::catalog_visual_assets,$1)',[JSON.stringify(row)])
 await pg.exec(`insert into cards values(1,'tcgdex:en:base3-1','en',null),(2,'tcgdex:it:base3-1','it',null),(3,'tcgdex:fr:another-set-1','fr',null);
 insert into catalog_search_entries(entry_key,card_id,name,set_code,collector_number,language,tags,source_url,source_payload,verification) values
 ('a',1,'A','BASE3','1','INT','{}','https://example.com/en','{"source_language":"en"}','source'),
 ('b',2,'B','BASE3','1','IT','{}','https://example.com/it','{"source_language":"it"}','source'),
 ('c',3,'C','OTHER','1','FR','{}','https://example.com/fr','{"source_language":"fr"}','source');`)
 return pg
}
const groups=async(pg,lang=null,all=false)=>(await pg.query('select catalog_visual_group_page($1,$2,$3,$4,$5) r',['',48,null,lang,all])).rows[0].r
const cards=async(pg,key,after='',size=24,lang=null)=>(await pg.query('select catalog_visual_group_cards($1,$2,$3,$4,$5) r',[key,after,size,false,lang])).rows[0].r

test('identical images group across languages and expansions, without merging other artwork, scopes or kinds',async()=>{
 const pg=await fixture();try{
  const g=await groups(pg);assert.equal(g.results.length,2)
  const fossil=g.results.find(r=>r.reference_count===3)
  assert.deepEqual(fossil.languages,['en','fr','it']);assert.deepEqual(fossil.source_codes,['another-set','base3'])
  assert.equal((await groups(pg,'it')).results[0].group_key,fossil.group_key)
  assert.equal((await groups(pg,null,true)).results.length,4)
  const r=await cards(pg,fossil.group_key);assert.deepEqual(r.results.map(r=>r.actual_language),['en','it','fr'])
  assert.equal(new Set(r.results.map(r=>r.entry_key)).size,3)
  assert.deepEqual((await cards(pg,fossil.group_key,'',24,'it')).results.map(r=>r.actual_language),['it'])
  // Existing single-reference API remains language-specific.
  assert.equal((await pg.query('select catalog_visual_cards($1) r',['1'.repeat(32)])).rows[0].r.results.length,1)
 }finally{await pg.close()}
})
test('release language comes from the printing row and neutral rarity/type tags match multiple languages',async()=>{
 const pg=await fixture();try{
  await pg.exec(`insert into cards values(4,'atlas:ko:SV4-001','ko',null);
   insert into catalog_search_entries(entry_key,card_id,name,set_code,language,tags,source_payload,verification,release_code,release_year) values
   ('release:2022',2,'English printing, Italian parent','BOO','INT',array['stamp:trick-or-trade'],'{}','source','trick-or-trade-2022',2022),
   ('release:2023',1,'English printing','BOO','INT',array['stamp:trick-or-trade'],'{}','source','trick-or-trade-2023',2023),
   ('release:2024',3,'English printing, French parent','BOO','INT',array['stamp:trick-or-trade'],'{}','source','trick-or-trade-2024',2024),
   ('rarity:en',1,'English SAR','BASE3','INT',array['rarity:special-illustration-rare','type:fire'],'{}','source',null,null),
   ('rarity:ko',4,'Korean SAR','SV4','KOR',array['rarity:sar','type:fire'],'{}','source',null,null);
   insert into catalog_visual_assets(asset_key,kind,source_code,source_language,name,scope,image_url,image_sha256,availability,match_mode,tag_code,tag_codes,original_path,source_pack) values
   (repeat('7',32),'promo_stamp','trick-or-trade','en','Trick or Trade','physical','https://example.com/stamp.png',repeat('c',64),'available','tag','stamp:trick-or-trade',array['stamp:trick-or-trade'],'stamp.png','test'),
   (repeat('8',32),'rarity','special-illustration-rare','und','SAR','physical','https://example.com/rarity.png',repeat('d',64),'available','tag','rarity:special-illustration-rare',array['rarity:special-illustration-rare','rarity:sar'],'rarity.png','test'),
   (repeat('9',32),'energy','fire','und','Fire','physical','https://example.com/fire.png',repeat('e',64),'available','tag','type:fire',array['type:fire'],'fire.png','test');`)
  const all=await groups(pg),stamp=all.results.find(r=>r.source_code==='trick-or-trade'),rarity=all.results.find(r=>r.source_code==='special-illustration-rare'),fire=all.results.find(r=>r.source_code==='fire')
  const release=await cards(pg,stamp.group_key);assert.deepEqual(release.results.map(r=>r.release_year),[2022,2023,2024]);assert.ok(release.results.every(r=>r.actual_language==='en'))
  assert.equal((await pg.query('select catalog_visual_cards(repeat(\'7\',32)) r')).rows[0].r.results.length,3)
  assert.deepEqual((await cards(pg,rarity.group_key)).results.map(r=>r.actual_language),['en','ko'])
  assert.deepEqual((await cards(pg,fire.group_key,'',24,'ko')).results.map(r=>r.actual_language),['ko'])
  assert.ok((await groups(pg,'ko')).results.some(r=>r.group_key===rarity.group_key),'neutral symbols remain selectable in a language filter')
 }finally{await pg.close()}
})
test('mapped neutral sets search indexed source prefixes across languages and omit generic catalog rows',async()=>{
 const pg=await fixture();try{
  await pg.exec(`update catalog_visual_assets set source_code='xy-trainer-kit-suicune',match_code='base3',source_language='und' where asset_key=repeat('1',32);
   insert into catalog_search_entries(entry_key,card_id,name,language,tags,source_payload,verification) values('card:1',1,'Generic','INT','{}','{}','catalog');`)
  const key=(await groups(pg)).results.find(r=>r.reference_count===3).group_key
  const matched=await cards(pg,key);assert.deepEqual(matched.results.map(r=>r.entry_key),['a','b','c'])
  const single=(await pg.query('select catalog_visual_cards(repeat(\'1\',32)) r')).rows[0].r
  assert.deepEqual(single.results.map(r=>r.entry_key),['a','b']);assert.equal(single.results.some(r=>r.entry_key==='card:1'),false)
  await pg.exec(`insert into catalog_visual_links(asset_key,entry_key,status,image_match_status,position,evidence_url) values
   (repeat('1',32),'a','verified','verified','bottom-left','https://example.com/manual'),
   (repeat('2',32),'a','rejected','candidate',null,'https://example.com/reject');`)
  assert.deepEqual((await cards(pg,key)).results.map(r=>r.entry_key),['b','c'],'a rejection on any member wins across the group')
  assert.equal((await pg.query('select catalog_visual_cards(repeat(\'1\',32)) r')).rows[0].r.results[0].position,'bottom-left')
  await pg.exec(await readFile(new URL('../db/visual-symbol-links-repair.sql',import.meta.url),'utf8'))
  assert.deepEqual((await cards(pg,key)).results.map(r=>r.entry_key),['b','c'],'reapplying the migration preserves manual decisions')
 }finally{await pg.close()}
})
test('manual languages and legacy manual tag_code corrections win over automatic aliases',async()=>{
 const pg=await fixture();try{
  await pg.exec(`alter table catalog_search_entries add column if not exists manual_overrides jsonb default '{}';alter table cards add column if not exists manual_overrides jsonb default '{}';alter table catalog_visual_assets add column manual_overrides jsonb default '{}';
   update catalog_visual_assets set kind='rarity',source_code='common',match_mode='tag',tag_code='rarity:uncommon',tag_codes=array['rarity:common'],manual_overrides='{\"tag_code\":\"rarity:uncommon\"}' where asset_key=repeat('1',32);
   update catalog_search_entries set tags=array['rarity:common'],language='IT',manual_overrides='{\"language\":\"IT\"}' where entry_key='a';`)
  assert.equal((await pg.query('select catalog_visual_cards(repeat(\'1\',32)) r')).rows[0].r.results.length,0)
  await pg.exec(`update catalog_visual_assets set tag_code='rarity:common',manual_overrides='{}',source_language='und' where asset_key=repeat('1',32);`)
  const r=(await pg.query('select catalog_visual_cards(repeat(\'1\',32)) r')).rows[0].r
  assert.equal(r.results[0].actual_language,'it')
 }finally{await pg.close()}
})
test('group pagination and reviewed rejections remain consistent, including anonymous read-only access',async()=>{
 const pg=await fixture();try{
  const key=(await groups(pg)).results.find(r=>r.reference_count===3).group_key
  const first=await cards(pg,key,'',1);assert.equal(first.has_more,true)
  const next=await cards(pg,key,first.next_key,1);assert.equal(next.results[0].entry_key,'b')
  await pg.query("insert into catalog_visual_links(asset_key,entry_key,status,evidence_url) values($1,'a','rejected','https://example.com/review')",['1'.repeat(32)])
  assert.deepEqual((await cards(pg,key)).results.map(r=>r.entry_key),['b','c'])
  await pg.exec('set role anon');assert.equal((await groups(pg)).results.length,2);assert.equal((await cards(pg,key)).results.length,2)
  await assert.rejects(pg.exec('delete from catalog_visual_assets'),/permission denied/)
 }finally{await pg.close()}
})

test('generic fallback is scoped to matching printings, stable across pages and never bypasses a rejection',async()=>{
 const pg=await fixture();try{
  await pg.exec(`insert into cards values(4,'tcgdex:en:base3-4','en',null);
   insert into catalog_search_entries(entry_key,card_id,name,language,tags,source_payload,verification) values
   ('card:4',4,'Generic only','INT','{}','{}','catalog'),
   ('a:it',4,'Italian printing','IT','{}','{"printing_language":"it"}','source');`)
  const key=(await groups(pg)).results.find(r=>r.reference_count===3).group_key
  const single=async(after='')=>(await pg.query("select catalog_visual_cards(repeat('1',32),$1,100) r",[after])).rows[0].r.results
  assert.ok((await single()).some(r=>r.entry_key==='card:4'),'a different printing language does not suppress the fallback')
  assert.ok((await cards(pg,key,'',100,'en')).results.some(r=>r.entry_key==='card:4'))
  await pg.exec("insert into catalog_search_entries(entry_key,card_id,name,language,tags,source_payload,verification) values('a:en',4,'English printing','INT','{}','{}','source');")
  assert.ok(!(await single()).some(r=>r.entry_key==='card:4'))
  assert.ok(!(await single('c')).some(r=>r.entry_key==='card:4'),'a printing on an earlier page still suppresses the generic row')
  await pg.exec("insert into catalog_visual_links(asset_key,entry_key,status,evidence_url) values(repeat('1',32),'a:en','rejected','https://example.com/review');")
  assert.ok(!(await single()).some(r=>r.card_id===4),'rejecting a known printing does not revive its generic fallback')
  assert.ok(!(await cards(pg,key,'',100,'en')).results.some(r=>r.card_id===4))
  await pg.exec(`insert into cards values(5,'atlas:ko:OTHER-5','ko',null);
   insert into catalog_search_entries(entry_key,card_id,name,language,tags,source_payload,verification) values('card:5',5,'Parent language fallback','INT',array['type:fire'],'{}','catalog');
   insert into catalog_visual_assets(asset_key,kind,source_code,source_language,name,scope,image_url,image_sha256,availability,match_mode,tag_code,original_path,source_pack)
    values(repeat('9',32),'energy','fire','und','Fire','physical','https://example.com/fire.png',repeat('f',64),'available','tag','type:fire','fire.png','test');`)
  const fallback=(await pg.query("select catalog_visual_matches(array[repeat('9',32)],'',100,false,'ko') r")).rows[0].r
  assert.equal(fallback.results[0].card_id,5,'the indexed prefilter keeps undocumented parent-language fallbacks')
 }finally{await pg.close()}
})
