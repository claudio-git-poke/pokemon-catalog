'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
import {supabase} from '@/lib/supabase'
import {CATALOG_LANGUAGES} from '@/lib/catalog-languages'
import {evidenceSource} from '@/lib/identification-evidence'
type Inventory={inventory_entries:number;printing_entries:number;unidentified_entries:number;pending_identity:number;missing_exact:number;candidate_exact:number;verified_exact:number;unknown_language:number}
type Snapshot={started_at:string;generated_at:string;totals:{total:number;printings:number};inventory:Inventory;languages:(Inventory&{language:string})[]}
type Row=Inventory&{target_key:string;name:string;provider:string;source_language:string;language_label:string;source_set:string;source_url:string|null;status:string;reason:string;reported_count:number|null;manifest_count:number|null;resolved_count:number|null;missing_count:number|null;unexpected_count:number|null;checked_at:string|null;cards:number|null;reference_missing:number|null;placeholder:number|null;source_printings:number|null;manifest_last_attempt_at?:string|null;manifest_last_error?:string|null;coverage_detail:{missing_ids?:string[];unexpected_ids?:string[];duplicate_count?:number;comparison_scope?:string;source_url?:string}|null}
type Report={snapshot:Snapshot|null;stats:{lists:number;unmeasured:number;known_missing_ids:number;identity_lists:number;photo_lists:number};total:number;rows:Row[];languages:{source_language:string;label:string}[];providers:string[]}
const n=(v:number|null|undefined)=>v==null?'Non rilevato':v.toLocaleString('it-IT')
const languages:Record<string,string>=Object.fromEntries([...CATALOG_LANGUAGES.map(l=>[l.code,l.label]),['EN','Inglese'],['und','Lingua non determinata']])
const providers:Record<string,string>={tcgdex:'TCGdex',atlas:'Card Atlas',legacy:'Importazioni precedenti','supplement-en':'PkmnCards','supplement-th':'Ufficiale Thailandia','supplement-id':'Ufficiale Indonesia','research-limitless':'Limitless','research-pokumon':'Pokumon','research-bulbapedia':'Bulbapedia'}
const issues=[['unchecked','Elenchi da confrontare'],['cards','Identificativi mancanti o discordanti'],['identity','Versioni da identificare'],['photos','Foto esatte mancanti']] as const
export default function CoverageAudit(){
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0)
 const [issue,setIssue]=useState(''),[language,setLanguage]=useState(''),[provider,setProvider]=useState(''),[query,setQuery]=useState(''),[offset,setOffset]=useState(0)
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')setRefresh(v=>v+1)},60000);return()=>clearInterval(timer)},[])
 useEffect(()=>{const controller=new AbortController();setLoading(true);const timer=setTimeout(()=>{void(async()=>{
  try{const {data,error}=await supabase.rpc('catalog_coverage_audit_report',{wanted_issue:issue||null,wanted_language:language||null,wanted_provider:provider||null,query_text:query,page_offset:offset,page_size:25}).abortSignal(controller.signal)
   if(controller.signal.aborted)return;if(error)throw error;setReport(data);setError('')
  }catch(e){if(!controller.signal.aborted)setError((e as {message?:string}).message||String(e))}finally{if(!controller.signal.aborted)setLoading(false)}
 })()},250);return()=>{clearTimeout(timer);controller.abort()}},[issue,language,provider,query,offset,refresh])
 const filter=(action:()=>void)=>{action();setOffset(0)}
 const snapshot=report?.snapshot
 const stale=!!snapshot&&(Date.now()-Date.parse(snapshot.generated_at)>2*3600000||Date.now()-Date.parse(snapshot.started_at)>2*3600000)
 return <section id="mancanze" className="bg-white rounded-xl p-4 shadow space-y-4">
  <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-2xl font-bold">Cosa manca nel catalogo</h2><p className="text-sm mt-1">Carte da confrontare, versioni da identificare e foto esatte: tre lavori distinti.</p></div><button className="border rounded px-4 py-2" onClick={()=>setRefresh(v=>v+1)} disabled={loading}>{loading?'Lettura…':'Rileggi i risultati'}</button></div>
  <p className="text-sm"><strong>Il totale di tutte le carte e varianti esistenti non è ancora determinabile.</strong> Un elenco non controllato resta “da confrontare”, anche se contiene già carte importate. Un numero non rilevato non significa zero.</p>
  {error&&<p role="alert">Controllo non disponibile: {error}. Gli ultimi risultati, se presenti, restano visibili.</p>}
  {!report&&!error&&<p role="status">Lettura delle rilevazioni…</p>}
  {report&&<>
   <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
    {[['Elenchi da confrontare',report.stats.unmeasured],['Identificativi senza collegamento negli elenchi confrontati',report.stats.known_missing_ids],['Elenchi con versioni da identificare',snapshot?report.stats.identity_lists:null],['Elenchi con foto esatte mancanti',snapshot?report.stats.photo_lists:null]].map(([label,value])=><div className="border rounded-lg p-3" key={String(label)}><p className="text-sm">{label}</p><strong className="text-2xl">{n(value as number|null)}</strong></div>)}
   </div>
   <p className="text-xs">Questi sono riepiloghi globali di {n(report.stats.lists)} elenchi o gruppi di fonte. Fonti, pagine e lingue possono sovrapporsi: non sommare gli identificativi per ottenere carte fisiche uniche. Un identificativo senza collegamento esatto può appartenere a una carta già presente sotto un’altra fonte o corretta manualmente.</p>
   {snapshot?<div className={`border rounded-lg p-3 space-y-2 ${stale?'border-amber-500':''}`}>
    <p><strong>{stale?'Rilevazione da aggiornare':'Ultima rilevazione completata'}</strong> · {new Date(snapshot.generated_at).toLocaleString('it-IT')}</p>
    <p className="text-sm">Letture effettuate dal {new Date(snapshot.started_at).toLocaleString('it-IT')} mentre le importazioni continuavano. {n(snapshot.totals.total)} carte importate · {n(snapshot.totals.printings)} voci di fonte indicizzate · {n(snapshot.inventory.inventory_entries)} voci già elaborate nell’inventario.</p>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
     {[['Voci di variante descritte',snapshot.inventory.printing_entries],['Voci con versione da chiarire',snapshot.inventory.unidentified_entries],['Varianti descritte senza foto esatta',snapshot.inventory.missing_exact],['Foto esatte candidate / verificate',`${n(snapshot.inventory.candidate_exact)} / ${n(snapshot.inventory.verified_exact)}`]].map(([label,value])=><div key={label} className="text-sm"><p>{label}</p><strong>{typeof value==='number'?n(value):value}</strong></div>)}
    </div>
    <p className="text-xs">I conteggi delle varianti sono voci delle fonti, possono includere duplicati e riguardano l’inventario già elaborato. Una foto generica o un placeholder non conta come foto esatta. Il numero delle varianti ancora sconosciute resta da determinare.</p>
   </div>:<p role="status" className="border rounded-lg p-3">Prima rilevazione in preparazione. Il controllo procede in background a piccoli lotti e pubblica i numeri soltanto quando la scansione è completata. <Link className="underline" href="/automazione">Segui il lavoro</Link></p>}
   {snapshot&&<details><summary className="font-semibold cursor-pointer">Versioni e foto per lingua documentata della stampa</summary><div className="overflow-x-auto mt-3"><table className="w-full text-sm"><thead><tr>{['Lingua','Voci di variante','Versione da chiarire','Identità da collegare','Foto esatta mancante','Foto candidata','Foto verificata'].map(h=><th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{snapshot.languages.map(l=><tr key={l.language} className="border-t"><th className="text-left p-2">{languages[l.language]||l.language}</th>{[l.printing_entries,l.unidentified_entries,l.pending_identity,l.missing_exact,l.candidate_exact,l.verified_exact].map((v,i)=><td key={i} className="p-2">{n(v)}</td>)}</tr>)}</tbody></table></div><p className="text-xs mt-2">Le lingue sconosciute restano separate. Nessuna moltiplicazione automatica di una carta per tutte le lingue e finiture possibili.</p></details>}
   <div className="flex flex-wrap gap-3">
    <label className="text-sm">Lavoro da fare <select className="block border rounded p-2" value={issue} onChange={e=>filter(()=>setIssue(e.target.value))}><option value="">Tutti</option>{issues.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label className="text-sm">Lingua della fonte <select className="block border rounded p-2" value={language} onChange={e=>filter(()=>setLanguage(e.target.value))}><option value="">Tutte</option>{report.languages.map(l=><option key={l.source_language} value={l.source_language}>{l.label}</option>)}<option value="und">Non determinata</option></select></label>
    <label className="text-sm">Fonte <select className="block border rounded p-2" value={provider} onChange={e=>filter(()=>setProvider(e.target.value))}><option value="">Tutte</option>{report.providers.map(p=><option key={p} value={p}>{providers[p]||p}</option>)}</select></label>
    <label className="text-sm">Espansione / elenco <input className="block border rounded p-2" value={query} onChange={e=>filter(()=>setQuery(e.target.value))} placeholder="Nome o sigla"/></label>
   </div>
   <p role="status" className="text-sm">{loading?'Aggiornamento della lista…':`${n(report.total)} elenchi corrispondono ai filtri`}</p>
   <div className="space-y-3">{report.rows.map(r=><article key={r.target_key} className="border rounded-lg p-3 space-y-2">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">{r.name} · {r.source_set}</h3><p className="text-sm">{r.language_label} · {providers[r.provider]||r.provider}</p></div>
    <div className="grid md:grid-cols-3 gap-3 text-sm">
     <div><strong>Carte</strong><p>Dichiarate dalla fonte: {n(r.reported_count)} · Nell’elenco controllato: {n(r.manifest_count)}</p><p>Identificativi risolti: {n(r.resolved_count)} · Mancanti: <strong>{n(r.missing_count)}</strong>{!!r.unexpected_count&&` · Inattesi: ${n(r.unexpected_count)}`}</p><p>Voci di carta osservate nel catalogo: {n(r.cards)}</p></div>
     <div><strong>Versioni</strong><p>Voci di variante in inventario: {n(r.printing_entries)}</p><p>Versione da chiarire: {n(r.unidentified_entries)} · Identità da collegare: {n(r.pending_identity)}</p>{r.cards!==null&&r.cards>0&&r.inventory_entries===0&&<p>Inventario ancora da elaborare: non è una prova di assenza delle varianti.</p>}</div>
     <div><strong>Foto esatte delle varianti descritte</strong><p>Mancanti: {n(r.missing_exact)} · Candidate: {n(r.candidate_exact)} · Verificate: {n(r.verified_exact)}</p><p>Foto generiche senza URL: {n(r.reference_missing)} · Placeholder: {n(r.placeholder)}</p></div>
    </div>
    <details><summary className="text-sm cursor-pointer">Esito e identificativi da controllare</summary><div className="mt-2 text-sm space-y-2"><p>{r.reason}</p><p>{r.checked_at?`Confronto con l’elenco: ${new Date(r.checked_at).toLocaleString('it-IT')}`:'Nessun confronto degli identificativi registrato.'}</p>
     {!!r.coverage_detail?.duplicate_count&&<p>Identificativi duplicati nell’elenco della fonte: {n(r.coverage_detail.duplicate_count)}</p>}
     {r.coverage_detail?.comparison_scope==='expected_source_links'&&<p>Controllati i collegamenti agli identificativi elencati dalla fonte. L’assenza di un collegamento non dimostra l’assenza della carta fisica. Gli identificativi esterni a questo elenco non sono stati misurati.</p>}
     {r.manifest_last_error&&<p>Ultimo tentativo: {r.manifest_last_attempt_at?new Date(r.manifest_last_attempt_at).toLocaleString('it-IT'):'data non disponibile'}. L’ultima rilevazione valida resta conservata.</p>}
     {!!r.coverage_detail?.missing_ids?.length&&<p>Identificativi mancanti, fino a 30 esempi: {r.coverage_detail.missing_ids.join(', ')}</p>}
     {!!r.coverage_detail?.unexpected_ids?.length&&<p>Identificativi inattesi, fino a 30 esempi: {r.coverage_detail.unexpected_ids.join(', ')}</p>}
     {!!(r.coverage_detail?.source_url||r.source_url)&&evidenceSource((r.coverage_detail?.source_url||r.source_url)!)&&<a className="underline" href={evidenceSource((r.coverage_detail?.source_url||r.source_url)!)!.url} target="_blank" rel="noopener noreferrer">Consulta la fonte ↗</a>}
    </div></details>
   </article>)}</div>
   {!report.rows.length&&<p>Nessun elenco corrisponde ai filtri. Questo non certifica la completezza mondiale del catalogo.</p>}
   <div className="flex items-center gap-3"><button className="border rounded px-3 py-2" disabled={!offset||loading} onClick={()=>setOffset(v=>Math.max(0,v-25))}>Precedente</button><span>Pagina {Math.floor(offset/25)+1} di {Math.max(1,Math.ceil(report.total/25))}</span><button className="border rounded px-3 py-2" disabled={offset+25>=report.total||loading} onClick={()=>setOffset(v=>v+25)}>Successiva</button></div>
  </>}
 </section>
}
