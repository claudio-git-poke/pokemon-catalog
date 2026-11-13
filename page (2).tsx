'use client'

import { useEffect, useState } from 'react'
import { supabase, Card } from '@/lib/supabase'
import Link from 'next/link'

export default function MancantiPage() {
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [lingua, setLingua] = useState('')
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState('')

  useEffect(() => {
    load()
  }, [lingua])

  async function load() {
    setLoading(true)
    let query = supabase
      .from('cards')
      .select('*')
      .in('image_status', ['missing', 'placeholder'])
      .order('id')
      .limit(50)

    if (lingua) query = query.eq('lingua', lingua)

    const { data } = await query
    setCards(data || [])
    setLoading(false)
  }

  async function processBatch() {
    if (cards.length === 0) return
    setProcessing(true)
    let found = 0
    let placeholders = 0

    for (let i = 0; i < Math.min(cards.length, 10); i++) { // max 10 per volta per non saturare
      const card = cards[i]
      setProgress(`Elaborazione ${i + 1}/${Math.min(cards.length, 10)}: ${card.nome}...`)

      try {
        const res = await fetch('/api/search-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId: card.id })
        })
        const data = await res.json()
        if (data.found) found++
        else placeholders++
      } catch (e) {
        placeholders++
      }

      // piccola pausa
      await new Promise(r => setTimeout(r, 800))
    }

    setProgress(`Completato: ${found} trovate, ${placeholders} placeholder`)
    setProcessing(false)
    await load()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-red-700">Carte senza foto / Placeholder</h1>
        <p className="text-gray-600">
          Queste carte hanno bisogno di una foto. Puoi lanciare la ricerca automatica su un batch o gestirle una per una.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button onClick={() => setLingua('')} className={`px-3 py-1.5 rounded text-sm ${!lingua ? 'bg-red-600 text-white' : 'bg-gray-200'}`}>Tutte</button>
        {['JP','CHN','KOR','CHN-T','INT'].map(l => (
          <button key={l} onClick={() => setLingua(l)} className={`px-3 py-1.5 rounded text-sm ${lingua===l ? 'bg-red-600 text-white' : 'bg-gray-200'}`}>{l}</button>
        ))}

        <button
          onClick={processBatch}
          disabled={processing || cards.length === 0}
          className="ml-auto bg-purple-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50"
        >
          {processing ? 'Elaborazione...' : '🔍 Cerca batch (max 10)'}
        </button>
      </div>

      {progress && (
        <div className="bg-purple-50 text-purple-800 px-4 py-2 rounded-lg text-sm">
          {progress}
        </div>
      )}

      {loading ? (
        <p>Caricamento...</p>
      ) : (
        <div className="grid gap-3">
          {cards.map(card => (
            <div key={card.id} className="bg-white rounded-lg shadow p-4 flex justify-between items-center">
              <div>
                <div className="font-medium">{card.nome}</div>
                <div className="text-sm text-gray-500 font-mono">
                  {card.file_name} · {card.sigla} · {card.lingua}
                  {card.image_status === 'placeholder' && (
                    <span className="ml-2 bg-yellow-100 text-yellow-800 text-xs px-2 py-0.5 rounded">placeholder</span>
                  )}
                </div>
                {card.notes && <div className="text-xs text-gray-400 mt-1 max-w-lg truncate">{card.notes}</div>}
              </div>
              <Link href={`/carte/${card.id}`} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 whitespace-nowrap">
                Gestisci
              </Link>
            </div>
          ))}
          {cards.length === 0 && <p className="text-gray-500">Nessuna carta mancante con questi filtri 🎉</p>}
        </div>
      )}
    </div>
  )
}
