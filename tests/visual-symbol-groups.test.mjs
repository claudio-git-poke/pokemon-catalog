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
 const base={kind:'set_symbol',source_code:'base3',name:'Fossil',scope:'physical',image_url:'https://example.com/symbol.png',source_url:'https://example.com/source',image_sha256:'a'.repeat(64),mime_type:'image/png',availability:'available',match_mode:'tcgdex-set',tag_code:null,original_path:'symbol.png',source_pack:'test',provenance:{}}
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
