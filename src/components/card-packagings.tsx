'use client'
import {useEffect,useState} from 'react'
import Link from 'next/link'
import {supabase} from '@/lib/supabase'
type Item={status:string;candidate_key:string;catalog_packaging_candidates:{name:string;card_number:string;origin:string;packaging_description:string;review_status:string}|null}
export default function CardPackagings({cardId}:{cardId:number}){
 const [rows,setRows]=useState<Item[]>([]),[error,setError]=useState(false),[loading,setLoading]=useState(true)
 useEffect(()=>{let active=true;setLoading(true)
  supabase.from('catalog_packaging_links').select('status,candidate_key,catalog_packaging_candidates(name,card_number,origin,packaging_description,review_status)').eq('card_id',cardId).neq('status','rejected').order('candidate_key').limit(50).then(({data,error})=>{if(active){setRows((data||[]) as unknown as Item[]);setError(!!error);setLoading(false)}})
  return()=>{active=false}
 },[cardId])
 return <section className="rounded-2xl border border-slate-500/30 p-5 space-y-3"><h2 className="text-xl font-semibold">Confezioni e distribuzioni</h2>
  {loading?<p>Caricamento…</p>:error?<p>Informazioni sulle confezioni temporaneamente non disponibili.</p>:rows.length?<ul className="space-y-3">{rows.map(row=><li key={row.candidate_key}><p className="font-medium">{row.catalog_packaging_candidates?.origin}</p><p className="text-sm">{row.catalog_packaging_candidates?.packaging_description} · {row.status==='confirmed'?'Stampa e confezione verificate':'Corrispondenza candidata: stampa e confezione da verificare'}</p></li>)}</ul>:<p>Nessuna segnalazione collegata. La copertura dell’archivio è ancora parziale.</p>}
  <Link href="/confezioni" className="underline">Consulta l’archivio e le fonti</Link>
 </section>
}
