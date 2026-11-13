/**
 * Ricerca aggressiva di immagini carte Pokémon
 * Strategia a cascata: più fonti possibili, in ordine di affidabilità.
 */

export type SearchResult = {
  url: string | null
  source: string
  confidence: 'high' | 'medium' | 'low'
  message: string
}

type CardInput = {
  id?: number
  nome: string
  sigla: string
  lingua: string
  numero: number
  codice: string | null
  file_name: string
  link_cardmarket: string | null
}

/** Pulisce il nome per usarlo in URL/query */
function cleanName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
}

/** Costruisce query di ricerca multiple */
function buildQueries(card: CardInput): string[] {
  const base = cleanName(card.nome)
  const queries = [
    `${card.nome} ${card.sigla} ${card.lingua} pokemon tcg`,
    `${card.nome} ${card.codice || card.sigla} pokemon card`,
    `${base} ${card.sigla.replace('@', ' ')} pokemon`,
    `${card.nome} ${card.lingua === 'JP' ? 'japanese' : card.lingua === 'CHN' ? 'chinese' : card.lingua === 'KOR' ? 'korean' : ''} pokemon card`,
  ]
  return [...new Set(queries.filter(Boolean))]
}

/**
 * Tenta di ottenere l'immagine Open Graph / Twitter da una pagina
 * (utile per link_cardmarket e altre pagine prodotto)
 */
async function tryExtractOgImage(pageUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)

    const res = await fetch(pageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BindexBot/1.0; +https://bindex.app)',
        'Accept': 'text/html',
      },
    })
    clearTimeout(timeout)

    if (!res.ok) return null
    const html = await res.text()

    // Cerca og:image o twitter:image
    const ogMatch = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i)
    if (ogMatch?.[1]) return ogMatch[1]

    const twMatch = html.match(/name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i)
    if (twMatch?.[1]) return twMatch[1]

    // Cerca anche immagini grandi tipiche di Cardmarket / TCG
    const imgMatch = html.match(/https?:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/gi)
    if (imgMatch) {
      // Preferisci URL che sembrano di carte
      const preferred = imgMatch.find(u =>
        u.includes('card') || u.includes('product') || u.includes('static') || u.includes('cdn')
      )
      if (preferred) return preferred
    }

    return null
  } catch {
    return null
  }
}

/**
 * Prova alcuni pattern di CDN / database pubblici noti
 * (molti set asiatici non sono coperti, ma per alcuni funziona)
 */
async function tryKnownPatterns(card: CardInput): Promise<string | null> {
  const candidates: string[] = []

  // Esempio: alcuni set hanno naming prevedibile su certi mirror
  // (lasciato estendibile)

  // Prova a vedere se esiste un'immagine su servizi pubblici generici
  // Nota: questi sono tentativi "best effort"

  for (const url of candidates) {
    try {
      const head = await fetch(url, { method: 'HEAD' })
      if (head.ok && head.headers.get('content-type')?.startsWith('image/')) {
        return url
      }
    } catch { /* continua */ }
  }
  return null
}

/**
 * Ricerca principale aggressiva
 */
export async function aggressiveSearch(card: CardInput): Promise<SearchResult> {
  const attempts: string[] = []

  // 1. Se c'è il link Cardmarket, prova a estrarre l'immagine dalla pagina
  if (card.link_cardmarket) {
    attempts.push('cardmarket-og')
    const og = await tryExtractOgImage(card.link_cardmarket)
    if (og) {
      return {
        url: og,
        source: 'cardmarket-og',
        confidence: 'medium',
        message: `Immagine estratta da Cardmarket (og:image) per ${card.nome}`
      }
    }
  }

  // 2. Pattern noti / CDN
  attempts.push('known-patterns')
  const known = await tryKnownPatterns(card)
  if (known) {
    return {
      url: known,
      source: 'known-pattern',
      confidence: 'medium',
      message: `Trovata tramite pattern noto`
    }
  }

  // 3. Costruisci query e (per ora) non abbiamo un motore di ricerca libero affidabile
  //    senza API key. Lasciamo traccia chiara.
  const queries = buildQueries(card)
  attempts.push(...queries.map(q => `query:${q.slice(0, 40)}`))

  // Risultato finale: non trovata → placeholder chiaro
  return {
    url: null,
    source: 'aggressive-fallback',
    confidence: 'low',
    message: `Ricerca aggressiva fallita per "${card.nome}" (${card.sigla} · ${card.lingua}). Tentativi: ${attempts.join(', ')}. Inserisci URL manualmente o lascia placeholder.`
  }
}

/** Versione semplice (compatibilità) */
export async function searchCardImage(card: CardInput): Promise<SearchResult> {
  return aggressiveSearch(card)
}
