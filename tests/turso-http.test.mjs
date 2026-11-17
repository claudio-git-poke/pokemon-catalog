import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createClient} from '@supabase/supabase-js'
import {catalogFixture,schema,putRow} from './helpers/turso-fixture.mjs'
import {handleCatalogRequest} from '../src/server/turso-http.mjs'
import {updateCard,protectCardFields} from '../src/server/turso-writes.mjs'

async function fixture(){
 const client=await catalogFixture({cards:[{id:1,nome:'Iono',file_name:'iono.png',numero:269,sigla:'SV02@IT',lingua:'IT',variante:'normal',image_status:'missing',notes:'Originale'}],catalog_search_entries:[{entry_key:'card:1',card_id:1,name:'Iono',set_code:'SV02@IT',language:'IT',verification:'catalog',search_text:'iono sv02 269',tags:['rarity:special-illustration-rare'],facts:{shiny:false}}],catalog_live_updates:[{scope:'catalog',revision:5,updated_at:'2026-11-17T00:00:00Z'}]})
 const serve=(input,init,mode='manual')=>handleCatalogRequest(new Request(input,init),{client,schema,mode,ready:async()=>true,writeCard:(p,b,m)=>updateCard(client,schema,p,b,m),protectCard:p=>protectCardFields(client,p)})
 const sdk=(mode='manual')=>createClient('http://catalog.test/api/catalog-db','catalog-public',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>serve(input,init,mode)}})
 return {client,serve,sdk}
}
test('the existing Supabase SDK reads counts, embedded cards, single objects, tags and RPCs through Turso HTTP',async()=>{
 const {client,sdk}=await fixture(),db=sdk()
 const result=await db.from('catalog_search_entries').select('entry_key,tags,facts,cards(nome,image_url)',{count:'exact'}).contains('tags',['rarity:special-illustration-rare']).range(0,23)
 assert.equal(result.error,null);assert.equal(result.count,1);assert.deepEqual(result.data[0].tags,['rarity:special-illustration-rare']);assert.deepEqual(result.data[0].facts,{shiny:false});assert.equal(result.data[0].cards.nome,'Iono')
 const head=await db.from('cards').select('id',{count:'exact',head:true});assert.equal(head.count,1);assert.equal(head.data,null)
 const single=await db.from('cards').select('id,nome').eq('id',1).single();assert.deepEqual(single.data,{id:1,nome:'Iono'})
 const absent=await db.from('cards').select('id').eq('id',2).maybeSingle();assert.equal(absent.error,null);assert.equal(absent.data,null)
 const rpc=await db.rpc('identify_catalog_cards',{tokens:['iono'],required_tags:[],page_size:24});assert.equal(rpc.error,null);assert.equal(rpc.data.total,1)
 const terms=await db.from('catalog_terms').select('code,label,aliases').limit(2000);assert.equal(terms.error,null)
 client.close()
})
test('manual edits are atomic, retain unrelated current locks, enqueue publication and defeat automatic overwrites',async()=>{
 const {client,sdk}=await fixture(),db=sdk()
 let result=await db.from('cards').update({notes:null,manual_overrides:{notes:null}}).eq('id',1).select('notes,manual_overrides').single()
 assert.equal(result.error,null);assert.equal(result.data.notes,null);assert.equal(result.data.manual_overrides.notes,null)
 assert.equal((await client.execute('SELECT version FROM _catalog_manual_outbox')).rows[0].version,1)
 const revision=await db.from('catalog_live_updates').select('revision').eq('scope','catalog').single();assert.equal(revision.data.revision,6)
 result=await sdk('automatic').from('cards').update({notes:'Importatore',image_status:'found',image_url:'https://example.test/auto.png'}).eq('id',1).select('*').single()
 assert.equal(result.error,null);assert.equal(result.data.notes,null);assert.equal(result.data.image_status,'found');assert.equal((await client.execute('SELECT version FROM _catalog_manual_outbox')).rows[0].version,1)
 result=await db.from('cards').update({image_url:null,image_status:'manual',image_source:'manual',manual_overrides:{notes:'stale',image_url:null}}).eq('id',1).select('*').single()
 assert.equal(result.error,null);assert.equal(result.data.notes,null);assert.equal(result.data.manual_overrides.notes,null);assert.equal(result.data.manual_overrides.image_url,null)
 const protectedResult=await db.rpc('catalog_protect_card_fields',{target_card_id:1,field_names:['nome'],expected_values:{nome:'Iono'}})
 assert.equal(protectedResult.error,null);assert.equal(protectedResult.data.manual_overrides.nome,'Iono')
 const stale=await db.rpc('catalog_protect_card_fields',{target_card_id:1,field_names:['nome'],expected_values:{nome:'Nome vecchio'}});assert.equal(stale.status,409)
 const before=Number((await client.execute('SELECT version FROM _catalog_manual_outbox')).rows[0].version)
 const invalid=await db.from('cards').update({file_name:null}).eq('id',1);assert.ok(invalid.error);assert.equal(Number((await client.execute('SELECT version FROM _catalog_manual_outbox')).rows[0].version),before)
 assert.equal((await client.execute('SELECT mode,depth FROM _catalog_write_context')).rows[0].mode,'manual')
 await putRow(client,'cards',{id:2,file_name:'other.png'})
 const duplicate=await db.from('cards').update({file_name:'other.png'}).eq('id',1);assert.equal(duplicate.status,409)
 assert.equal((await db.from('cards').select('file_name').eq('id',1).single()).data.file_name,'iono.png')
 client.close()
})
test('HTTP cannot expose private history, invoke worker RPCs, spoof automatic mode or make cross-origin writes',async()=>{
 const {client,sdk,serve}=await fixture()
 assert.equal((await sdk().from('catalog_manual_history').select('*')).status,403)
 assert.equal((await sdk().rpc('catalog_sync_claim',{worker:'attacker'})).status,404)
 assert.equal((await sdk().from('cards').delete().eq('id',1)).status,405)
 assert.equal((await sdk().from('cards').update({source_uid:'changed'}).eq('id',1)).status,403)
 const forged=await serve('http://catalog.test/api/catalog-db/rest/v1/cards?id=eq.1',{method:'PATCH',headers:{'content-type':'application/json','x-catalog-write-mode':'automatic'},body:JSON.stringify({notes:'Manuale'})});assert.equal(forged.status,204)
 const row=await sdk().from('cards').select('manual_overrides').eq('id',1).single();assert.equal(row.data.manual_overrides.notes,'Manuale')
 const foreign=await serve('http://catalog.test/api/catalog-db/rest/v1/cards?id=eq.1',{method:'PATCH',headers:{origin:'http://foreign.test'},body:'{"notes":"foreign"}'});assert.equal(foreign.status,403)
 client.close()
})
