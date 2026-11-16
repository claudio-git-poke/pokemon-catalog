import assert from 'node:assert/strict'
const site='https://pokemon-catalog-zeta.vercel.app',api=process.env.NEXT_PUBLIC_SUPABASE_URL
const request=async(url,options={})=>{
 const r=await fetch(url,{...options,signal:AbortSignal.timeout(20000)})
 if(!r.ok)throw Error('HTTP '+r.status+' at '+new URL(url).pathname)
 return r
}
let key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if(!key){
 // Reuse the existing public browser configuration without storing or logging a key.
 const html=await(await request(site+'/simboli')).text()
 const urls=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(x=>new URL(x[1],site)).filter(u=>u.origin===site&&u.pathname.endsWith('.js')).slice(0,24)
 const chunks=await Promise.allSettled(urls.map(async u=>(await request(u)).text()))
 for(const chunk of chunks){
  if(chunk.status!=='fulfilled')continue
  for(const token of chunk.value.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)){
   try{const p=JSON.parse(Buffer.from(token[0].split('.')[1],'base64url'));if(p.role==='anon'&&p.ref==='vjpvbsvpumzrqzoupxee')key=token[0]}catch{}
  }
 }
}
assert.ok(key,'Public browser configuration unavailable')
if(key.startsWith('eyJ'))assert.equal(JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role,'anon')
const headers={apikey:key,'Content-Type':'application/json'}
const get=async(path)=>(await request(api+'/rest/v1/'+path,{headers})).json()
const post=async(path,body)=>(await request(api+'/rest/v1/rpc/'+path,{method:'POST',headers,body:JSON.stringify(body)})).json()
const query=new URLSearchParams({select:'entry_key,cards(image_url)',or:'(set_code.eq."SV02",set_code.like."SV02@*")',order:'cards(image_url).asc.nullslast,card_id.asc',limit:'200'})
const started=Date.now(),sorted=await get('catalog_search_entries?'+query)
assert.equal(sorted.length,200)
console.log(JSON.stringify({check:'joined-image-sort',status:200,rows:sorted.length,elapsed_ms:Date.now()-started}))
async function pages(fn,base){
 const rows=[];let after=''
 for(let n=0;n<50;n++){
  const p=await post(fn,{...base,after_key:after,page_size:100})
  assert.ok(Array.isArray(p.results),p.error)
  rows.push(...p.results)
  if(!p.has_more)return rows
  assert.ok(p.next_key&&p.next_key>after,'Pagination must advance');after=p.next_key
 }
 throw Error('Unexpectedly large symbol result')
}
const expansion=await pages('catalog_visual_cards',{symbol_key:'3f04cb1b77d2034c072df5edd09f9d06',include_review:false})
assert.ok(expansion.some(x=>x.card_id===167073),'Iono 269 must remain reachable')
const byCard=new Map()
for(const e of expansion){const row=byCard.get(e.card_id)||[];row.push(e.entry_key);byCard.set(e.card_id,row)}
for(const keys of byCard.values())assert.ok(!(keys.some(k=>k.startsWith('card:'))&&keys.some(k=>!k.startsWith('card:'))),'Generic fallback must not duplicate a matching printing')
console.log(JSON.stringify({check:'paldea-evolved',results:expansion.length,iono_269:true}))
const rarity=await pages('catalog_visual_cards',{symbol_key:'27ee47a73a3b3d9370356a15f2748291',include_review:false})
const languages={}
for(const r of rarity)languages[r.actual_language]=(languages[r.actual_language]||0)+1
assert.ok(languages.en>0&&languages.it>0,'Documented English and Italian rarities must be reachable')
console.log(JSON.stringify({check:'special-illustration-rare',results:rarity.length,languages}))
const trick=await pages('catalog_visual_group_cards',{symbol_group:'38c3e9d561c7b766d3ece9a05e50d763',include_review:false})
for(const year of [2022,2023,2024])assert.ok(trick.some(x=>x.release_year===year&&x.actual_language==='en'))
console.log(JSON.stringify({check:'trick-or-trade',results:trick.length}))
