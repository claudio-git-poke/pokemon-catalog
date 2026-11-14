'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase, Card } from '@/lib/supabase'
import Link from 'next/link'
import PrintingTraits from '@/components/printing-traits'

export default function CardDetailPage() {
  const params = useParams()
  const idParam = params?.id
  const id = typeof idParam === 'string' ? Number(idParam) : Array.isArray(idParam) ? Number(idParam[0]) : NaN

  const [card, setCard] = useState<Card | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [searching, setSearching] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [status, setStatus] = useState('missing')
  const [notes, setNotes] = useState('')
  const [message, setMessage] = useState('')
  const [alternatives,setAlternatives] = useState<{url:string;label:string}[]>([])
  const [logs, setLogs] = useState<string[]>([])

  function addLog(msg: string) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`
    console.log(line)
    setLogs(prev => [line, ...prev].slice(0, 30))
  }

  useEffect(() => {
    console.log('[CardDetail] params:', params, 'parsed id:', id)
    if (!id || isNaN(id)) {
      setError('ID non valido')
      setLoading(false)
      return
    }
    loadCard()
  }, [id])

  async function loadCard() {
    setLoading(true)
    setError(null)
    addLog(`Caricamento carta id=${id}...`)
    try {
      const { data, error: err } = await supabase
        .from('cards')
        .select('*')
        .eq('id', id)
        .single()

      if (err) {
        addLog(`Errore Supabase: ${err.message}`)
        setError(err.message)
        setCard(null)
      } else if (!data) {
        addLog('Carta non trovata nel database')
        setError('Carta non trovata')
        setCard(null)
      } else {
        addLog(`Carta caricata: ${data.nome}`)
        setCard(data)
        setImageUrl(data.image_url || '')
        setStatus(data.image_status)
        setNotes(data.notes || '')
      }
    } catch (e: any) {
      addLog(`Exception: ${e.message}`)
      setError(e.message)
    }
    setLoading(false)
  }

  async function save() {
    setSaving(true)
    setMessage('')
    addLog('Salvataggio...')
    const { error: err } = await supabase
      .from('cards')
      .update({
        image_url: imageUrl || null,
        image_status: status as any,
        notes: notes || null,
        image_source: status === 'manual' ? 'manual' : card?.image_source
      })
      .eq('id', id)

    if (err) {
      setMessage('Errore: ' + err.message)
      addLog('Errore salvataggio: ' + err.message)
    } else {
      setMessage('Salvato con successo!')
      addLog('Salvato OK')
      await loadCard()
    }
    setSaving(false)
  }

  async function autoSearch() {
    setSearching(true)
    setMessage('Ricerca in corso...')
    addLog('Avvio ricerca automatica...')
    try {
      const res = await fetch('/api/search-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: id })
      })
      addLog(`API status: ${res.status}`)
      const data = await res.json()
      addLog(`API response: ${JSON.stringify(data).slice(0, 200)}`)

      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`)
      setAlternatives(data.alternatives || [])
      data.logs?.forEach((line: string) => addLog(line))

      if (data.found && data.url) {
        setImageUrl(data.url)
        setStatus('found')
        setMessage(`Trovata! Fonte: ${data.source}`)
        addLog(`Trovata via ${data.source}: ${data.url}`)
      } else {
        setStatus('placeholder')
        setNotes(data.message || 'Nessuna immagine trovata')
        setMessage(data.message || 'Nessuna foto trovata → placeholder')
        addLog('Nessuna foto trovata')
      }
      await loadCard()
    } catch (err: any) {
      setMessage('Errore durante la ricerca: ' + err.message)
      addLog('Exception ricerca: ' + err.message)
    }
    setSearching(false)
  }

  function setPlaceholder() {
    setImageUrl('')
    setStatus('placeholder')
    setNotes(notes || 'Segnata come placeholder - da sostituire manualmente')
    addLog('Impostato placeholder')
  }

  if (loading) {
    return (
      <div className="py-20 text-center">
        <p>Caricamento carta #{id}...</p>
      </div>
    )
  }

  if (error || !card) {
    return (
      <div className="py-20 text-center space-y-4">
        <p className="text-red-600 font-medium">{error || 'Carta non trovata'}</p>
        <p className="text-sm text-gray-500">ID richiesto: {String(idParam)} → parsed: {id}</p>
        <Link href="/carte" className="text-red-600 underline">← Torna all&apos;elenco</Link>
        <div className="mt-6 text-left max-w-lg mx-auto bg-gray-100 p-4 rounded text-xs font-mono">
          {logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link href="/carte" className="text-sm text-red-600 hover:underline">← Torna all&apos;elenco</Link>

      <div className="bg-white rounded-xl shadow p-6 space-y-4">
        <h1 className="text-2xl font-bold">{card.nome}</h1>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-gray-500">File:</span> <span className="font-mono">{card.file_name}</span></div>
          <div><span className="text-gray-500">Codice:</span> {card.codice || '—'}</div>
          <div><span className="text-gray-500">Set:</span> {card.sigla}</div>
          <div><span className="text-gray-500">Lingua:</span> {card.lingua}</div>
          <div><span className="text-gray-500">Numero:</span> {card.numero}</div>
          <div><span className="text-gray-500">Variante:</span> {card.variante}</div>
        </div>
        {card.link_cardmarket && (
          <a href={card.link_cardmarket} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-blue-600 hover:underline">
            Apri su Cardmarket →
          </a>
        )}
      </div>

      <PrintingTraits cardId={card.id}/>
      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="font-semibold mb-3">Anteprima foto</h2>
        {imageUrl ? (
          <img src={imageUrl} alt={card.nome} className="max-w-[300px] border rounded-lg shadow"
            onError={(e) => { addLog('Errore caricamento immagine'); e.currentTarget.style.display = 'none' }} />
        ) : (
          <div className="w-[200px] h-[280px] bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center text-gray-400 text-sm text-center p-4 whitespace-pre-line">
            {status === 'placeholder' ? 'PLACEHOLDER\n(da sostituire)' : 'Nessuna foto'}
          </div>
        )}
      </div>

      {card.notes && <div className="bg-yellow-50 p-4 rounded-xl text-sm"><strong>Stato della ricerca</strong><p className="mt-2">{card.notes}</p>{card.image_next_attempt_at && <p className="mt-2">Prossimo tentativo: {new Date(card.image_next_attempt_at).toLocaleString('it-IT')}</p>}</div>}
      {alternatives.length > 0 && <section className="bg-white rounded-xl shadow p-6 space-y-4"><h2 className="font-semibold">Confronta le varianti</h2><p className="text-sm text-gray-500">Queste sono alternative della stessa carta: confronta bordo e timbri con la variante che vuoi catalogare. La selezione prepara il modulo; premi Salva modifiche per confermare.</p><div className="grid grid-cols-2 gap-4">{alternatives.map(option=><div key={option.url} className="space-y-3"><a href={option.url} target="_blank" rel="noreferrer"><img src={option.url} alt={option.label} className="w-full rounded-lg" loading="lazy"/></a><p className="text-xs">{option.label}</p><button className="border rounded-lg px-3 py-2 text-sm" onClick={()=>{setImageUrl(option.url);setStatus('manual');setNotes(`Variante selezionata manualmente: ${option.label}`);setMessage('Selezione pronta: salva le modifiche per confermare.')}}>Usa questa variante</button></div>)}</div></section>}
      <div className="bg-white rounded-xl shadow p-6 space-y-4">
        <h2 className="font-semibold">Gestione foto</h2>
        <div className="flex flex-wrap gap-3">
          <button onClick={autoSearch} disabled={searching}
            className="bg-purple-600 text-white px-5 py-2.5 rounded-lg hover:bg-purple-700 disabled:opacity-50 font-medium">
            {searching ? 'Ricerca in corso...' : '🔍 Cerca automaticamente'}
          </button>
          <button onClick={setPlaceholder} className="bg-yellow-500 text-white px-5 py-2.5 rounded-lg hover:bg-yellow-600">
            Segna come Placeholder
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">URL della foto</label>
          <input type="url" className="w-full border rounded-lg px-3 py-2" placeholder="Incolla qui l'URL dell'immagine..."
            value={imageUrl} onChange={e => { setImageUrl(e.target.value); if (e.target.value) setStatus('manual') }} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Stato</label>
          <select className="border rounded-lg px-3 py-2" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="missing">Senza foto</option>
            <option value="placeholder">Placeholder</option>
            <option value="found">Trovata (automatica)</option>
            <option value="manual">Inserita manualmente</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Note</label>
          <textarea className="w-full border rounded-lg px-3 py-2" rows={3} value={notes}
            onChange={e => setNotes(e.target.value)} placeholder="Note..." />
        </div>

        <button onClick={save} disabled={saving}
          className="bg-red-600 text-white px-5 py-2.5 rounded-lg hover:bg-red-700 disabled:opacity-50">
          {saving ? 'Salvataggio...' : 'Salva modifiche'}
        </button>

        {message && (
          <p className={`text-sm p-3 rounded-lg ${message.includes('Errore') || message.includes('Nessuna') ? 'bg-yellow-50 text-yellow-800' : 'bg-green-50 text-green-800'}`}>
            {message}
          </p>
        )}
      </div>

      {/* Log verboso per debug (F12) */}
      <div className="bg-gray-900 text-green-400 rounded-xl p-4 text-xs font-mono max-h-60 overflow-y-auto">
        <div className="text-gray-400 mb-2">Console log (ultimi eventi)</div>
        {logs.length === 0 && <div className="text-gray-600">Nessun log ancora</div>}
        {logs.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  )
}
