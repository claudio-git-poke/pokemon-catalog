'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {evidenceSource} from '@/lib/identification-evidence'
type Row={target_key:string;target_type:string;provider:string;source_language:string;language_label:string;region:string;release_code:string|null;name:string;coverage_scope:string;expected_count:number|null;resolved_count:number|null;checked_at:string|null;status:string;reason:string;source_url:string}
type Language={source_language:string;label:string;region:string;probe_status:string;listed_sets:number|null;last_probe_at:string|null}
type Report={generated_at:string;stats:Record<string,number>;total:number;rows:Row[];languages:Language[]}
const states:Record<string,string>={not_covered:'Non coperto',to_import:'Da importare',to_review:'Da verificare',aligned:'Allineato alla fonte',excluded:'Fuori ambito'}
const number=(v:number|null)=>v===null?'Non documentato':v.toLocaleString('it-IT')
export default function CoverageRegister(){
 const [data,setData]=useState<Report|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0)
 const [status,setStatus]=useState(''),[language,setLanguage]=useState(''),[provider,setProvider]=useState(''),[query,setQuery]=useState(''),[offset,setOffset]=useState(0)
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')setRefresh(v=>v+1)},60000);return()=>clearInterval(timer)},[])
 useEffect(()=>{
  const controller=new AbortController();setLoading(true)
  const timer=setTimeout(()=>{void(async()=>{try{
   const {data,error}=await supabase.rpc('catalog_coverage_report',{wanted_status:status||null,wanted_language:language||null,wanted_provider:provider||null,query_text:query,page_offset:offset,page_size:25}).abortSignal(controller.signal)
   if(controller.signal.aborted)return;if(error)throw error;setData(data);setError('')
  }catch(e){if(!controller.signal.aborted)setError((e as {message?:string}).message||String(e))}finally{if(!controller.signal.aborted)setLoading(false)}})()},250)
  return()=>{clearTimeout(timer);controller.abort()}
 },[status,language,provider,query,offset,refresh])
 function filter(fn:()=>void){fn();setOffset(0)}
 return <section id="registro" className="bg-white rounded-xl p-4 shadow space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-xl">Registro della copertura</h2><p className="text-sm mt-1">Lingue e regioni, espansioni e distribuzioni note alle fonti.</p></div><button className="border rounded-lg px-3 py-2" onClick={()=>setRefresh(v=>v+1)} disabled={loading}>{loading?'Aggiornamento registro…':'Aggiorna registro'}</button></div>
  <p className="text-sm">“Allineato alla fonte” conferma l’elenco delle carte confrontato con quella fonte: <strong>non certifica tutte le varianti esistenti</strong>. Le vecchie importazioni devono ancora registrare questo confronto. Il registro usa solo metadati leggeri e si aggiorna ogni minuto mentre è visibile.</p>
  {error&&<p role="alert">Registro non disponibile: {error}. <button className="underline" onClick={()=>setRefresh(v=>v+1)}>Riprova</button></p>}
  {data&&<>
   <div className="flex flex-wrap gap-2" aria-label="Stati globali del registro">{Object.entries(states).map(([key,label])=><button key={key} className="border rounded-lg px-3 py-2 text-sm" aria-pressed={status===key} onClick={()=>filter(()=>setStatus(status===key?'':key))}>{label}: <strong>{number(data.stats[key]||0)}</strong></button>)}</div>
   <p className="text-xs">I conteggi indicano voci del registro, non carte uniche. Una lingua, un’espansione in una lingua e una distribuzione promozionale sono voci diverse.</p>
   <details><summary className="cursor-pointer font-semibold">Percorsi linguistici e regionali ({data.languages.length})</summary><div className="grid sm:grid-cols-2 gap-3 mt-3">{data.languages.map(l=><div key={l.source_language} className="border rounded-lg p-3 text-sm"><strong>{l.label}</strong><p>{l.region}</p><p>{l.probe_status==='available'?`Elenco disponibile · ${number(l.listed_sets)} espansioni dichiarate`:l.probe_status==='error'?'Fonte non disponibile all’ultimo controllo':l.probe_status==='empty'?'Elenco vuoto':'Fonte ancora da verificare'}</p><p>{l.last_probe_at?`Ultimo controllo: ${new Date(l.last_probe_at).toLocaleString('it-IT')}`:'Nessun controllo registrato'}</p></div>)}</div></details>
   <div className="flex flex-wrap gap-3"><label>Stato <select className="border rounded p-2" value={status} onChange={e=>filter(()=>setStatus(e.target.value))}><option value="">Tutti</option>{Object.entries(states).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Lingua <select className="border rounded p-2" value={language} onChange={e=>filter(()=>setLanguage(e.target.value))}><option value="">Tutte</option>{data.languages.map(l=><option key={l.source_language} value={l.source_language}>{l.label}</option>)}<option value="und">Da verificare</option></select></label><label>Fonte <select className="border rounded p-2" value={provider} onChange={e=>filter(()=>setProvider(e.target.value))}><option value="">Tutte</option><option value="tcgdex">TCGdex</option><option value="atlas">Card Atlas</option><option value="curated">Distribuzioni documentate</option></select></label><label>Espansione o distribuzione <input className="border rounded p-2" value={query} placeholder="Nome o sigla" onChange={e=>filter(()=>setQuery(e.target.value))}/></label></div>
   <p className="text-sm" role="status">{loading?'Lettura del registro…':`${number(data.total)} voci trovate`} · {new Date(data.generated_at).toLocaleString('it-IT')}</p>
   <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="text-left mb-2">Stato delle fonti e degli elenchi da confrontare</caption><thead><tr>{['Voce','Regione / lingua','Fonte','Stato','Quantità attesa','Identificativi risolti','Ultimo confronto','Dettaglio'].map(h=><th className="text-left p-2" key={h}>{h}</th>)}</tr></thead><tbody>{data.rows.map(r=><tr key={r.target_key} className="border-t"><td className="p-2"><strong>{r.name}</strong><p>{r.release_code} · {r.target_type==='language'?'Percorso linguistico (conteggi in espansioni)':r.target_type==='release'?'Distribuzione':'Espansione (conteggi in carte)'}</p></td><td className="p-2">{r.region}<br/>{r.language_label}</td><td className="p-2">{r.provider}</td><td className="p-2">{states[r.status]||r.status}</td><td className="p-2">{number(r.expected_count)}</td><td className="p-2">{number(r.resolved_count)}</td><td className="p-2">{r.checked_at?new Date(r.checked_at).toLocaleString('it-IT'):'Da registrare'}</td><td className="p-2"><p>{r.reason}</p><p>Varianti: da verificare.</p>{evidenceSource(r.source_url)&&<a className="underline" href={evidenceSource(r.source_url)!.url} target="_blank" rel="noopener noreferrer">Consulta la fonte ↗</a>}</td></tr>)}</tbody></table></div>
   {!data.rows.length&&<p>Nessuna voce corrisponde ai filtri.</p>}
   <div className="flex flex-wrap items-center gap-3"><button className="border rounded px-3 py-2" disabled={offset===0||loading} onClick={()=>setOffset(v=>Math.max(0,v-25))}>Precedente</button><span>Pagina {Math.floor(offset/25)+1} di {Math.max(1,Math.ceil(data.total/25))}</span><button className="border rounded px-3 py-2" disabled={offset+25>=data.total||loading} onClick={()=>setOffset(v=>v+25)}>Successiva</button></div>
  </>}
 </section>
}
