'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
type Release={code:string;name:string;canonical_set:string;documented:number|null;unique:number|null;duplicate_copies?:number;source_identified?:number;undocumented_printing?:number;source_unlinked:number|null;indexed:number|null;published:number|null;reference_entries:number;status?:string;publication_pending?:Record<string,number>;issues:{name:string;reason:string;set_id?:string;local_id?:string}[]}
type Report={generated_at:string;published_now:number;releases:Release[]}
const n=(x:number|null|undefined)=>x==null?'Non rilevato':x.toLocaleString('it-IT')
const reasonLabel=(reason:string)=>({
 source_card_not_linked:'Carta originale non ancora collegata',
 ambiguous_source_identity:'Più carte corrispondono alla stessa identità della fonte',
 ambiguous_legacy_identity:'Più carte corrispondono a espansione, numero e nome',
 printing_identity_undocumented:'Espansione o numero della stampa da documentare',
 ready_to_publish:'Collegamento pronto per la pubblicazione',
 manual_identity_requires_explicit_mapping:'La correzione manuale richiede un collegamento esplicito',
 source_identity_requires_verified_mapping:'Identità della fonte da verificare',
 regional_identity_requires_verified_mapping:'Edizione regionale da verificare',
 asian_ordinal_requires_verified_page:'Numerazione dell’edizione asiatica da verificare',
 set_alias_unconfirmed:'Corrispondenza dell’espansione da confermare',
 product_namespace_requires_review:'Prodotto associato a più espansioni: verifica necessaria',
 ambiguous_source_product_id:'Il prodotto non distingue la finitura della stampa',
 variant_identity_unconfirmed:'Finitura della stampa da verificare',
 product_variant_identity_conflict:'Finitura del prodotto discordante',
 ambiguous_product_variants:'Il prodotto corrisponde a più varianti',
 mfb_product_identity_unverified:'Prodotto My First Battle da verificare',
 product_number_conflict:'Numero del prodotto discordante',
 number_or_variant_unconfirmed:'Numero o finitura da confermare',
 equivalent_legacy_variants_ambiguous:'Più varianti del catalogo corrispondono alla stampa',
 product_identity_conflict:'Identità del prodotto discordante',
 reused_product_id:'Prodotto già assegnato a un’altra stampa',
 name_language_unconfirmed:'Lingua del nome da confermare',
 curated_release_unconfirmed:'Uscita speciale da confermare',
 deck_page_identity_unconfirmed:'Identità della carta nel mazzo da verificare',
 deck_code_unconfirmed:'Contrassegno del mazzo da confermare',
 origin_code_unconfirmed:'Espansione o numero originali da confermare',
 curated_page_ambiguous_or_missing:'Corrispondenza con il catalogo assente o ambigua',
} as Record<string,string>)[reason]||'Identità da verificare'
export default function SpecialReleaseAudit(){
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[onlyIssues,setOnlyIssues]=useState(false)
 useEffect(()=>{const controller=new AbortController();async function read(){try{const {data,error}=await supabase.from('catalog_special_release_audit').select('report').eq('id','latest').abortSignal(controller.signal).maybeSingle();if(error)throw error;if(!controller.signal.aborted){setReport(data?.report||null);setError('')}}catch(e){if(!controller.signal.aborted)setError((e as {message?:string}).message||String(e))}}void read();const timer=setInterval(()=>{if(document.visibilityState==='visible')void read()},60000);return()=>{controller.abort();clearInterval(timer)}},[])
 const rows=report?.releases.filter(r=>!onlyIssues||r.documented==null||!!r.source_unlinked||!!r.undocumented_printing||Object.keys(r.publication_pending||{}).length)||[]
 return <section id="uscite-speciali" className="bg-white p-4 rounded-xl shadow space-y-3">
  <h2 className="text-2xl font-bold">BOO, buste premio, Mondiali, Battle Academy e Prima Lotta</h2>
  <p className="text-sm">Controllo degli elenchi inglesi documentati. Le altre lingue non vengono dedotte. Una stampa può essere disponibile nella ricerca e richiedere ancora il collegamento alla sua voce nel catalogo.</p>
  {error&&<p role="alert">Controllo non disponibile: {error}</p>}
  {!report&&!error&&<p>Prima verifica in preparazione.</p>}
  {report&&<><p className="text-sm">Rilevazione: {new Date(report.generated_at).toLocaleString('it-IT')} · Nuovi collegamenti pubblicati in questo ciclo: {n(report.published_now)}</p>
   <label className="flex gap-2 text-sm"><input type="checkbox" checked={onlyIssues} onChange={e=>setOnlyIssues(e.target.checked)}/>Mostra solo casi ancora da verificare</label>
   <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Uscita','Voci documentate','Copie ripetute','Stampa da identificare','Identità fonte non collegate','Stampe indicizzate','Collegamenti al catalogo'].map(h=><th className="p-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr className="border-t" key={r.code}><th className="p-2 text-left">{r.name}<span className="block text-xs font-normal">{r.canonical_set}</span></th>{[r.documented,r.documented==null?null:r.duplicate_copies??0,r.documented==null?null:r.undocumented_printing??0,r.source_unlinked,r.indexed,r.published].map((v,i)=><td className="p-2" key={i}>{n(v)}</td>)}</tr>)}</tbody></table></div>
   <p className="text-xs">Le copie ripetute di un mazzo non sono stampe diverse. Le energie senza identità documentata non vengono collegate per somiglianza del nome. “Non rilevato” indica un elenco mancante, non zero carte mancanti. I contatori non sono un totale di carte fisiche uniche.</p>
   <details><summary className="cursor-pointer">Motivi dei casi sospesi</summary><div className="space-y-3 mt-3">{rows.filter(r=>r.documented==null||r.issues.length||Object.keys(r.publication_pending||{}).length).map(r=><div className="text-sm" key={r.code}><strong>{r.name}</strong>{r.documented==null?<p>Elenco delle stampe da documentare; {n(r.reference_entries)} voci del catalogo già presenti.</p>:<><p>{Object.entries(r.publication_pending||{}).map(([reason,count])=>`${reasonLabel(reason)}: ${count}`).join(' · ')}</p>{r.issues.map((x,i)=><p key={i}>{x.name}{x.set_id&&x.local_id?` · ${x.set_id}/${x.local_id}`:''} · {reasonLabel(x.reason)}</p>)}</>}</div>)}</div></details>
  </>}
 </section>
}
