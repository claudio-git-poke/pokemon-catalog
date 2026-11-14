'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
type Event={id:number;at:string;message:string}
const format=(at:string)=>new Date(at).toLocaleTimeString('it-IT',{timeZone:'Europe/Rome',hour12:false})
export default function AutomationLog({runId,onPause}:{runId:number;onPause?:()=>void}){
 const [events,setEvents]=useState<Event[]>([]),[error,setError]=useState(''),[live,setLive]=useState(true),[search,setSearch]=useState(''),[loading,setLoading]=useState(true),[older,setOlder]=useState(true),[reset,setReset]=useState(0)
 const cursor=useRef(0),oldest=useRef(0)
 useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>;cursor.current=0;oldest.current=0;setEvents([]);setLoading(true);setOlder(true)
 async function load(){
  if(!active)return
  let q=supabase.from('catalog_sync_events').select('id,at,message').eq('run_id',runId)
  if(search.trim())q=q.ilike('message',`%${search.trim().replace(/[%_]/g,'')}%`)
  const initial=!cursor.current
  if(initial)q=q.order('id',{ascending:false}).limit(200)
  else q=q.gt('id',cursor.current).order('id').limit(500)
  const result=await q
  if(!active)return
  setError(result.error?.message||'');setLoading(false)
  if(result.data?.length){const rows=result.data as Event[];if(initial){cursor.current=rows[0].id;oldest.current=rows[rows.length-1].id;setOlder(rows.length===200);setEvents(rows)}else{cursor.current=rows[rows.length-1].id;setEvents(previous=>{const next=[...rows.slice().reverse(),...previous].slice(0,600);oldest.current=next[next.length-1].id;return next});setOlder(true)}}
  if(active&&live)timer=setTimeout(load,document.hidden?10000:1000)
 }
 timer=setTimeout(load,search?300:0)
 return()=>{active=false;clearTimeout(timer)}
 },[runId,live,search,reset])
 async function previous(){
  // A separate history page stays still while the worker continues in the background.
  const before=oldest.current;if(!before)return
  setLoading(true)
  let q=supabase.from('catalog_sync_events').select('id,at,message').eq('run_id',runId).lt('id',before).order('id',{ascending:false}).limit(200)
  if(search.trim())q=q.ilike('message',`%${search.trim().replace(/[%_]/g,'')}%`)
  const result=await q
  if(result.error)setError(result.error.message)
  else if(result.data?.length){setEvents(result.data);oldest.current=result.data[result.data.length-1].id;setOlder(result.data.length===200)}else setOlder(false)
  setLoading(false)
 }
 // History uses its own component instance so turning off live polling never resets the page being read.
 return <div className="space-y-3"><div className="flex flex-wrap gap-3 items-center"><span className="text-sm">{live?'● In diretta · nuove righe ogni secondo':'Lettura in pausa'}</span><button className="border rounded-lg px-3 py-2 text-sm" onClick={()=>{if(live)onPause?.();setLive(v=>!v)}}>{live?'Pausa lettura':'Riprendi diretta'}</button><input aria-label="Filtra il registro" className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-0" placeholder="Cerca carta, #ID, set o errore…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
 {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
 <div className="h-96 overflow-auto font-mono text-xs bg-gray-950 text-gray-100 rounded p-3" aria-label="Registro attività">{events.map(event=><div key={event.id} className="py-1 border-b border-gray-800 break-words"><time className="text-gray-400">{format(event.at)}</time> · {event.message}</div>)}{!events.length&&<p>{loading?'Caricamento eventi…':search?'Nessuna attività corrispondente.':'Nessun evento per questa esecuzione.'}</p>}</div>
 <p className="text-xs text-gray-500">{events.length} righe visualizzate, dalle più recenti. Tutti gli eventi registrati sono consultabili a pagine; il processo continua anche mentre leggi lo storico.</p>
 <div className="flex gap-3"><button className="border rounded-lg px-3 py-2 text-sm" onClick={()=>setReset(r=>r+1)}>Ultime attività</button><button className="border rounded-lg px-3 py-2 text-sm" disabled={loading||!older||!events.length||live} onClick={previous}>200 attività precedenti</button>{live&&<span className="text-xs text-gray-500 self-center">Metti in pausa per sfogliare lo storico.</span>}</div></div>
}
