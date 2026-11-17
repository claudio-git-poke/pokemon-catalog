'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
import {supabase} from '@/lib/supabase'

type CardLink={card_id:number;status:string;entry_key:string|null;cards:{id:number;nome:string;sigla:string;lingua:string}|null}
type Candidate={candidate_key:string;name:string;card_number:string;group_name:string;language:string;raw_language:string;packaging_types:string[];packaging_description:string;origin:string;claimed_evidence_level:string;review_status:string;review_note:string|null;review_source_url:string|null;wrapper_front_url:string|null;wrapper_back_url:string|null;source_refs:{source_id:string;title:string;url:string}[];catalog_packaging_links:CardLink[]}
const kinds:Record<string,string>={S1:'Carta singola in involucro',S2:'Più carte nello stesso involucro',S3:'Mini-pack promozionale',S4:'Promo in mazzo prerelease'}
const statuses:Record<string,string>={pending:'Da verificare',confirmed:'Confezione verificata',rejected:'Segnalazione respinta'}
const field='w-full rounded-xl border border-slate-500/30 bg-transparent p-3'
const safeUrl=(url:string|null)=>url?.startsWith('https://')?url:null
export default function PackagingPage(){
 const [rows,setRows]=useState<Candidate[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(0)
 const [q,setQ]=useState(''),[query,setQuery]=useState(''),[language,setLanguage]=useState(''),[kind,setKind]=useState(''),[level,setLevel]=useState(''),[status,setStatus]=useState('')
 const [loading,setLoading]=useState(true),[error,setError]=useState('')
 useEffect(()=>{let active=true;setLoading(true);setError('')
  async function load(){
   let request=supabase.from('catalog_packaging_candidates').select('candidate_key,name,card_number,group_name,language,raw_language,packaging_types,packaging_description,origin,claimed_evidence_level,review_status,review_note,review_source_url,wrapper_front_url,wrapper_back_url,source_refs,catalog_packaging_links(card_id,status,entry_key,cards(id,nome,sigla,lingua))',{count:'exact'})
   if(query.trim())request=request.textSearch('search_vector',query.trim(),{type:'plain',config:'simple'})
   if(language)request=request.eq('language',language)
   if(kind)request=request.contains('packaging_types',[kind])
   if(level)request=request.eq('claimed_evidence_level',level)
   if(status)request=request.eq('review_status',status)
   const {data,count,error}=await request.order('candidate_key').range(page*24,page*24+23)
   if(!active)return
   if(error){setError('Archivio non disponibile: '+error.message);setRows([]);setTotal(0)}
   else{setRows((data||[]) as unknown as Candidate[]);setTotal(count||0)}
   setLoading(false)
  }
  load().catch(()=>{if(active){setError('Connessione non disponibile. Riprova tra poco.');setLoading(false)}})
  return()=>{active=false}
 },[query,language,kind,level,status,page])
 return <section className="space-y-6">
  <div><p className="text-sm opacity-70">Archivio delle distribuzioni</p><h1 className="text-3xl font-bold">Confezioni e carte sealed</h1><p className="mt-3 max-w-3xl">Segnalazioni di carte distribuite in involucro, mini-pack e mazzi prerelease. Il livello A/B/C è dichiarato dal documento originale; la verifica della singola voce è indicata separatamente.</p></div>
  <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm space-y-2"><p>Il collegamento a una carta candidata identifica una possibile corrispondenza di serie, numero e lingua. Stampa e confezionamento richiedono una verifica.</p><p>I mini-pack possono avere contenuto casuale; le promo dei mazzi prerelease sono catalogate come contenuto del mazzo. Le diverse distribuzioni della stessa carta restano voci distinte.</p></div>
  <form onSubmit={e=>{e.preventDefault();setPage(0);setQuery(q)}} className="flex gap-2"><input aria-label="Cerca confezioni" className={field} value={q} onChange={e=>setQ(e.target.value)} placeholder="Nome, codice carta, prodotto o distribuzione"/><button className="rounded-xl bg-indigo-600 px-5 text-white" type="submit">Cerca</button></form>
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
   <label className="text-sm">Lingua della carta<select className={field} value={language} onChange={e=>{setLanguage(e.target.value);setPage(0)}}><option value="">Tutte</option>{['INT','IT','FR','DE','ES','PT','JP','KOR','CHN','CHN-T','ID','TH'].map(l=><option key={l} value={l}>{l==='INT'?'EN / INT':l}</option>)}<option value="und">Da accertare</option></select></label>
   <label className="text-sm">Confezione dichiarata<select className={field} value={kind} onChange={e=>{setKind(e.target.value);setPage(0)}}><option value="">Tutte</option>{Object.entries(kinds).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   <label className="text-sm">Prove dichiarate nel file<select className={field} value={level} onChange={e=>{setLevel(e.target.value);setPage(0)}}><option value="">Tutti i livelli</option><option value="A">A · esplicite secondo il documento</option><option value="B">B · parziali o di famiglia</option><option value="C">C · confezionamento da provare</option></select></label>
   <label className="text-sm">Verifica della voce<select className={field} value={status} onChange={e=>{setStatus(e.target.value);setPage(0)}}><option value="">Tutti gli stati</option>{Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
  </div>
  <div aria-live="polite">{loading?'Caricamento…':`${total} voci · pagina ${page+1} di ${Math.max(1,Math.ceil(total/24))}`}</div>
  {error&&<p role="alert" className="rounded-xl border border-red-500/40 p-4">{error}</p>}
  {!loading&&!error&&rows.length===0&&<p>Nessuna voce corrisponde ai filtri scelti.</p>}
  <div className="grid gap-4 md:grid-cols-2">{rows.map(row=>{
   const links=row.catalog_packaging_links.filter(l=>l.status!=='rejected')
   return <article key={row.candidate_key} className="rounded-2xl border border-slate-500/30 p-5 space-y-3">
    <div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-slate-500/15 px-3 py-1">{row.raw_language}</span><span className="rounded-full bg-slate-500/15 px-3 py-1">Prove dichiarate: {row.claimed_evidence_level}</span><span className="rounded-full bg-amber-500/15 px-3 py-1">{statuses[row.review_status]}</span></div>
    <h2 className="text-xl font-semibold">{row.name} <span className="text-base font-normal opacity-70">{row.card_number}</span></h2>
    <p className="text-sm">{row.group_name} · {row.origin}</p><p className="text-sm">{row.packaging_types.map(t=>kinds[t]).join(' / ')} <span className="opacity-70">({row.packaging_description})</span></p>
    {row.language==='und'&&<p className="text-sm">Lingua della carta da accertare: la dicitura originale è conservata.</p>}
    {row.packaging_types.includes('S3')&&<p className="text-sm opacity-75">L’elenco delle carte ottenibili non garantisce il contenuto di una singola bustina chiusa.</p>}
    {row.review_note&&<p className="text-sm">{row.review_note}</p>}
    <div className="text-sm"><p className="font-medium">{links.length?'Collegamenti alle carte':'Carta da individuare nel catalogo'}</p><ul className="space-y-1 mt-1">{links.map(link=><li key={link.card_id}><Link className="underline underline-offset-2" href={'/carta/'+link.card_id}>{link.cards?.nome||'Carta '+link.card_id} · {link.cards?.sigla} · {link.status==='confirmed'?'stampa verificata':'carta candidata'}</Link></li>)}</ul></div>
    <details className="text-sm"><summary className="cursor-pointer">Fonti e documentazione ({row.source_refs.length})</summary><ul className="mt-2 space-y-2">{row.source_refs.map(source=><li key={source.source_id}>{safeUrl(source.url)?<a className="underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.source_id} · {source.title}</a>:source.title}</li>)}</ul>
     {safeUrl(row.review_source_url)&&<p className="mt-2"><a className="underline" href={row.review_source_url!} target="_blank" rel="noopener noreferrer">Prova della revisione</a></p>}
     {(['wrapper_front_url','wrapper_back_url'] as const).map((key,i)=>safeUrl(row[key])&&<p key={key} className="mt-2"><a className="underline" href={row[key]!} target="_blank" rel="noopener noreferrer">Involucro · {i===0?'fronte':'retro'}</a></p>)}
    </details>
   </article>
  })}</div>
  <div className="flex justify-between gap-4"><button className="rounded-xl border border-slate-500/30 px-5 py-2 disabled:opacity-40" disabled={loading||page===0} onClick={()=>setPage(p=>p-1)}>Precedente</button><button className="rounded-xl border border-slate-500/30 px-5 py-2 disabled:opacity-40" disabled={loading||(page+1)*24>=total} onClick={()=>setPage(p=>p+1)}>Successiva</button></div>
 </section>
}
