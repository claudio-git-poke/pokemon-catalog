import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {execFileSync} from 'node:child_process'
const dir=new URL('../data/visual-archive/',import.meta.url)
const rows=(await Promise.all((await readdir(dir)).filter(f=>/^\d+\.json$/.test(f)).map(async f=>JSON.parse(await readFile(new URL(f,dir),'utf8'))))).flat()
test('uploaded archive references retain hash provenance and distinguish actual stamps, logos and Pocket',async()=>{
 assert.equal(rows.length,5630);assert.equal(new Set(rows.map(r=>r.asset_key)).size,rows.length)
 const stamps=rows.filter(r=>r.match_mode==='tag'&&r.kind==='promo_stamp');assert.deepEqual(stamps.map(r=>r.source_code).sort(),['1st-edition','trick-or-trade'])
 for(const a of stamps){const bytes=await readFile(new URL('../public/visual-symbols/'+a.image_url.split('/').at(-1),import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),a.image_sha256)}
 for(const a of rows){if(a.scope!=='physical'||a.availability!=='available'||a.source_url?.includes('/tcgp/'))assert.equal(a.match_mode,null);if(a.source_code==='base1')assert.equal(a.match_mode,null)}
 for(const a of rows.filter(r=>r.match_mode)){
  assert.equal(a.provenance.image_validation.status,200)
  assert.ok(!a.provenance.rule_exclusion)
  assert.ok(!a.image_url.includes('/univ/'))
  if(a.match_mode==='tag')assert.ok(a.tag_codes.includes(a.tag_code))
  if(a.kind==='set_symbol'&&a.mime_type==='image/png')assert.ok(a.provenance.image_validation.width<=600&&a.provenance.image_validation.height<=600)
 }
 assert.ok(rows.some(a=>a.kind==='rarity'&&a.source_code==='special-illustration-rare'&&a.tag_codes.includes('rarity:sar')))
 assert.ok(rows.some(a=>a.kind==='energy'&&a.source_code==='tcg-fire'&&a.tag_code==='type:fire'))
 for(const a of rows.filter(r=>['rarity','energy'].includes(r.kind)&&['ace-spec-rare','black-white-rare','move-special','move-physical','move-status','mega-evolution'].includes(r.source_code)))assert.equal(a.match_mode,null)
 assert.ok(rows.some(a=>a.source_code==='w-promo'&&a.availability==='missing'))
})
test('live relationships respect language, variants, manual rejection, pagination and read-only public access',async()=>{
 const pg=new PGlite();try{
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create table cards(id bigint primary key,source_uid text unique,source_language text,image_url text);
   create table catalog_search_entries(entry_key text primary key,card_id bigint references cards(id),name text,set_code text,collector_number text,language text,tags text[],source_url text,source_payload jsonb,verification text,release_code text,release_year integer);
   create table catalog_printing_inventory(record_key text primary key,canonical_sigla text,canonical_numero integer,canonical_variante text,canonical_mapping_status text,deleted boolean);
   grant select on cards,catalog_search_entries,catalog_printing_inventory to anon;`)
  await pg.exec(await readFile(new URL('../db/visual-symbols.sql',import.meta.url),'utf8'))
  await pg.exec(await readFile(new URL('../db/visual-symbol-links-repair.sql',import.meta.url),'utf8'))
  const a=rows.find(r=>r.source_code==='1st-edition'&&r.match_mode==='tag'),set=rows.find(r=>r.source_code==='base2'&&r.source_language==='en'&&r.match_mode==='tcgdex-set')
  for(const row of [a,set])await pg.query('insert into catalog_visual_assets select * from jsonb_populate_record(null::catalog_visual_assets,$1)',[JSON.stringify(row)])
  await pg.exec(`insert into cards values(1,'tcgdex:en:base2-1','en',null),(2,'tcgdex:it:base2-1','it',null),(3,'legacy',null,null);
   insert into catalog_search_entries(entry_key,card_id,name,set_code,collector_number,language,tags,source_url,source_payload,verification,release_code) values('a',1,'A','BASE2','1','INT',array['stamp:1st-edition'],'https://example.com/en','{"source_language":"en"}','source',null),('b',2,'B','BASE2','1','IT',array['stamp:1st-edition'],'https://example.com/it','{"source_language":"it"}','source',null),('c',3,'C','BASE2','1','und',array['stamp:1st-edition'],'https://example.com/unknown','{}','source',null);`)
  const call=async(key,after='',size=24,review=false)=>(await pg.query('select catalog_visual_cards($1,$2,$3,$4) result',[key,after,size,review])).rows[0].result
  let r=await call(a.asset_key);assert.equal(r.results.length,1);assert.equal(r.results[0].actual_language,'en');assert.equal(r.results[0].image_match_status,'candidate');assert.equal(r.results[0].position,null)
  r=await call(a.asset_key,'',1,true);assert.equal(r.results.length,1);assert.equal(r.has_more,true)
  assert.equal((await call(a.asset_key,r.next_key,1,true)).results[0].entry_key,'b')
  assert.equal((await call(set.asset_key)).results[0].card_id,1)
  await pg.query("insert into catalog_visual_links(asset_key,entry_key,status,evidence_url) values($1,'a','rejected','https://example.com/review')",[a.asset_key])
  assert.equal((await call(a.asset_key)).results.length,0)
  await pg.exec('set role anon')
  assert.equal((await call(set.asset_key)).results.length,1)
  await assert.rejects(pg.exec('delete from catalog_visual_assets'),/permission denied/)
 }finally{await pg.close()}
})
test('set mapping is unambiguous, language-specific and excludes placeholders, logos and unsupported types',()=>{
 execFileSync('python3',['-c',`
import sys
sys.path.insert(0,'scripts')
from visual_asset_rules import norm,resolve_set,propose_rule
assert norm("McDonald's & Collection")=='mcdonaldsandcollection'
sets=[{'id':'sv08.5','name':'Prismatic Evolutions'},{'id':'swsh01','name':'Sword & Shield'},{'id':'tk-xy-su','name':'XY trainer Kit (Suicune)'}]
assert resolve_set({'source_code':'sv8pt5'},sets)[0]=='sv08.5'
assert resolve_set({'source_code':'swsh1'},sets)[0]=='swsh01'
assert resolve_set({'source_code':'xy-trainer-kit-suicune'},sets)[0]=='tk-xy-su'
assert resolve_set({'source_code':'same'},[{'id':'a','name':'Same'},{'id':'b','name':'Same'}])[0] is None
base={'scope':'physical','availability':'available','image_sha256':'hash','source_language':'und','kind':'set_symbol','source_code':'xy-trainer-kit-suicune','image_url':'https://example.com/symbol.png','provenance':{'source':'PokemonSymbols'}}
assert propose_rule(base,{'en':sets},[])['match_code']=='tk-xy-su'
assert propose_rule({**base,'source_code':'base1'},{'en':sets},[])['match_mode'] is None
assert propose_rule({**base,'source_code':'base-set'},{'en':[{'id':'base1','name':'Base Set'}]},[])['scope']=='reference'
for code in ['sv9','sv09']:
 assert propose_rule({**base,'source_code':code,'image_url':'https://raw.githubusercontent.com/1niceroli/ptcg-assets/main/'+code+'/symbol.png'},{'en':sets},[])['match_mode'] is None
assert propose_rule({**base,'kind':'energy','source_code':'move-special'},{},['type:move-special'])['match_mode'] is None
assert propose_rule({**base,'source_language':'ja','source_code':'sv3'},{'en':[{'id':'sv03','name':'English'}],'ja':[{'id':'sv3','name':'Japanese'}]},[])['match_code']=='sv3'
`],{stdio:'pipe'})
})
