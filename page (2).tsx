'use client'

import { useEffect, useState } from 'react'
import { supabase, Card } from '@/lib/supabase'
import Link from 'next/link'

const PAGE_SIZE = 50

export default function CartePage() {
  const [cards, setCards] = useState<Card[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    lingua: '',
    status: '',
    search: ''
  })

  useEffect(() => {
    loadCards()
  }, [page, filters])

  async function loadCards() {
    setLoading(true)
    let query = supabase
      .from('cards')
      .select('*', { count: 'exact' })
      .order('id', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (filters.lingua) query = query.eq('lingua', filters.lingua)
    if (filters.status) query = query.eq('image_status', filters.status)
    if (filters.search) {
      query = query.or(`nome.ilike.%${filters.search}%,file_name.ilike.%${filters.search}%,codice.ilike.%${filters.search}%`)
    }

    const { data, count, error } = await query
    if (error) {
      console.error(error)
    } else {
      setCards(data || [])
      setTotal(count || 0)
    }
    setLoading(false)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Tutte le carte</h1>
        <p className="text-gray-600">{total.toLocaleString('it-IT')} carte totali</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Lingua</label>
          <select 
            className="border rounded-lg px-3 py-2"
            value={filters.lingua}
            onChange={e => { setFilters(f => ({...f, lingua: e.target.value})); setPage(0) }}
          >
            <option value="">Tutte</option>
            <option value="JP">JP</option>
            <option value="CHN">CHN</option>
            <option value="KOR">KOR</option>
            <option value="CHN-T">CHN-T</option>
            <option value="INT">INT</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Stato foto</label>
          <select 
            className="border rounded-lg px-3 py-2"
            value={filters.status}
            onChange={e => { setFilters(f => ({...f, status: e.target.value})); setPage(0) }}
          >
            <option value="">Tutti</option>
            <option value="missing">Senza foto</option>
            <option value="placeholder">Placeholder</option>
            <option value="found">Trovata</option>
            <option value="manual">Manuale</option>
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">Cerca</label>
          <input
            type="text"
            placeholder="Nome, file o codice..."
            className="border rounded-lg px-3 py-2 w-full"
            value={filters.search}
            onChange={e => { setFilters(f => ({...f, search: e.target.value})); setPage(0) }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium">File</th>
              <th className="text-left px-4 py-3 font-medium">Nome</th>
              <th className="text-left px-4 py-3 font-medium">Set</th>
              <th className="text-left px-4 py-3 font-medium">Lingua</th>
              <th className="text-left px-4 py-3 font-medium">Stato</th>
              <th className="text-left px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-500">Caricamento...</td></tr>
            ) : cards.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-500">Nessuna carta trovata</td></tr>
            ) : (
              cards.map(card => (
                <tr key={card.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{card.file_name}</td>
                  <td className="px-4 py-3 font-medium">{card.nome}</td>
                  <td className="px-4 py-3">{card.sigla}</td>
                  <td className="px-4 py-3">
                    <span className="bg-gray-100 px-2 py-0.5 rounded text-xs">{card.lingua}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={card.image_status} />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/carta/${card.id}`} className="text-red-600 hover:underline text-sm">
                      Modifica
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            className="px-4 py-2 border rounded-lg disabled:opacity-40"
          >
            ← Precedente
          </button>
          <span className="px-4 py-2">
            Pagina {page + 1} di {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
            className="px-4 py-2 border rounded-lg disabled:opacity-40"
          >
            Successiva →
          </button>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    missing: 'bg-red-100 text-red-700',
    placeholder: 'bg-yellow-100 text-yellow-700',
    found: 'bg-green-100 text-green-700',
    manual: 'bg-blue-100 text-blue-700',
  }
  const labels: Record<string, string> = {
    missing: 'Senza foto',
    placeholder: 'Placeholder',
    found: 'Trovata',
    manual: 'Manuale',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] || 'bg-gray-100'}`}>
      {labels[status] || status}
    </span>
  )
}
