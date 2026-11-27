'use client'
// Completeness per set: expected vs present cards, missing numbers, photos and
// metadata. Weekly data, no database reads.
import {useEffect,useMemo,useState} from 'react'
import Link from 'next/link'
type Row={sigla:string,lingua:string,name:string|null,series:string|null,year:string|null,cards:number,expected:number|null,missing:number|null,missing_numbers?:number[],elsewhere?:number,with_photo:number,with_traits:number}
const pct=(a:number,b:number)=>b?Math.round(a/b*100):0
const SORTS:Record<string,[string,(a:Row,b:Row)=>number]>={
 missing:['Carte mancanti',(a,b)=>(b.missing||0)-(a.missing||0)],
 photo:['Foto mancanti',(a,b)=>(b.cards-b.with_photo)-(a.cards-a.with_photo)],
 traits:['Dati mancanti',(a,b)=>(b.cards-b.with_traits)-(a.cards-a.with_traits)],
 year:['Più recenti',(a,b)=>(b.year||'').localeCompare(a.year||'')||a.sigla.localeCompare(b.sigla)]}
export default function Completeness(){
 const [rows,setRows]=useState<Row[]>([]),[at,setAt]=useState(''),[lang,setLang]=useState(''),[only,setOnly]=useState(true),[sort,setSort]=useState('missing'),[q,setQ]=useState(''),[error,setError]=useState('')
 useEffect(()=>{fetch('/api/set-completeness').then(r=>r.json()).then(d=>{setRows(d.sets);setAt(d.generated_at)}).catch(()=>setError('Dati non disponibili.'))},[])
 const langs=useMemo(()=>[...new Set(rows.map(r=>r.lingua))].sort(),[rows])
 const shown=useMemo(()=>rows.filter(r=>(!lang||r.lingua===lang)&&(!q||`${r.sigla} ${r.name||''}`.toLowerCase().includes(q.toLowerCase()))&&(!only||(r.missing||0)>0||r.with_photo<r.cards||r.with_traits<r.cards)).sort(SORTS[sort][1]).slice(0,400),[rows,lang,q,only,sort])
 const totals=useMemo(()=>{const list=rows.filter(r=>!lang||r.lingua===lang);const s=(k:keyof Row)=>list.reduce((a,r)=>a+(Number(r[k])||0),0);return {cards:s('cards'),expected:s('expected'),missing:s('missing'),photo:s('with_photo'),traits:s('with_traits'),sets:list.length,complete:list.filter(r=>r.expected&&!r.missing).length,checked:list.filter(r=>r.expected).length}},[rows,lang])
 return <main className="catalog-page">
  <header className="catalog-hero"><p className="eyebrow">Quanto manca</p><h1>Completezza del catalogo.</h1><p>Per ogni set: carte presenti rispetto al totale ufficiale, foto e dati (rarità, tipo, stadio…). Dati aggiornati ogni settimana{at?` · ultimo calcolo ${new Date(at).toLocaleDateString('it-IT')}`:''}.</p></header>
  {error&&<p role="alert">{error}</p>}
  <section className="catalog-stats" aria-label="Riepilogo">
   <div className="stat-tile"><span>Carte presenti</span><strong>{totals.cards.toLocaleString('it-IT')}</strong><small>in {totals.sets.toLocaleString('it-IT')} set</small></div>
   <div className="stat-tile"><span>Carte mancanti</span><strong>{totals.missing.toLocaleString('it-IT')}</strong><small>{totals.complete.toLocaleString('it-IT')} set completi su {totals.checked.toLocaleString('it-IT')} con totale noto</small></div>
   <div className="stat-tile"><span>Con foto</span><strong>{pct(totals.photo,totals.cards)}%</strong><small>{(totals.cards-totals.photo).toLocaleString('it-IT')} senza foto</small></div>
   <div className="stat-tile"><span>Con dati</span><strong>{pct(totals.traits,totals.cards)}%</strong><small>{(totals.cards-totals.traits).toLocaleString('it-IT')} senza rarità, tipo o stadio</small></div>
  </section>
  <section className="catalog-controls" aria-label="Filtri"><div className="filter-row">
   <label>Cerca<input value={q} onChange={e=>setQ(e.target.value)} placeholder="Nome o sigla del set"/></label>
   <label>Lingua<select value={lang} onChange={e=>setLang(e.target.value)}><option value="">Tutte</option>{langs.map(l=><option key={l}>{l}</option>)}</select></label>
   <label>Ordina per<select value={sort} onChange={e=>setSort(e.target.value)}>{Object.entries(SORTS).map(([k,[label]])=><option key={k} value={k}>{label}</option>)}</select></label>
   <label className="flex items-center gap-2"><input type="checkbox" checked={only} onChange={e=>setOnly(e.target.checked)}/>Solo set da completare</label>
  </div></section>
  <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left"><th>Set</th><th>Lingua</th><th>Anno</th><th>Carte</th><th>Mancanti</th><th>Foto</th><th>Dati</th></tr></thead><tbody>
   {shown.map(r=><tr key={r.sigla} className="border-t border-gray-700/30 align-top">
    <td><Link className="underline" href={`/carte?set=${encodeURIComponent(r.sigla)}`}>{r.name||r.sigla}</Link><br/><small className="text-gray-500">{r.sigla}{r.series?` · ${r.series}`:''}</small></td>
    <td>{r.lingua}</td><td>{r.year||'—'}</td>
    <td>{r.cards.toLocaleString('it-IT')}{r.expected?` / ${r.expected}`:''}</td>
    <td>{r.elsewhere?<small className="text-gray-500 block">{r.elsewhere} sotto un’altra sigla</small>:null}{r.missing==null?<span className="text-gray-500">totale ignoto</span>:r.missing?<span title={r.missing_numbers?.length?'Numeri: '+r.missing_numbers.join(', '):undefined}>{r.missing}{r.missing_numbers?.length?<><br/><small className="text-gray-500">n. {r.missing_numbers.slice(0,12).join(', ')}{r.missing_numbers.length>12?'…':''}</small></>:null}</span>:'✓'}</td>
    <td>{pct(r.with_photo,r.cards)}%<br/><Link className="text-xs underline" href={`/carte?set=${encodeURIComponent(r.sigla)}&foto=missing`}>{r.cards-r.with_photo?`${r.cards-r.with_photo} senza`:''}</Link></td>
    <td>{pct(r.with_traits,r.cards)}%</td></tr>)}
  </tbody></table>{shown.length===400&&<p className="text-xs text-gray-500 mt-2">Mostrati i primi 400 set: usa i filtri per restringere.</p>}</div>
 </main>
}
