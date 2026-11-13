'use client'

import { useEffect, useState } from 'react'
import { supabase, Card } from '@/lib/supabase'

export default function Dashboard() {
  const [stats, setStats] = useState({
    total: 0,
    missing: 0,
    found: 0,
    placeholder: 0,
    manual: 0,
    byLingua: {} as Record<string, number>
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadStats() {
      const { count: total } = await supabase
        .from('cards')
        .select('*', { count: 'exact', head: true })

      const { count: missing } = await supabase
        .from('cards')
        .select('*', { count: 'exact', head: true })
        .eq('image_status', 'missing')

      const { count: found } = await supabase
        .from('cards')
        .select('*', { count: 'exact', head: true })
        .eq('image_status', 'found')

      const { count: placeholder } = await supabase
        .from('cards')
        .select('*', { count: 'exact', head: true })
        .eq('image_status', 'placeholder')

      const { count: manual } = await supabase
        .from('cards')
        .select('*', { count: 'exact', head: true })
        .eq('image_status', 'manual')

      // Count by lingua
      const { data: linguaData } = await supabase
        .from('cards')
        .select('lingua')

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
    loadStats()
  }, [])

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

      {/* Progress */}
      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex justify-between items-end mb-2">
          <span className="text-sm font-medium text-gray-700">Completamento foto</span>
          <span className="text-2xl font-bold text-red-600">{percentFound}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4">
          <div 
            className="bg-red-600 h-4 rounded-full transition-all duration-500"
            style={{ width: `${percentFound}%` }}
          />
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

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <a 
          href="/mancanti" 
          className="bg-red-600 text-white px-5 py-2.5 rounded-lg hover:bg-red-700 transition"
        >
          Vedi carte senza foto →
        </a>
        <a 
          href="/carte" 
          className="bg-gray-800 text-white px-5 py-2.5 rounded-lg hover:bg-gray-900 transition"
        >
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
