'use client'
import {useState} from 'react'
import Link from 'next/link'
import {ImageOff} from 'lucide-react'
import type {Observations} from '@/lib/catalog-identification'
import {TAXONOMY} from '@/lib/catalog-taxonomy'
import {explainObservations,evidenceSource,resultPhoto,type IdentificationMatch} from '@/lib/identification-evidence'

const label=(code:string)=>TAXONOMY.find(t=>t.code===code)?.label||code.split(':').slice(1).join(':')
export default function IdentificationResult({match:m,observations}:{match:IdentificationMatch;observations:Observations}){
 const [broken,setBroken]=useState(false),photo=resultPhoto(m,broken)
 const evidence=explainObservations(m.known_facts,observations),source=evidenceSource(m.source_url)
 const href=`/carta/${m.card_id}?stampa=${encodeURIComponent(m.entry_key)}`
 const answered=evidence.matched.length+evidence.different.length+evidence.unknown.length
 return <article className="catalog-card identification-result">
  <Link href={href} className="card-art">{photo.url?<img src={photo.url} alt={`${m.name}${photo.reference?', immagine di riferimento':''}`} loading="lazy" onError={()=>setBroken(true)}/>:<div className="missing-art"><ImageOff size={30}/><strong>{broken?'Immagine non caricabile':'Foto esatta ancora assente'}</strong><span>Puoi confrontare i dati disponibili</span></div>}<span className="photo-badge">{photo.label}</span></Link>
  <div className="card-caption"><div><span className="card-set">{m.set_code} · {m.collector_number||(m.tags.includes('family:my-first-battle')?'Senza numero stampato':'Numero da verificare')}{m.denominator?'/'+m.denominator:''}</span><span className="language-badge">{m.language}</span></div>
   <h2><Link href={href}>{m.name}</Link></h2><p className="variant-label">{m.label}</p>
   {m.deck_code&&<p>Mazzo {m.deck_code}{m.deck_number!=null?` · posizione ${m.deck_number}`:''}</p>}{m.release_year&&<p>Edizione {m.release_year}</p>}
   <div className="flex flex-wrap gap-1 my-2">{m.tags.filter(t=>t.startsWith('family:')||t.startsWith('pattern:')||t==='stamp:staff').map(t=><span className="search-chip" key={t}>{label(t)}</span>)}</div>
   <div className="match-evidence">
    <p className="evidence-origin">{m.verification==='reviewed'?'Revisione registrata':m.verification==='source'?'Dati documentati dalla fonte':'Dati base · varianti da arricchire'}</p>
    {answered>0?<><p className={evidence.different.length?'evidence-different':'evidence-summary'}>{evidence.matched.length} indizi compatibili · {evidence.different.length} diversi · {evidence.unknown.length} da verificare</p><details className="evidence-details"><summary>Perché compare questa carta?</summary>
     {(['matched','different','unknown'] as const).map(group=>evidence[group].length>0&&<div key={group}><h3>{group==='matched'?'Corrisponde ai tuoi indizi':group==='different'?'Differenze da confrontare':'La fonte non lo specifica'}</h3><ul>{evidence[group].map(item=><li key={item.key}>{item.text} <b>Hai risposto {item.answer?'Sì':'No'}.</b>{group==='different'&&<> Il dato disponibile indica {m.known_facts[item.key]?'Sì':'No'}.</>}</li>)}</ul></div>)}
    </details></>:<p>Aggiungi un indizio visivo per confrontarlo con i dati di questa carta.</p>}
    {photo.reference&&<p>Questa foto mostra la carta di riferimento: non conferma la finitura, lo stampino o la firma della variante.</p>}
    {!photo.url&&<p>L’assenza della foto non significa che la carta o la variante non esista.</p>}
    {photo.url&&!photo.reference&&<p>Confronta anche i dettagli stampati: la presenza della foto non certifica l’identificazione.</p>}
    {source&&<a className="underline" href={source.url} target="_blank" rel="noopener noreferrer">Fonte dei dati · {source.host}</a>}
    <Link className="underline font-semibold" href={href}>Confronta questa carta →</Link>
   </div>
  </div>
 </article>
}
