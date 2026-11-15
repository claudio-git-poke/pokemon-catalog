'use client'
import Link from 'next/link'
import CoverageRegister from '@/components/coverage-register'
import {useState} from 'react'
import {useLiveCatalog} from '@/lib/use-live-catalog'
import {supabase} from '@/lib/supabase'

type Counts={total:number;tagged:number;missing_image:number;placeholder:number;pending:number;retry:number;insufficient:number;unsupported:number;printings:number}
type Group=Counts&{provider:string;sigla:string;lingua:string}
type Warning={entry_key:string;card_id:number;name:string;set_code:string;reason:string}
type Report={generated_at:string;totals:Counts;groups:Group[];warnings:{total:number;by_reason:Record<string,number>;samples:Warning[];shared_verified_images:number};published:{total:number;tagged:number;without_image:number;verified_images:number}}
const n=(x:number)=>x.toLocaleString('it-IT')
const reasons:Record<string,string>={finish_conflict:'Finiture incompatibili nella stessa stampa',source_identity_conflict:'Identificativo della fonte discordante',number_conflict:'Numero della carta discordante'}
export default function CoveragePage(){
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true)
 const [provider,setProvider]=useState(''),[query,setQuery]=useState(''),[language,setLanguage]=useState(''),[page,setPage]=useState(0)
 const live=useLiveCatalog(async signal=>{setLoading(true);try{const {data,error}=await supabase.from('catalog_quality_cache').select('report,updated_at').eq('scope','catalog').abortSignal(signal).single();if(signal.aborted)return;if(error)throw error;setReport(data.report);setError('')}catch(e){if(!signal.aborted)setError(e instanceof Error?e.message:String((e as {message?:string}).message||e))}finally{if(!signal.aborted)setLoading(false)}},true,'coverage',15000)
 const groups=(report?.groups||[]).filter(g=>(!provider||g.provider===provider)&&(!language||g.lingua===language)&&g.sigla?.toLowerCase().includes(query.trim().toLowerCase()))
 const totals=groups.reduce((a,g)=>{for(const k of Object.keys(a) as (keyof Counts)[])a[k]+=Number(g[k])||0;return a},{total:0,tagged:0,missing_image:0,placeholder:0,pending:0,retry:0,insufficient:0,unsupported:0,printings:0})
 const filters=(fn:()=>void)=>{fn();setPage(0)}
 return <div className="space-y-6">
  <div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-3xl font-bold">Copertura e qualità</h1><p className="text-gray-600 mt-2">Quanto conosciamo delle carte importate e quali dati richiedono un controllo. Il riepilogo generale è salvato dal worker; la data indica la sua ultima rilevazione.</p></div><button className="border rounded-lg px-4 py-2" onClick={()=>void live.refresh()} disabled={loading}>{loading?'Lettura riepilogo…':'Rileggi riepilogo'}</button></div>
  {error&&<p role="alert" className="p-4 bg-red-50 text-red-800 rounded">Impossibile leggere la copertura: {error}. I dati precedenti, se presenti, restano visibili.</p>}
  <p className="text-sm text-gray-600" role="status">{live.status==='live'?'● Collegato · riepilogo salvato dopo ogni ciclo di importazione':'Riconnessione in corso · aggiornamento periodico di riserva attivo'}</p>
  <CoverageRegister/>
  {report&&<>
   <p className="text-sm text-gray-600">Rilevazione: {new Date(report.generated_at).toLocaleString('it-IT')} · <Link className="underline" href="/automazione">Segui il lavoro automatico</Link></p>
   <section className="bg-white rounded-xl p-4 shadow space-y-3"><h2 className="font-bold text-lg">Esplora per fonte ed espansione</h2><div className="flex flex-wrap gap-3">
    <label>Fonte <select className="border rounded p-2" value={provider} onChange={e=>filters(()=>setProvider(e.target.value))}><option value="">Tutte</option><option value="tcgdex">TCGdex</option><option value="atlas">Card Atlas</option><option value="legacy">Importazioni precedenti / altra fonte</option></select></label>
    <label>Lingua <select className="border rounded p-2" value={language} onChange={e=>filters(()=>setLanguage(e.target.value))}><option value="">Tutte</option>{[...new Set(report.groups.map(g=>g.lingua))].sort().map(l=><option key={l}>{l}</option>)}</select></label>
    <label>Espansione <input className="border rounded p-2" placeholder="Es. SWSH, MFB…" value={query} onChange={e=>filters(()=>setQuery(e.target.value))}/></label>
   </div></section>
   <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[['Carte importate',totals.total],['Con tag di fonte',totals.tagged],['Da controllare',totals.pending],['Da riprovare per errore',totals.retry],['Controllate, dati insufficienti',totals.insufficient],['Fonte senza controllo disponibile',totals.unsupported],['Senza URL immagine',totals.missing_image],['Segnalate come placeholder',totals.placeholder]].map(([label,value])=><div className="bg-white rounded-xl p-4 shadow" key={label}><p className="text-sm text-gray-600">{label}</p><strong className="text-2xl">{n(Number(value))}</strong></div>)}</div>
   <p>Le categorie dei metadati distinguono il lavoro in attesa dalle informazioni assenti nella fonte. Una carta con tag può avere ancora varianti non documentate: rarità, tipo e regolamento non confermano holo o stampini. “Senza URL” e “placeholder” possono sovrapporsi; i tag non certificano la foto.</p>
   <section className="bg-white rounded-xl p-4 shadow space-y-3"><h2 className="font-bold text-xl">Dettaglio delle importazioni</h2><p className="text-sm">{n(groups.length)} gruppi · {n(totals.printings)} voci con dati di fonte. Le lingue e le fonti possono contenere la stessa carta: questi numeri non sono il conteggio delle carte Pokémon uniche.</p>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Espansione','Fonte','Lingua','Carte','Con tag','Da controllare','Errori','Dati insufficienti','Fonte non supportata','Senza URL','Placeholder'].map(h=><th className="text-left p-2 whitespace-nowrap" key={h}>{h}</th>)}</tr></thead><tbody>{groups.slice(page*25,page*25+25).map(g=><tr className="border-t" key={[g.provider,g.sigla,g.lingua].join(':')}><td className="p-2 font-semibold">{g.sigla||'—'}</td><td className="p-2">{g.provider}</td><td className="p-2">{g.lingua}</td>{[g.total,g.tagged,g.pending,g.retry,g.insufficient,g.unsupported,g.missing_image,g.placeholder].map((v,i)=><td className="p-2" key={i}>{n(v)}</td>)}</tr>)}</tbody></table></div>
    {!groups.length&&<p>Nessun gruppo corrisponde ai filtri.</p>}<div className="flex items-center gap-4"><button className="border rounded px-3 py-2" disabled={!page} onClick={()=>setPage(page-1)}>Precedente</button><span>Pagina {page+1} di {Math.max(1,Math.ceil(groups.length/25))}</span><button className="border rounded px-3 py-2" disabled={(page+1)*25>=groups.length} onClick={()=>setPage(page+1)}>Successiva</button></div>
   </section>
   <section className="bg-white rounded-xl p-4 shadow space-y-3"><h2 className="font-bold text-xl">Controlli di coerenza · intero catalogo</h2><p>{n(report.warnings.total)} segnalazioni. I controlli confrontano i dati della stessa stampa: una carta disponibile sia holo sia normale non è un conflitto.</p>{Object.entries(report.warnings.by_reason).map(([reason,count])=><p key={reason}>{reasons[reason]||reason}: <strong>{n(count)}</strong></p>)}
    <p>URL di immagini dichiarate verificate condivisi da più identità: <strong>{n(report.warnings.shared_verified_images)}</strong>. È un invito a verificare, non una prova di errore: alcune ristampe possono condividere l’immagine.</p>
    {report.warnings.samples.length>0&&<ul className="space-y-2">{report.warnings.samples.map(w=><li key={w.entry_key}><Link className="underline" href={`/carte/${w.card_id}`}>{w.name} · {w.set_code}</Link> — {reasons[w.reason]||w.reason}</li>)}</ul>}
    <p className="text-sm text-gray-600">Mostrate al massimo 30 segnalazioni. Nessuna correzione automatica dei dati incerti.</p>
   </section>
   <section className="bg-white rounded-xl p-4 shadow space-y-2"><h2 className="font-bold text-xl">Catalogo pubblicato per Bindex · totale</h2><p>{n(report.published.total)} identità · {n(report.published.tagged)} con tag · {n(report.published.without_image)} senza immagine · {n(report.published.verified_images)} con immagine dichiarata verificata.</p><p className="text-sm">È il catalogo canonico, distinto dalle importazioni. I nuovi tag arrivano dopo i controlli di abbinamento del processo principale.</p></section>
  </>}
 </div>
}
