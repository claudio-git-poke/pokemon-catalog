import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggressiveSearch } from '../src/lib/image-search.ts'
const card = { nome: 'Arcanine', sigla: 'MFB', lingua: 'INT', numero: 1, codice: 'MFB', file_name: 'MFB_001.jpg', link_cardmarket: null, variante: 'normale' }
function mock({ cards = [{ id: 'mfb-14', localId: '14', name: 'Arcanine' }], imageOK = true, failure = false } = {}) {
  const calls = []
  globalThis.fetch = async url => {
    calls.push(url)
    if (failure) return new Response('', { status: 503 })
    if (url.endsWith('/en/sets')) return Response.json([{ id: 'mfb', name: 'My First Battle' }])
    if (url.endsWith('/sets/mfb')) return Response.json({ cards })
    if (url.endsWith('/cards/mfb-14')) return Response.json({ id: 'mfb-14', variants_detailed: [{ type: 'normal', thirdParty: { tcgplayer: 524094 } }] })
    if (!url.startsWith('https://product-images.tcgplayer.com/')) return new Response('',{status:404})
    return new Response('', { status: imageOK ? 200 : 404, headers: { 'content-type': 'image/jpeg' } })
  }
  return calls
}
test('MFB uses exact set/name, not catalogue position; missing scan uses mapped product', async () => {
  const calls = mock(); const r = await aggressiveSearch(card)
  assert.equal(r.url, 'https://product-images.tcgplayer.com/fit-in/600x600/524094.jpg')
  assert.ok(calls.some(u => u.endsWith('/cards/mfb-14')))
  assert.ok(r.logs.length > 0)
})
test('ambiguous MFB name remains unresolved', async () => {
  mock({ cards: [{ id: 'mfb-1', name: 'Arcanine' }, { id: 'mfb-2', name: 'Arcanine' }] })
  assert.equal((await aggressiveSearch(card)).url, null)
})
test('broken image is not accepted', async () => { mock({ imageOK: false }); assert.equal((await aggressiveSearch(card)).url, null) })
test('unsupported language never falls back to English', async () => { const calls = mock(); assert.equal((await aggressiveSearch({ ...card, lingua: 'CHN' })).url, null); assert.equal(calls.length, 0) })
test('upstream error propagates instead of becoming placeholder', async () => { mock({ failure: true }); await assert.rejects(aggressiveSearch(card), /503/) })
test('non-normal variant is not silently replaced', async () => { mock(); assert.equal((await aggressiveSearch({ ...card, variante: 'reverse' })).url, null) })
test('imported source ID bypasses ambiguous legacy numbering', async () => {
 const calls=mock()
 const r=await aggressiveSearch({...card,source_card_id:'mfb-14',source_language:'en'})
 assert.ok(r.url?.includes('524094'))
 assert.equal(calls[0],'https://api.tcgdex.net/v2/en/cards/mfb-14')
})
test('historical English source still works when primary provider fails',async()=>{
 globalThis.fetch=async url=>{
  if(url.includes('api.tcgdex.net'))return new Response('',{status:503})
  if(url.includes('raw.githubusercontent.com/PokemonTCG'))return Response.json([{id:'base1-1',number:'1',images:{large:'https://images.pokemontcg.io/base1/1_hires.png'}}])
  return new Response('',{headers:{'content-type':'image/png'}})
 }
 const r=await aggressiveSearch({...card,sigla:'base1',nome:'Alakazam',numero:1})
 assert.equal(r.source,'pokemontcg-historical');assert.ok(r.logs.some(l=>l.includes('503')))
})
test('Korean moved CDN is refreshed from exact official feature image, not related cards',async()=>{
 globalThis.fetch=async url=>{
  if(url.includes('cards.image.pokemonkorea.co.kr'))return new Response('',{status:404})
  if(url.includes('/cards/detail/'))return new Response(`<img src="/symbols/energy.png"><img src="/public-assets/home/data/cards.image_www/data/wmimages/MEGA/M1L/M1L_001.webp?w=512" class="feature_image"><img src="/related.jpg">`,{headers:{'content-type':'text/html'}})
  return new Response('',{headers:{'content-type':'image/webp'}})
 }
 const r=await aggressiveSearch({...card,lingua:'KOR',sigla:'M1L',numero:1},{externalCandidates:[{url:'https://cards.image.pokemonkorea.co.kr/data/wmimages/MEGA/M1L/M1L_001.png',source:'atlas-official-ko',page:'https://pokemoncard.co.kr/cards/detail/BS2025009001'}]})
 assert.equal(r.source,'pokemon-korea-official-page');assert.match(r.url,/M1L_001.webp/)
})

test('MFB offers distinct variants without assigning an arbitrary product image',async()=>{
 globalThis.fetch=async url=>{
  if(url.endsWith('/en/sets'))return Response.json([{id:'mfb',name:'My First Battle'}])
  if(url.endsWith('/sets/mfb'))return Response.json({cards:[{id:'mfb-1',name:'Bulbasaur',localId:'1'}]})
  if(url.endsWith('/cards/mfb-1'))return Response.json({id:'mfb-1',variants_detailed:[{type:'normal',stamp:['bulbasaur'],thirdParty:{tcgplayer:523985}},{type:'normal',subtype:'blue-border',stamp:['bulbasaur','pokeball'],thirdParty:{tcgplayer:523984}}]})
  throw Error('An ambiguous image must not be fetched or accepted')
 }
 const r=await aggressiveSearch({...card,nome:'Bulbasaur',numero:29})
 assert.equal(r.url,null);assert.equal(r.alternatives.length,2)
 assert.match(r.message,/varianti diverse/);assert.match(r.alternatives[1].label,/blue-border/)
})
