'use client'

import { useEffect, useState } from 'react'
import { supabase, Card } from '@/lib/supabase'
import Link from 'next/link'

export default function MancantiPage() {
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [lingua, setLingua] = useState('')

  useEffect(() => {
    load()
  }, [lingua])

  async function load() {
    setLoading(true)
    let query = supabase
      .from('cards')
      .select('*')
      .eq('image_status', 'missing')
      .order('id')
      .limit(100)

    if (lingua) query = query.eq('lingua', lingua)

    const { data } = await query
    setCards(data || [])
    setLoading(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-red-700">Carte senza foto</h1>
        <p className="text-gray-600">Queste carte hanno bisogno di una foto. Puoi inserire l&apos;URL manualmente o segnarle come placeholder.</p>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setLingua('')} className={`px-3 py-1 rounded ${!lingua ? 'bg-red-600 text-white' : 'bg-gray-200'}`}>Tutte</button>
        {['JP','CHN','KOR','CHN-T','INT'].map(l => (
          <button key={l} onClick={() => setLingua(l)} className={`px-3 py-1 rounded ${lingua===l ? 'bg-red-600 text-white' : 'bg-gray-200'}`}>{l}</button>
        ))}
      </div>

      {loading ? (
        <p>Caricamento...</p>
      ) : (
        <div className="grid gap-3">
          {cards.map(card => (
            <div key={card.id} className="bg-white rounded-lg shadow p-4 flex justify-between items-center">
              <div>
                <div className="font-medium">{card.nome}</div>
                <div className="text-sm text-gray-500 font-mono">{card.file_name} · {card.sigla} · {card.lingua}</div>
              </div>
              <Link href={`/carte/${card.id}`} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700">
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
