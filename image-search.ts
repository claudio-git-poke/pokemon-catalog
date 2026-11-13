/**
 * Ricerca immagini – prioritaria TCGdex (API pubblica)
 * Documentazione: https://tcgdex.dev
 */

export type SearchResult = {
  url: string | null
  source: string
  confidence: 'high' | 'medium' | 'low'
  message: string
  logs?: string[]
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

function cleanName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .toLowerCase()
}

/** Mappa le nostre lingue → lingue TCGdex */
function toTcgdexLang(lingua: string): string {
  const map: Record<string, string> = {
    INT: 'en',
    EN: 'en',
    JP: 'ja',
    CHN: 'zh-cn',
    'CHN-T': 'zh-tw',
    KOR: 'ko',
    FR: 'fr',
    DE: 'de',
    ES: 'es',
    IT: 'it',
  }
  return map[lingua] || 'en'
}

/**
 * Cerca su TCGdex
 * Endpoint: https://api.tcgdex.net/v2/{lang}/cards
 */
async function searchTcgdex(card: CardInput): Promise<SearchResult | null> {
  const logs: string[] = []
  const lang = toTcgdexLang(card.lingua)
  const name = cleanName(card.nome)

  logs.push(`TCGdex lang=${lang} name="${name}"`)

  try {
    // 1. Prova ricerca per nome
    const url = `https://api.tcgdex.net/v2/${lang}/cards?name=${encodeURIComponent(card.nome)}`
    logs.push(`Fetch: ${url}`)

    const res = await fetch(url, {
      headers: { 'User-Agent': 'BindexCatalog/1.0' },
      next: { revalidate: 3600 }
    })

    if (!res.ok) {
      logs.push(`TCGdex status ${res.status}`)
      return null
    }

    const data = await res.json()
    logs.push(`Risultati TCGdex: ${Array.isArray(data) ? data.length : 0}`)

    if (!Array.isArray(data) || data.length === 0) {
      // Fallback: prova solo il nome base senza caratteri speciali
      const url2 = `https://api.tcgdex.net/v2/${lang}/cards?name=${encodeURIComponent(name)}`
      const res2 = await fetch(url2)
      if (res2.ok) {
        const data2 = await res2.json()
        if (Array.isArray(data2) && data2.length > 0) {
          const best = data2[0]
          if (best.image) {
            const imageUrl = `${best.image}/high.png`
            return {
              url: imageUrl,
              source: 'tcgdex',
              confidence: 'medium',
              message: `Trovata su TCGdex (${lang}): ${best.name}`,
              logs
            }
          }
        }
      }
      return null
    }

    // Prendi la prima con immagine, preferibilmente matching del numero se possibile
    let best = data.find((c: any) => c.image) || data[0]

    // Se abbiamo un numero, prova a matchare localId
    if (card.numero) {
      const byNumber = data.find((c: any) => 
        String(c.localId) === String(card.numero) || 
        String(c.localId).padStart(3, '0') === String(card.numero).padStart(3, '0')
      )
      if (byNumber?.image) best = byNumber
    }

    if (best?.image) {
      // TCGdex fornisce base URL, aggiungiamo /high.png o /low.png
      const imageUrl = `${best.image}/high.png`
      logs.push(`Immagine: ${imageUrl}`)
      return {
        url: imageUrl,
        source: 'tcgdex',
        confidence: 'high',
        message: `Trovata su TCGdex (${lang}): ${best.name} (${best.id})`,
        logs
      }
    }

    logs.push('Nessuna immagine nel risultato TCGdex')
    return null
  } catch (err: any) {
    logs.push(`TCGdex error: ${err.message}`)
    return null
  }
}

/**
 * Estrae og:image da una pagina (fallback)
 */
async function tryExtractOgImage(pageUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(pageUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BindexBot/1.0)' }
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    const html = await res.text()
    const og = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i)
    return og?.[1] || null
  } catch {
    return null
  }
}

/**
 * Ricerca principale – ordine:
 * 1. TCGdex (migliore per EN / INT)
 * 2. og:image da Cardmarket
 * 3. Fallback placeholder
 */
export async function aggressiveSearch(card: CardInput): Promise<SearchResult> {
  const allLogs: string[] = []

  // 1. TCGdex
  const tcg = await searchTcgdex(card)
  if (tcg?.url) {
    return { ...tcg, logs: [...allLogs, ...(tcg.logs || [])] }
  }
  if (tcg?.logs) allLogs.push(...tcg.logs)

  // 2. Cardmarket og:image
  if (card.link_cardmarket) {
    allLogs.push('Provo Cardmarket og:image...')
    const og = await tryExtractOgImage(card.link_cardmarket)
    if (og) {
      return {
        url: og,
        source: 'cardmarket-og',
        confidence: 'medium',
        message: `Immagine estratta da Cardmarket`,
        logs: allLogs
      }
    }
    allLogs.push('Cardmarket og:image non trovata')
  }

  // Fallback
  return {
    url: null,
    source: 'none',
    confidence: 'low',
    message: `Nessuna immagine trovata per "${card.nome}" (${card.sigla} · ${card.lingua}). Tentativi: TCGdex + Cardmarket.`,
    logs: allLogs
  }
}

export async function searchCardImage(card: CardInput): Promise<SearchResult> {
  return aggressiveSearch(card)
}
