'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {OBSERVATIONS} from '@/lib/catalog-identification'
import {evidenceSource} from '@/lib/identification-evidence'
import {PRINTING_FIELDS,printingFieldValues,printingScope,comparePrintings,printingLink,type PrintingEvidence} from '@/lib/printing-evidence'

export default function PrintingTraits({cardId}:{cardId:number}){
 const [rows,setRows]=useState<PrintingEvidence[]>([]),[selected,setSelected]=useState(''),[comparison,setComparison]=useState('')
 const [error,setError]=useState(''),[loading,setLoading]=useState(true),[missing,setMissing]=useState(false),[message,setMessage]=useState(''),[refresh,setRefresh]=useState(0)
 useEffect(()=>{
  let active=true;setLoading(true);setRows([]);setSelected('');setComparison('');setError('');setMessage('');setMissing(false)
  supabase.from('catalog_search_entries').select('entry_key,label,tags,facts,source_url,release_year,verification,image_url,updated_at,collector_number,denominator,deck_code,deck_number,source_payload').eq('card_id',cardId).neq('verification','catalog').order('entry_key').then(({data,error})=>{
   if(!active)return;setLoading(false);if(error){setError(error.message);return}
   const result=(data||[]) as PrintingEvidence[];setRows(result)
   const wanted=new URLSearchParams(location.search).get('stampa'),found=result.find(r=>r.entry_key===wanted)
   setMissing(!!wanted&&!found);setSelected(found?.entry_key||(wanted?'':result[0]?.entry_key||''))
  })
  return()=>{active=false}
 },[cardId,refresh])
 const row=rows.find(r=>r.entry_key===selected),other=rows.find(r=>r.entry_key===comparison)
 const source=row?evidenceSource(row.source_url):null
 function choose(key:string){setSelected(key);setComparison('');setMissing(false);setMessage('');if(key)history.replaceState(history.state,'',printingLink(location.href,key));else{const u=new URL(location.href);u.searchParams.delete('stampa');u.hash='stampe';history.replaceState(history.state,'',u.href)}}
 async function copy(){if(!row)return;try{await navigator.clipboard.writeText(printingLink(location.href,row.entry_key));setMessage('Link alla stampa copiato.')}catch{setMessage('Copia il link dalla barra degli indirizzi: la stampa selezionata è indicata nell’indirizzo.')}}
 return <section id="stampe" className="printing-evidence bg-white rounded-xl shadow p-6 space-y-4">
  <div className="flex flex-wrap justify-between items-center gap-3"><h2 className="font-semibold text-xl">Stampe, differenze e fonti</h2>{row&&<button className="border rounded-lg px-3 py-2 text-sm" onClick={()=>void copy()}>Copia link a questa stampa</button>}</div>
  {message&&<p role="status" className="text-sm">{message}</p>}
  {loading?<p role="status">Caricamento delle caratteristiche…</p>:error?<div role="alert"><p>Indice non disponibile: {error}</p><button className="underline" onClick={()=>setRefresh(v=>v+1)}>Riprova</button></div>:!rows.length?<p>La carta è nel catalogo, ma le caratteristiche delle sue varianti non sono ancora indicizzate. I dati mancanti restano sconosciuti.</p>:<>
   {missing&&<p role="alert">La stampa indicata nel link non è disponibile per questa carta. Scegli una delle voci presenti: non ne è stata selezionata automaticamente un’altra.</p>}
   <label className="block text-sm">Stampa da esaminare<select className="w-full border rounded-lg p-2 mt-2" value={selected} onChange={e=>choose(e.target.value)}><option value="">Scegli una stampa</option>{rows.map((r,i)=><option key={r.entry_key} value={r.entry_key}>{i+1}. {r.label}{r.release_year?` · ${r.release_year}`:''}</option>)}</select></label>
   {row&&<>
    <div className="printing-source-note"><strong>{printingScope(row)==='card'?'Dati generali della carta':'Caratteristiche della variante indicizzata'}</strong><p>{printingScope(row)==='card'?'Questa fonte documenta la carta, ma non distingue necessariamente le sue finiture o gli stampini.':'Le informazioni appartengono a questa voce dell’indice. Non vanno estese automaticamente alle altre stampe.'}</p><p>{row.verification==='reviewed'?'Revisione registrata':'Metadati documentati dalla fonte'}{row.updated_at&&Number.isFinite(Date.parse(row.updated_at))?` · Indicizzati il ${new Date(row.updated_at).toLocaleString('it-IT',{timeZone:'Europe/Rome'})}`:''}</p>{source?<a className="underline" href={source.url} target="_blank" rel="noopener noreferrer">Consulta la fonte · {source.host}</a>:<p>Collegamento alla fonte non disponibile.</p>}</div>
    <dl className="printing-facts-grid">{PRINTING_FIELDS.map(([prefix,label])=>{const values=printingFieldValues(row,prefix);return <div key={prefix}><dt>{label}</dt><dd>{values.length?values.join(' · '):'Non documentato'}</dd></div>})}</dl>
    <p className="text-sm">Numero dichiarato dalla fonte: {row.collector_number||'non disponibile'}{row.denominator?'/'+row.denominator:''}{row.release_year?` · Anno di distribuzione: ${row.release_year}`:''}{row.deck_code?` · Mazzo: ${row.deck_code}`:''}{row.deck_number!=null?` · Posizione nel mazzo: ${row.deck_number}`:''}</p>
    <p className="printing-source-note">{row.image_url?'È presente una foto associata a questa voce: confronta comunque i dettagli stampati.':row.source_payload?.reference_image_only?'La fonte fornisce un’immagine di riferimento, che non certifica questa variante.':'La foto esatta di questa voce non è ancora associata.'} La foto generale della scheda non certifica automaticamente finitura, stampino o firma.</p>
    <details><summary className="cursor-pointer font-semibold">Indizi visivi documentati e sconosciuti</summary><ul className="printing-observations">{OBSERVATIONS.map(([key,text])=><li key={key}><span>{text}</span><b>{typeof row.facts[key]==='boolean'?(row.facts[key]?'Sì':'No'):'Da verificare'}</b></li>)}</ul><p className="text-sm">“Da verificare” non equivale a “No”.</p></details>
    {rows.length>1&&<div className="space-y-3"><label className="block text-sm">Confronta con un’altra voce della stessa carta<select className="w-full border rounded-lg p-2 mt-2" value={comparison} onChange={e=>setComparison(e.target.value)}><option value="">Nessun confronto</option>{rows.filter(r=>r.entry_key!==selected).map(r=><option key={r.entry_key} value={r.entry_key}>{r.label}{r.release_year?` · ${r.release_year}`:''}</option>)}</select></label>
     {other&&<><p className="text-sm">Le due voci possono essere varianti diverse oppure documentazioni della stessa stampa. Un dato mancante non prova una differenza.</p><div className="overflow-x-auto"><table className="w-full text-sm printing-comparison"><caption className="text-left mb-2">Confronto dei dati disponibili</caption><thead><tr><th>Caratteristica</th><th>{row.label}</th><th>{other.label}</th><th>Esito</th></tr></thead><tbody>{comparePrintings(row,other).map(r=><tr key={r.prefix}><th>{r.label}</th><td>{r.left.join(' · ')||'Non documentato'}</td><td>{r.right.join(' · ')||'Non documentato'}</td><td>{r.status==='same'?'Coincide':r.status==='different'?'Differisce':'Da verificare'}</td></tr>)}</tbody></table></div>{evidenceSource(other.source_url)&&<a className="underline text-sm" href={evidenceSource(other.source_url)!.url} target="_blank" rel="noopener noreferrer">Consulta anche la fonte della voce di confronto</a>}</>}
    </div>}
   </>}
  </>}
 </section>
}
