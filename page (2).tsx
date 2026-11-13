'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function Dashboard() {
  const router = useRouter()
  const [stats, setStats] = useState({
    total: 0,
    missing: 0,
    found: 0,
    placeholder: 0,
    manual: 0,
    byLingua: {} as Record<string, number>
  })
  const [loading, setLoading] = useState(true)
  const [searchId, setSearchId] = useState('')
  const [searchName, setSearchName] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    loadStats()
  }, [])

  async function loadStats() {
    const { count: total } = await supabase.from('cards').select('*', { count: 'exact', head: true })
    const { count: missing } = await supabase.from('cards').select('*', { count: 'exact', head: true }).eq('image_status', 'missing')
    const { count: found } = await supabase.from('cards').select('*', { count: 'exact', head: true }).eq('image_status', 'found')
    const { count: placeholder } = await supabase.from('cards').select('*', { count: 'exact', head: true }).eq('image_status', 'placeholder')
    const { count: manual } = await supabase.from('cards').select('*', { count: 'exact', head: true }).eq('image_status', 'manual')

    const { data: linguaData } = await supabase.from('cards').select('lingua')
    const byLingua: Record<string, number> = {}
    linguaData?.forEach((row: { lingua: string }) => {
      byLingua[row.lingua] = (byLingua[row.lingua] || 0) + 1
    })

    setStats({
      total: total || 0,
      missing: missing || 0,
      found: found || 0,
      placeholder: placeholder || 0,
      manual: manual || 0,
      byLingua
    })
    setLoading(false)
  }

  function goToId() {
    const id = Number(searchId)
    if (id > 0) {
      console.log('[Home] Navigating to /carte/' + id)
      router.push(`/carta/${id}`)
    }
  }

  async function searchByName() {
    if (!searchName.trim()) return
    setSearching(true)
    console.log('[Home] Searching name:', searchName)
    const { data, error } = await supabase
      .from('cards')
      .select('id, nome, file_name, sigla, lingua, image_status')
      .or(`nome.ilike.%${searchName}%,file_name.ilike.%${searchName}%`)
      .limit(15)

    if (error) {
      console.error('[Home] Search error:', error)
    } else {
      console.log('[Home] Results:', data?.length)
      setSearchResults(data || [])
    }
    setSearching(false)
  }

  if (loading) {
    return <div className="text-center py-20 text-gray-500">Caricamento statistiche...</div>
  }

  const percentFound = stats.total > 0
    ? Math.round(((stats.found + stats.manual) / stats.total) * 100)
    : 0

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-1">Panoramica del catalogo foto carte Pokémon</p>
      </div>

      {/* RICERCA RAPIDA */}
      <div className="bg-white rounded-xl shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold">Ricerca rapida carta</h2>
        
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vai a ID</label>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="es. 1"
                className="border rounded-lg px-3 py-2 w-28"
                value={searchId}
                onChange={e => setSearchId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && goToId()}
              />
              <button onClick={goToId} className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700">
                Apri
              </button>
            </div>
          </div>

          <div className="flex-1 min-w-[220px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Cerca per nome / file</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="es. Arcanine, MFB_001..."
                className="border rounded-lg px-3 py-2 flex-1"
                value={searchName}
                onChange={e => setSearchName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchByName()}
              />
              <button onClick={searchByName} disabled={searching}
                className="bg-gray-800 text-white px-4 py-2 rounded-lg hover:bg-gray-900 disabled:opacity-50">
                {searching ? '...' : 'Cerca'}
              </button>
            </div>
          </div>
        </div>

        {searchResults.length > 0 && (
          <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
            {searchResults.map(r => (
              <button
                key={r.id}
                onClick={() => router.push(`/carta/${r.id}`)}
                className="w-full text-left px-4 py-2 hover:bg-gray-50 flex justify-between items-center text-sm"
              >
                <span>
                  <span className="font-medium">{r.nome}</span>
                  <span className="text-gray-500 ml-2 font-mono text-xs">{r.file_name}</span>
                </span>
                <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{r.lingua} · {r.image_status}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex justify-between items-end mb-2">
          <span className="text-sm font-medium text-gray-700">Completamento foto</span>
          <span className="text-2xl font-bold text-red-600">{percentFound}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4">
          <div className="bg-red-600 h-4 rounded-full transition-all duration-500" style={{ width: `${percentFound}%` }} />
        </div>
        <p className="text-sm text-gray-500 mt-2">
          {stats.found + stats.manual} foto trovate su {stats.total} carte
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard title="Totale carte" value={stats.total} color="bg-gray-100" />
        <StatCard title="Senza foto" value={stats.missing} color="bg-red-50 text-red-700" />
        <StatCard title="Placeholder" value={stats.placeholder} color="bg-yellow-50 text-yellow-700" />
        <StatCard title="Trovate auto" value={stats.found} color="bg-green-50 text-green-700" />
        <StatCard title="Inserite a mano" value={stats.manual} color="bg-blue-50 text-blue-700" />
      </div>

      {/* By language */}
      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Carte per lingua</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Object.entries(stats.byLingua)
            .sort((a, b) => b[1] - a[1])
            .map(([lingua, count]) => (
              <div key={lingua} className="border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold">{count}</div>
                <div className="text-sm text-gray-500">{lingua}</div>
              </div>
            ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <a href="/mancanti" className="bg-red-600 text-white px-5 py-2.5 rounded-lg hover:bg-red-700 transition">
          Vedi carte senza foto →
        </a>
        <a href="/carte" className="bg-gray-800 text-white px-5 py-2.5 rounded-lg hover:bg-gray-900 transition">
          Tutte le carte
        </a>
      </div>
    </div>
  )
}

function StatCard({ title, value, color }: { title: string; value: number; color: string }) {
  return (
    <div className={`rounded-xl p-4 ${color}`}>
      <div className="text-2xl font-bold">{value.toLocaleString('it-IT')}</div>
      <div className="text-sm opacity-80">{title}</div>
    </div>
  )
}
