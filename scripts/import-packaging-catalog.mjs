import {readFile} from 'node:fs/promises'
import {createClient} from '@supabase/supabase-js'
import {parsePackagingCatalog,packagingIdentity,proposePackagingLinks} from './packaging-catalog.mjs'
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const check=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
const {document,rows,counts}=parsePackagingCatalog(await readFile(new URL('../data/packaging/catalogo-sealed-2026-11-17.txt',import.meta.url),'utf8'))
await check(db.from('catalog_packaging_documents').upsert(document,{onConflict:'document_key'}))
for(let i=0;i<rows.length;i+=100)await check(db.from('catalog_packaging_candidates').upsert(rows.slice(i,i+100),{onConflict:'candidate_key'}))
// Respect manually corrected identifiers before proposing new links.
const candidates=await check(db.from('catalog_packaging_candidates').select('candidate_key,card_number,language').eq('document_key',document.document_key).neq('review_status','rejected').order('candidate_key'))
const sets=new Set()
for(const row of candidates){const id=packagingIdentity(row.card_number,row.language);if(id){sets.add(id.set+'@'+id.language);if(id.language==='INT')sets.add(id.set+'@EN')}}
const cards=[]
if(sets.size)for(let offset=0;;offset+=1000){
 const page=await check(db.from('cards').select('id,nome,sigla,lingua,source_local_id,source_language,source_uid').in('sigla',[...sets]).order('id').range(offset,offset+999))
 cards.push(...page);if(page.length<1000)break
}
const links=proposePackagingLinks(candidates,cards)
for(let i=0;i<links.length;i+=100)await check(db.from('catalog_packaging_links').upsert(links.slice(i,i+100),{onConflict:'candidate_key,card_id',ignoreDuplicates:true}))
const linked=new Set(links.map(x=>x.candidate_key))
console.log(JSON.stringify({task:'packaging-catalog',document:document.document_key,rows:rows.length,sources:document.source_manifest.length,claimed_levels:counts,proposed_links:links.length,candidates_with_card:linked.size,candidates_without_card:rows.length-linked.size,automatic_confirmations:0}))
