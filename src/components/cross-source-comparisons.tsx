'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {evidenceSource} from '@/lib/identification-evidence'
type Item={number:string;name?:string;primary?:string;secondary?:string;count?:number;kind?:string;catalog_id?:number}
type CatalogLinks={status:string;checked_at?:string|null;checked?:number;linked_count?:number;not_linked_count?:number;uncheckable_count?:number;linked?:Item[];not_linked?:Item[];error?:string}
type Result={spacing_difference_count?:number;other_name_difference_count?:number;catalog_links?:CatalogLinks;primary_count?:number;secondary_count?:number;only_primary_count?:number;only_secondary_count?:number;name_difference_count?:number;only_primary?:Item[];only_secondary?:Item[];name_differences?:Item[];duplicate_primary?:Item[];duplicate_secondary?:Item[];unnumbered_primary?:number;unnumbered_secondary?:number;reason?:string}
type Pair={pair_key:string;name:string;primary_set:string;language_label:string;status:string;checked_at:string|null;last_success_at:string|null;last_error:string|null;primary_url:string;secondary_url:string;result:Result}
type Report={stats:Record<string,number>;total:number;rows:Pair[]}
const states:Record<string,string>={pending:'In attesa',concordant:'Elenchi concordanti',differences:'Differenze',uncomparable:'Ambiguità',error:'Fonte non disponibile'}
export default function CrossSourceComparisons(){
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[status,setStatus]=useState(''),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(true)
 useEffect(()=>{const t=setInterval(()=>{if(document.visibilityState==='visible')setRefresh(v=>v+1)},60000);return()=>clearInterval(t)},[])
 useEffect(()=>{const controller=new AbortController();setLoading(true);void(async()=>{try{const {data,error}=await supabase.rpc('catalog_cross_source_report',{wanted_status:status||null,page_offset:offset}).abortSignal(controller.signal);if(controller.signal.aborted)return;if(error)throw error;setReport(data);setError('')}catch(e){if(!controller.signal.aborted)setError((e as {message?:string}).message||String(e))}finally{if(!controller.signal.aborted)setLoading(false)}})();return()=>controller.abort()},[status,offset,refresh])
 return <section id="confronti" className="bg-white rounded-xl p-4 shadow space-y-4">
  <div className="flex flex-wrap justify-between gap-3"><h2 className="font-bold text-xl">Confronto fra fonti</h2><button className="border rounded px-3 py-2" disabled={loading} onClick={()=>setRefresh(v=>v+1)}>{loading?'Lettura confronti…':'Aggiorna confronti'}</button></div>
  <p className="text-sm">Confrontiamo TCGdex e Card Atlas nella stessa lingua e con lo stesso codice di espansione. È un abbinamento da controllare: l’indipendenza dei dati originali e tutte le varianti <strong>non sono certificate</strong>. Una carta presente solo in una fonte non è necessariamente assente dal nostro database.</p>
  {error&&<p role="alert">Confronti non disponibili: {error}</p>}
  {report&&<>
   <div className="flex flex-wrap gap-2">{Object.entries(states).map(([key,label])=><button key={key} className="border rounded px-3 py-2 text-sm" aria-pressed={status===key} onClick={()=>{setStatus(status===key?'':key);setOffset(0)}}>{label}: {report.stats[key]||0}</button>)}</div>
   <label className="block text-sm">Esito <select className="border rounded p-2" value={status} onChange={e=>{setStatus(e.target.value);setOffset(0)}}><option value="">Tutti</option>{Object.entries(states).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <p role="status" className="text-sm">{loading?'Lettura in corso…':`${report.total.toLocaleString('it-IT')} coppie di fonti`}</p>
   <div className="space-y-3">{report.rows.map(r=><article key={r.pair_key} className="border rounded-lg p-3 space-y-2">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{r.name} · {r.primary_set} · {r.language_label}</h3><strong className="text-sm">{states[r.status]}</strong></div>
    <p className="text-sm">{r.checked_at?`Controllato il ${new Date(r.checked_at).toLocaleString('it-IT')}`:'Confronto ancora da eseguire'}{r.status==='error'&&r.last_success_at?` · Dati del precedente confronto: ${new Date(r.last_success_at).toLocaleString('it-IT')}`:''}</p>
    <p className="text-sm">{r.last_error||r.result.reason||'Il worker confronterà i numeri stampati e i nomi a piccoli lotti.'}</p>
    {r.result.primary_count!=null&&<p>TCGdex: <strong>{r.result.primary_count}</strong> voci · Card Atlas: <strong>{r.result.secondary_count}</strong> voci · Nomi discordanti: {r.result.name_difference_count||0}</p>}
    {r.result.catalog_links&&<div className="border rounded p-3 text-sm space-y-1">
     <strong>Voci presenti solo in TCGdex: controllo nel nostro catalogo</strong>
     {r.result.catalog_links.status==='checked'?<>
      <p>{r.result.catalog_links.linked_count} già collegate · {r.result.catalog_links.not_linked_count} senza collegamento di fonte · {r.result.catalog_links.uncheckable_count} non determinabili.</p>
      <p>Controllo dei soli identificativi TCGdex, rilevato il {new Date(r.result.catalog_links.checked_at!).toLocaleString('it-IT')}. Un collegamento assente non prova che la carta manchi: potrebbe essere presente con un’altra identità.</p>
     </>:<p>Controllo non disponibile: {r.result.catalog_links.error}. Nessuna assenza dedotta.</p>}
    </div>}
    <div className="flex flex-wrap gap-4 text-sm">{[['TCGdex',r.primary_url],['Card Atlas',r.secondary_url]].map(([label,url])=>evidenceSource(url)&&<a key={label} className="underline" href={evidenceSource(url)!.url} target="_blank" rel="noopener noreferrer">Consulta {label} ↗</a>)}</div>
    {r.status!=='pending'&&r.result.primary_count!=null&&<details><summary className="cursor-pointer font-semibold">Differenze e ambiguità da controllare</summary><div className="mt-3 space-y-3 text-sm">
     <div><strong>Presenti solo in TCGdex: {r.result.only_primary_count||0}</strong><ul>{r.result.only_primary?.map(c=><li key={c.number}>{c.number} · {c.name}</li>)}</ul></div>
     <div><strong>Presenti solo in Card Atlas: {r.result.only_secondary_count||0}</strong><ul>{r.result.only_secondary?.map(c=><li key={c.number}>{c.number} · {c.name}</li>)}</ul></div>
     <div><strong>Nomi discordanti</strong>{r.result.spacing_difference_count!=null&&<p>{r.result.spacing_difference_count} differiscono solo per spazi · {r.result.other_name_difference_count} altre differenze. Anche le differenze di spaziatura restano da verificare e non cambiano l’identità della carta.</p>}<ul>{r.result.name_differences?.map(c=><li key={c.number}>{c.number} · {c.primary} / {c.secondary}{c.kind==='spacing_only'?' · Solo spazi':''}</li>)}</ul></div>
     {r.result.catalog_links?.status==='checked'&&<div><strong>Collegamenti già presenti</strong><ul>{r.result.catalog_links.linked?.map(c=><li key={c.number}><a className="underline" href={`/carte/${c.catalog_id}`}>{c.number} · {c.name} ↗</a></li>)}</ul><strong>Collegamento di fonte da controllare</strong><ul>{r.result.catalog_links.not_linked?.map(c=><li key={c.number}>{c.number} · {c.name}</li>)}</ul></div>}
     <p>Voci senza numero confrontabile: TCGdex {r.result.unnumbered_primary||0}, Card Atlas {r.result.unnumbered_secondary||0}.</p>
     {!!(r.result.duplicate_primary?.length||r.result.duplicate_secondary?.length)&&<p>Numeri ripetuti: {[...(r.result.duplicate_primary||[]).map(c=>`TCGdex ${c.number} (${c.count})`),...(r.result.duplicate_secondary||[]).map(c=>`Atlas ${c.number} (${c.count})`)].join(' · ')}. Possono indicare varianti: non vengono accorpate automaticamente.</p>}
     <p>Mostrati al massimo 20 esempi per categoria. Nessuna chiave Bindex o foto viene modificata dal confronto.</p>
    </div></details>}
   </article>)}</div>
   {!report.rows.length&&<p>Nessuna coppia con questo esito.</p>}
   <div className="flex gap-3 items-center"><button className="border rounded px-3 py-2" disabled={!offset||loading} onClick={()=>setOffset(v=>Math.max(0,v-20))}>Precedente</button><span>Pagina {Math.floor(offset/20)+1} di {Math.max(1,Math.ceil(report.total/20))}</span><button className="border rounded px-3 py-2" disabled={offset+20>=report.total||loading} onClick={()=>setOffset(v=>v+20)}>Successiva</button></div>
  </>}
 </section>
}
