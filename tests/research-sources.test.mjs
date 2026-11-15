import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {pokumonRecord,bulbapediaRecord,limitlessRecord,limitlessSets,limitlessLinks,researchFetcher} from '../scripts/research-sources.mjs'
import {inventoryRecord} from '../scripts/printing-inventory.mjs'
import {resolvePublication} from '../scripts/bindex-identity.mjs'
const fixture=async name=>readFile(new URL('fixtures/'+name,import.meta.url),'utf8')
const poku=JSON.parse(await fixture('pokumon-card.json'))
test('Pokumon keeps Simplified Chinese and event-stamp terms but excludes its real placeholder',()=>{
 const r=pokumonRecord(poku);assert.equal(r.language,'CHN');assert.equal(r.image,null);assert.equal(r.number,'001');assert.equal(r.payload.source_terms.additional_attributes[0].slug,'event-stamp')
 const traditional=structuredClone(poku);traditional._embedded['wp:term'][0].find(t=>t.taxonomy==='language').slug='chinese'
 assert.equal(pokumonRecord(traditional).language,'und')
 const conflict=structuredClone(poku);conflict._embedded['wp:term'][0].push({taxonomy:'language',slug:'english'})
 assert.equal(pokumonRecord(conflict).language,'und')
 assert.throws(()=>pokumonRecord({...poku,link:'https://example.com/card/wrong/'}))
})
test('Pokumon structured Cosmos is searchable and shiny while the exact scan stays unverified',()=>{
 const data=structuredClone(poku),terms=data._embedded['wp:term'][0];terms.find(t=>t.taxonomy==='holofoil').slug='cosmos'
 const r=pokumonRecord(data);assert.ok(r.tags.includes('pattern:cosmos'));assert.ok(r.tags.includes('visual:shiny'));assert.equal(r.facts.shiny,true)
 const record=inventoryRecord({entry:{entry_key:r.uid,card_id:1,language:r.language,source_url:r.url,source_payload:{metadata_scope:'card-metadata-only',...r.payload},tags:r.tags}})
 assert.equal(record.scope,'card');assert.equal(record.image_status,'missing');assert.equal(record.canonical_mapping_status,'pending')
})
test('Bulbapedia records English base identity and mixed-language mentions without manufacturing printings',async()=>{
 const page=JSON.parse(await fixture('bulbapedia-card.json')),r=bulbapediaRecord(page)
 assert.equal(r.language,'EN');assert.equal(r.number,'047');assert.equal(r.set,'SVP Black Star Promos');assert.equal(r.image,null)
 assert.ok(r.payload.variant_mentions.includes('Smooth Cosmos'));assert.ok(r.payload.variant_mentions.includes('Pixel Cosmos'));assert.ok(r.payload.variant_mentions.includes('Poké Ball'))
 assert.equal(r.payload.variant,undefined);assert.equal(bulbapediaRecord({pageid:1}),null)
 assert.equal(resolvePublication({source_payload:r.payload},null,[],[]).reason,'source_identity_requires_verified_mapping')
})
test('Limitless actual EN IT JP images never cross languages or accept translated proxies',async()=>{
 const en=await fixture('limitless-card.html'),it=await fixture('limitless-it.html'),jp=await fixture('limitless-jp-card.html')
 assert.equal(limitlessRecord(en,'en','SVP','47').language,'EN');assert.equal(limitlessRecord(it,'it','SVP','47').language,'IT');assert.equal(limitlessRecord(jp,'jp','SV2a','4').language,'JP')
 assert.throws(()=>limitlessRecord(en,'it','SVP','47'));assert.throws(()=>limitlessRecord(en,'en.t','SVP','47'))
 assert.deepEqual(limitlessSets('<a href="/cards/jp/SV2a">Set</a><a href="/cards/MEP">Set</a><a href="/cards/advanced">Search</a>'),['SV2a','MEP'])
 assert.deepEqual(limitlessLinks('<a href="/cards/it/SVP/47">Card</a>','it','SVP'),['47'])
 assert.throws(()=>limitlessLinks('<a href="/cards/en/SVP/47">Card</a>','it','SVP'))
})
test('research HTTP client respects crawl delay, rejects arbitrary hosts and surfaces source failures',async()=>{
 let clock=10000;const waits=[];const client=researchFetcher({clock:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms},fetchImpl:async()=>new Response('{}',{headers:{'x-wp-totalpages':'4'}})})
 await client('https://bulbapedia.bulbagarden.net/w/api.php',true);await client('https://bulbapedia.bulbagarden.net/w/api.php',true)
 assert.equal(waits[1],5100);await assert.rejects(client('https://example.com/data',true))
 const failed=researchFetcher({wait:async()=>{},fetchImpl:async()=>new Response('',{status:429})})
 await assert.rejects(failed('https://pokumon.com/wp-json/',true),/429/)
})
test('worker retains cursor and retries missing images while saving valid records idempotently',async()=>{
 const {PGlite}=await import('@electric-sql/pglite'),{postgresClient}=await import('./helpers/postgres-client.mjs'),{runResearch}=await import('../scripts/research-sources.mjs')
 const pg=new PGlite();try{
  await pg.exec(`create table cards(id bigint generated always as identity primary key,source_uid text unique,source_language text,source_local_id text,source_card_id text,nome text,sigla text,lingua text,numero integer,variante text,codice text,file_name text,image_status text,image_url text,image_source text,notes text);
   create table catalog_search_entries(entry_key text primary key,card_id bigint references cards(id),name text,set_code text,language text,collector_number text,denominator text,tags text[],facts jsonb,source_url text,source_payload jsonb,verification text,image_url text,label text,search_text text,updated_at timestamptz default now());
   create table catalog_sync_sets(source_uid text primary key,provider text,source_language text,set_id text,name text,last_sync_at timestamptz,next_sync_at timestamptz default now(),last_error text,card_count integer default 0);`)
  const db=postgresClient(pg),page=JSON.parse(await fixture('bulbapedia-card.json')),it=await fixture('limitless-it.html'),en=await fixture('limitless-card.html'),jp=await fixture('limitless-jp-card.html')
  const requests=[]
  const request=async(raw)=>{
   requests.push(raw)
   const u=new URL(raw)
   if(u.hostname==='pokumon.com')return {pages:1,body:[poku]}
   if(u.hostname.includes('bulbapedia'))return {body:{query:{pages:{[page.pageid]:page}},continue:{gcmcontinue:'saved-token',continue:'gcmcontinue||'}}}
   const root=u.pathname==='/cards'||u.pathname==='/cards/jp'
   if(root)return {body:u.pathname.endsWith('/jp')?'<a href="/cards/jp/SV2a">Set</a>':'<a href="/cards/SVP">Set</a>'}
   const parts=u.pathname.split('/'),lang=parts[2],set=parts[3]
   if(parts.length===4)return {body:`<a href="/cards/${lang}/${set}/${lang==='jp'?'4':'47'}">Card</a>`}
   return {body:lang==='it'?it:lang==='jp'?jp:en}
  }
  const result=await runResearch({db,request,log:()=>{}});assert.ok(result.added>=5);assert.ok(result.errors>0)
  assert.deepEqual(requests.filter(u=>/\/cards\/(it|en)\/SVP\/47$/.test(u)).map(u=>new URL(u).pathname.split('/')[2]),['it','en'])
  const bulba=(await pg.query("select set_id from catalog_sync_sets where provider='research-bulbapedia' limit 1")).rows[0]
  assert.equal(JSON.parse(bulba.set_id).continuation.gcmcontinue,'saved-token')
  const missing=(await pg.query("select set_id,last_error from catalog_sync_sets where source_uid='research:limitless:fr:SVP'")).rows[0]
  assert.deepEqual(JSON.parse(missing.set_id).retry,['47']);assert.match(missing.last_error,/in attesa/)
  const before=(await pg.query('select count(*)::int n from cards')).rows[0].n
  const second=await runResearch({db,request,log:()=>{}});assert.equal(second.added,0)
  assert.equal((await pg.query('select count(*)::int n from cards')).rows[0].n,before)
 }finally{await pg.close()}
})
