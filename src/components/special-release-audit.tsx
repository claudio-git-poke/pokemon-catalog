'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
type Release={code:string;name:string;canonical_set:string;documented:number|null;unique:number|null;duplicate_copies?:number;source_identified?:number;undocumented_printing?:number;source_unlinked:number|null;indexed:number|null;published:number|null;reference_entries:number;status?:string;publication_pending?:Record<string,number>;issues:{name:string;reason:string;set_id?:string;local_id?:string}[]}
type Report={generated_at:string;published_now:number;releases:Release[]}
const n=(x:number|null|undefined)=>x==null?'Non rilevato':x.toLocaleString('it-IT')
export default function SpecialReleaseAudit(){
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[onlyIssues,setOnlyIssues]=useState(false)
 useEffect(()=>{const controller=new AbortController();async function read(){try{const {data,error}=await supabase.from('catalog_special_release_audit').select('report').eq('id','latest').abortSignal(controller.signal).maybeSingle();if(error)throw error;if(!controller.signal.aborted){setReport(data?.report||null);setError('')}}catch(e){if(!controller.signal.aborted)setError((e as {message?:string}).message||String(e))}}void read();const timer=setInterval(()=>{if(document.visibilityState==='visible')void read()},60000);return()=>{controller.abort();clearInterval(timer)}},[])
 const rows=report?.releases.filter(r=>!onlyIssues||r.documented==null||!!r.source_unlinked||!!r.undocumented_printing||Object.keys(r.publication_pending||{}).length)||[]
 return <section id="uscite-speciali" className="bg-white p-4 rounded-xl shadow space-y-3">
  <h2 className="text-2xl font-bold">BOO, buste premio, Mondiali, Battle Academy e Prima Lotta</h2>
  <p className="text-sm">Controllo degli elenchi inglesi documentati. Le altre lingue non vengono dedotte. Carte indicizzate e identità canoniche pubblicate sono due passaggi distinti.</p>
  {error&&<p role="alert">Controllo non disponibile: {error}</p>}
  {!report&&!error&&<p>Prima verifica in preparazione.</p>}
  {report&&<><p className="text-sm">Rilevazione: {new Date(report.generated_at).toLocaleString('it-IT')} · Nuovi collegamenti pubblicati in questo ciclo: {n(report.published_now)}</p>
   <label className="flex gap-2 text-sm"><input type="checkbox" checked={onlyIssues} onChange={e=>setOnlyIssues(e.target.checked)}/>Mostra solo casi ancora da verificare</label>
   <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Uscita','Voci documentate','Copie ripetute','Stampa da identificare','Identità fonte non collegate','Stampe indicizzate','Collegamenti canonici'].map(h=><th className="p-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr className="border-t" key={r.code}><th className="p-2 text-left">{r.name}<span className="block text-xs font-normal">{r.canonical_set}</span></th>{[r.documented,r.duplicate_copies,r.undocumented_printing,r.source_unlinked,r.indexed,r.published].map((v,i)=><td className="p-2" key={i}>{n(v)}</td>)}</tr>)}</tbody></table></div>
   <p className="text-xs">Le copie ripetute di un mazzo non sono stampe diverse. Le energie senza identità documentata non vengono collegate per somiglianza del nome. “Non rilevato” indica un elenco mancante, non zero carte mancanti. I contatori non sono un totale di carte fisiche uniche.</p>
   <details><summary className="cursor-pointer">Motivi dei casi sospesi</summary><div className="space-y-3 mt-3">{rows.filter(r=>r.documented==null||r.issues.length||Object.keys(r.publication_pending||{}).length).map(r=><div className="text-sm" key={r.code}><strong>{r.name}</strong>{r.documented==null?<p>Elenco delle stampe da documentare; {n(r.reference_entries)} righe canoniche già presenti.</p>:<><p>{Object.entries(r.publication_pending||{}).map(([reason,count])=>`${reason}: ${count}`).join(' · ')}</p>{r.issues.map((x,i)=><p key={i}>{x.name} · {x.set_id}/{x.local_id} · {x.reason}</p>)}</>}</div>)}</div></details>
  </>}
 </section>
}
