'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type LogEvent = { at: string; message: string }
type Summary = { added?: number; linked?: number; alternatives?: number; found?: number; errors?: number; events?: LogEvent[]; current?: string; updated_at?: string }
type Run = { id: number; started_at: string; finished_at: string | null; status: string; summary: Summary }
type Issue = { source_uid: string; name: string; source_language: string; last_error: string }
const date = (value: string | null) => value ? new Date(value).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) : '—'
export default function AutomationPage() {
  const [runs, setRuns] = useState<Run[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const [error, setError] = useState('')
  const [sets, setSets] = useState(0)
  const [due, setDue] = useState(0)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    async function load() {
      const [r,s,i,q] = await Promise.all([
        supabase.from('catalog_sync_runs').select('*').order('id',{ascending:false}).limit(12),
        supabase.from('catalog_sync_sets').select('*',{count:'exact',head:true}).neq('set_id','__index__'),
        supabase.from('catalog_sync_sets').select('source_uid,name,source_language,last_error').not('last_error','is',null).limit(30),
        supabase.from('cards').select('*',{count:'exact',head:true}).in('image_status',['missing','placeholder']).lte('image_next_attempt_at',new Date().toISOString())
      ])
      if (!active) return
      setError([r.error,s.error,i.error,q.error].filter(Boolean).map(e=>e?.message).join('; '))
      setRuns(r.data || []); setSets(s.count || 0); setIssues(i.data || []); setDue(q.count || 0); setLoading(false)
    }
    load(); const timer = setInterval(load,5000)
    return () => { active = false; clearInterval(timer) }
  },[])
  const last = runs[0]
  const stale = last && Date.now() - Date.parse(last.started_at) > 60 * 60000
  const stuck = last?.status === 'running' && Date.now() - Date.parse(last.started_at) > 20 * 60000
  return <div className="space-y-6">
    <h1 className="text-3xl font-bold text-red-700">Catalogo automatico</h1>
    <p>Importazione delle nuove carte e ricerca periodica delle immagini. Il sito può essere chiuso: lavora il processo programmato sul server. Avvio previsto ogni 5 minuti, una sola esecuzione alla volta. GitHub può ritardare gli avvii. Stato aggiornato ogni 5 secondi.</p>
    {loading && <p>Caricamento stato…</p>}
    {error && <div role="alert" className="p-4 bg-red-50 text-red-800">Automazione non configurata o stato non leggibile: {error}. Segui ATTIVAZIONE.md.</div>}
    {!loading && !error && !last && <p className="p-4 bg-yellow-50">Nessuna esecuzione registrata: automazione non ancora avviata.</p>}
    {(stale || stuck) && <p role="alert" className="p-4 bg-yellow-50">Il processo non risulta aggiornato. Controlla le esecuzioni programmate e gli errori: il catalogo potrebbe essere in ritardo.</p>}
    <div className="grid sm:grid-cols-3 gap-4">
      <div className="bg-white shadow rounded p-4">Espansioni individuate: <strong>{sets}</strong></div>
      <div className="bg-white shadow rounded p-4">Immagini in attesa di un tentativo: <strong>{due}</strong></div>
      <div className="bg-white shadow rounded p-4">Ultimo avvio: <strong>{date(last?.started_at || null)}</strong></div>
    </div>
    <div className="bg-white shadow rounded p-4 space-y-2">
      <h2 className="font-bold text-lg">Copertura delle fonti</h2>
      <p>TCGdex: inglese, italiano, francese, tedesco, spagnolo, portoghese, giapponese, coreano, cinese tradizionale, indonesiano e thailandese. La disponibilità effettiva varia per lingua ed espansione.</p>
      <p>Fonti aggiuntive: immagini dei cataloghi ufficiali giapponese, coreano e di Taiwan, indicizzate tramite Card Atlas; archivio storico PokemonTCG per l’inglese e TCGPlayer quando disponibile. Cinese semplificato: fonte ancora da integrare. Sono escluse le carte del gioco digitale Pokémon TCG Pocket. Le fonti non garantiscono ogni ristampa, variante o promozionale.</p>
      <p>Le immagini assenti vengono riprovate con intervalli crescenti, fino a una volta al mese. Quelle manuali vengono conservate. Le nuove carte sono inserite quando compaiono nelle fonti, anche se la scansione non è ancora disponibile.</p>
    </div>
    <section className="bg-white shadow rounded p-4 space-y-3">
      <h2 className="font-bold text-xl">Registro del lavoro</h2>
      <p aria-live="polite">{last?.summary.current || 'Il registro dettagliato sarà disponibile dalla prossima esecuzione aggiornata.'}</p>
      {last?.summary.updated_at && <p className="text-sm text-gray-600">Ultimo aggiornamento: {date(last.summary.updated_at)}</p>}
      <p className="text-sm">Ultime 2.000 attività per esecuzione, dalla più recente. Il log completo è disponibile su GitHub Actions.</p>
      <div className="max-h-96 overflow-y-auto font-mono text-xs bg-gray-950 text-gray-100 rounded p-3">
        {(last?.summary.events || []).slice().reverse().map((event,index)=><div key={index} className="py-1 border-b border-gray-800"><time>{date(event.at)}</time> · {event.message}</div>)}
      </div>
    </section>
    <h2 className="font-bold text-xl">Ultime esecuzioni</h2>
    <div className="overflow-x-auto bg-white rounded shadow"><table className="w-full text-sm"><thead><tr><th className="p-3 text-left">Avvio</th><th className="p-3 text-left">Stato</th><th className="p-3 text-left">Risultati</th></tr></thead><tbody>{runs.map(run=><tr key={run.id} className="border-t"><td className="p-3">{date(run.started_at)}</td><td className="p-3">{run.status}</td><td className="p-3">{run.summary.added || 0} inserite · {run.summary.linked || 0} collegate · {run.summary.alternatives || 0} fonti alternative · {run.summary.found || 0} immagini trovate · {run.summary.errors || 0} errori</td></tr>)}</tbody></table></div>
    {runs.slice(1).map(run=><details key={run.id} className="bg-white p-4 rounded shadow"><summary>Registro esecuzione del {date(run.started_at)}</summary><div className="max-h-72 overflow-y-auto text-xs font-mono">{(run.summary.events || []).slice().reverse().map((event,index)=><p key={index}>{date(event.at)} · {event.message}</p>)}</div></details>)}
    <h2 className="font-bold text-xl">Fonti incomplete e abbinamenti da verificare</h2>
    {issues.map(issue=><div key={issue.source_uid} className="p-3 bg-yellow-50 rounded"><strong>{issue.name} · {issue.source_language}</strong><p>{issue.last_error}</p></div>)}
    {!issues.length && !loading && !error && <p>Nessun problema registrato nelle fonti controllate.</p>}
  </div>
}
