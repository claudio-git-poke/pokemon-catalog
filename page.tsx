'use client'

import { useEffect, useState } from 'react'
import { supabase, Card } from '@/lib/supabase'
import Link from 'next/link'

const LANGUAGES = [
  { code: 'INT', label: 'INT (EN)' },
  { code: 'JP', label: 'JP' },
  { code: 'CHN', label: 'CHN' },
  { code: 'KOR', label: 'KOR' },
  { code: 'CHN-T', label: 'CHN-T' },
]

export default function MancantiPage() {
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [lingua, setLingua] = useState('INT') // partiamo dalle inglesi
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
      .limit(40)

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
    const max = Math.min(cards.length, 8)

    for (let i = 0; i < max; i++) {
      const card = cards[i]
      setProgress(`Elaborazione ${i + 1}/${max}: ${card.nome}...`)
      try {
        const res = await fetch('/api/search-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId: card.id })
        })
        const data = await res.json()
        if (data.found) found++
        else placeholders++
        console.log(`[batch] ${card.nome}:`, data)
      } catch (e) {
        placeholders++
      }
      await new Promise(r => setTimeout(r, 600))
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
          Partiamo dalle carte <strong>INT (inglesi)</strong> perché sono le più facili da trovare su TCGdex.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm font-medium text-gray-600 mr-2">Lingua:</span>
        {LANGUAGES.map(l => (
          <button
            key={l.code}
            onClick={() => setLingua(l.code)}
            className={`px-3 py-1.5 rounded text-sm font-medium ${
              lingua === l.code ? 'bg-red-600 text-white' : 'bg-gray-200 hover:bg-gray-300'
            }`}
          >
            {l.label}
          </button>
        ))}

        <button
          onClick={processBatch}
          disabled={processing || cards.length === 0}
          className="ml-auto bg-purple-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-purple-700 disabled:opacity-50"
        >
          {processing ? 'Elaborazione...' : '🔍 Cerca batch (max 8)'}
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
              <Link href={`/carta/${card.id}`} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 whitespace-nowrap">
                Gestisci
              </Link>
            </div>
          ))}
          {cards.length === 0 && <p className="text-gray-500">Nessuna carta mancante per questa lingua 🎉</p>}
        </div>
      )}
    </div>
  )
}
