import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Bindex Catalogo Foto Pokémon',
  description: 'Gestione catalogo foto carte Pokémon mancanti',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="it">
      <body className="bg-gray-50 text-gray-900 min-h-screen">
        <header className="bg-red-600 text-white shadow-md">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold">🎴 Bindex</span>
              <span className="text-red-100 text-sm">Catalogo Foto Pokémon</span>
            </div>
            <nav className="flex flex-wrap gap-3 text-sm">
              <a href="/" className="hover:underline">Dashboard</a>
              <a href="/carte" className="hover:underline">Tutte le carte</a>
              <a href="/automazione" className="hover:underline">Automazione</a>
              <a href="/mancanti" className="hover:underline">Senza foto</a>
            </nav>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  )
}
