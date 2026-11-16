import {readFile} from 'node:fs/promises'
import {syncCuratedReleases,enrichCatalog} from './enrich-catalog.mjs'
import {syncDeckMappings} from './deck-mappings.mjs'
import {releaseCardIndex,resolveReleaseCard} from './release-card-links.mjs'
import {resolvePublication} from './bindex-identity.mjs'
import {publishBindex} from './publish-bindex.mjs'
const check=async q=>{const{data,error}=await q;if(error)throw Error(error.message);return data}
const load=async file=>JSON.parse(await readFile(new URL('../data/'+file+'.json',import.meta.url),'utf8'))
const canonical=release=>release.startsWith('trick-or-trade-')?(release.endsWith('2022')?'BOO':'BOO'+release.slice(-2)):release.startsWith('prize-pack-')?'PPS'+release.split('-').at(-1):release.startsWith('world-championships-')?'WCD'+release.slice(-2):release.startsWith('battle-academy-')?'BA'+release.slice(-2):'MFB'
export function manifestIdentity(r){return JSON.stringify([r.release_code,r.deck??null,r.deck_number??null,r.set_id??null,r.local_id??null,r.name,r.holo??null])}
export function summarizeReleases(manifest,cards,entries,links,sets,reference){
 const releases=[]
 for(const code of [...new Set(manifest.map(r=>r.release_code))].sort()){
  const rows=manifest.filter(r=>r.release_code===code),unique=[...new Map(rows.map(r=>[manifestIdentity(r),r])).values()]
  const eligible=unique.filter(r=>r.set_id&&r.local_id),issues=[]
  for(const r of eligible){const found=resolveReleaseCard(r,cards);if(!found.card)issues.push({...r,reason:found.reason})}
  const observed=entries.filter(e=>e.release_code===code),published=observed.filter(e=>links.some(l=>l.entry_key===e.entry_key)).length
  const reasons={}
  for(const e of observed.filter(e=>!links.some(l=>l.entry_key===e.entry_key))){const result=resolvePublication(e,cards.find(c=>c.id===e.card_id),sets,reference);const reason=result.reason||'ready_to_publish';reasons[reason]=(reasons[reason]||0)+1}
  releases.push({code,name:rows[0].release_name,canonical_set:canonical(code),documented:rows.length,unique:unique.length,duplicate_copies:rows.length-unique.length,
   source_identified:eligible.length,undocumented_printing:unique.length-eligible.length,source_unlinked:issues.length,indexed:observed.length,published,
   publication_pending:reasons,issues:issues.slice(0,30),reference_entries:reference.filter(r=>r.sigla===canonical(code)).length})
 }
 // Canonical references without a source checklist are NOT zero-missing releases.
 for(const s of sets.filter(s=>/^(PPS\d+|BOO(?:\d\d)?|BA\d\d|WCD\d\d|MFB)$/.test(s.sigla)&&s.sigla!=='MFB')){
  if(releases.some(r=>r.canonical_set===s.sigla))continue
  releases.push({code:s.sigla,name:s.nome,canonical_set:s.sigla,documented:null,unique:null,indexed:null,published:null,source_unlinked:null,reference_entries:reference.filter(r=>r.sigla===s.sigla).length,status:'source_manifest_missing',issues:[]})
 }
 return releases
}
export async function auditSpecialReleases({db,log=console.log,publish=true,enrich=true,fetchDetail}={}){
 const started=new Date().toISOString()
 const [curated,decks,world,mfb]=await Promise.all(['catalog-releases','catalog-decks','catalog-world-decks','catalog-mfb-identities'].map(load))
 const manifest=[...curated,...decks,...world]
 const importCurated=await syncCuratedReleases({db,log}),importDecks=await syncDeckMappings({db,log})
 const mfbCards=await check(db.from('cards').select('*').in('sigla',['MFB','MFB@INT']).eq('lingua','INT').order('id'))
 const supportedMfb=mfbCards.filter(c=>mfb.some(r=>r.id===c.source_card_id)&&c.source_language==='en')
 const enrichRows=supportedMfb.filter(c=>!c.traits_checked_at&&c.source_card_id&&(!c.source_uid||c.source_uid.startsWith('tcgdex:en:')))
 const enriched=enrich&&enrichRows.length?await enrichCatalog({db,log,cardRows:enrichRows,limit:100,budgetMs:90000,fetchDetail}):null
 const cards=await releaseCardIndex(db,manifest);for(const c of mfbCards)if(!cards.some(x=>x.id===c.id))cards.push(c)
 const sets=await check(db.from('set_espansioni').select('*').order('sigla')),reference=[]
 for(let offset=0;;offset+=1000){const page=await check(db.from('set_carte').select('*').order('sigla').order('numero').order('variante').range(offset,offset+999));reference.push(...page);if(page.length<1000)break}
 const entries=[]
 for(let offset=0;;offset+=500){const page=await check(db.from('catalog_search_entries').select('*').in('release_code',[...new Set(manifest.map(r=>r.release_code))]).order('entry_key').range(offset,offset+499));entries.push(...page);if(page.length<500)break}
 const mfbEntries=await check(db.from('catalog_search_entries').select('*').in('card_id',mfbCards.map(c=>c.id)).neq('verification','catalog').order('entry_key'));entries.push(...mfbEntries)
 const links=[]
 for(let n=0;n<entries.length;n+=200)links.push(...await check(db.from('catalog_export_links').select('*').in('entry_key',entries.slice(n,n+200).map(e=>e.entry_key))))
 const ready=entries.filter(e=>!links.some(l=>l.entry_key===e.entry_key)&&resolvePublication(e,cards.find(c=>c.id===e.card_id),sets,reference).row)
 let published=0
 if(publish)for(let n=0;n<ready.length;n+=100){const r=await publishBindex({db,log,entryBatch:ready.slice(n,n+100),limit:100});published+=r.published}
 const finalLinks=[]
 for(let n=0;n<entries.length;n+=200)finalLinks.push(...await check(db.from('catalog_export_links').select('*').in('entry_key',entries.slice(n,n+200).map(e=>e.entry_key))))
 const releases=summarizeReleases(manifest,cards,entries,finalLinks,sets,reference)
 const sourceIds=new Set(supportedMfb.map(c=>c.source_card_id))
 releases.push({code:'my-first-battle-2023',name:'My First Battle',canonical_set:'MFB',documented:mfb.length,unique:mfb.length,source_identified:mfb.length,
  source_unlinked:mfb.filter(r=>!sourceIds.has(r.id)).length,indexed:mfbEntries.length,published:mfbEntries.filter(e=>finalLinks.some(l=>l.entry_key===e.entry_key)).length,
  reference_entries:reference.filter(r=>r.sigla==='MFB').length,issues:mfb.filter(r=>!sourceIds.has(r.id)).map(r=>({name:r.name,reason:'source_card_not_linked'}))})
 const report={contract:'special-release-audit-v1',started_at:started,generated_at:new Date().toISOString(),language_scope:'English source checklists; other languages not inferred',
  scope:'Documented source entries, not a worldwide card count. Repeated deck copies are consolidated. Unknown Energy printings and missing source checklists remain unknown.',
  import_curated:importCurated,import_decks:importDecks,mfb_enrichment:enriched,published_now:published,releases}
 await check(db.from('catalog_special_release_audit').upsert({id:'latest',report,updated_at:report.generated_at},{onConflict:'id'}))
 return report
}
