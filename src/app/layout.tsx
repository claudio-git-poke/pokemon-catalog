import type { Metadata } from 'next'
import './globals.css'
import SiteHeader from '@/components/site-header'

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
    <html lang="it" data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{__html:"try{document.documentElement.dataset.theme=localStorage.getItem('bindex-theme')||'dark'}catch(e){}"}} /></head>
      <body className="min-h-screen">
        <SiteHeader />
        <main className="max-w-7xl mx-auto px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  )
}
