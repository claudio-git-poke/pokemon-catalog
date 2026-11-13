/** Exact-set resolver. Never substitute a same-name card from another set/language. */
export type SearchResult = {
  url: string | null; source: string; confidence: 'high' | 'medium' | 'low'
  message: string; logs: string[]
}
export type ImageCandidate = { url: string; source: string; page?: string | null }
export type CardInput = {
  source_uid?: string | null; source_local_id?: string | null;
  source_card_id?: string | null; source_language?: string | null; id?: number; nome: string; sigla: string; lingua: string; numero: number
  codice: string | null; file_name: string; link_cardmarket: string | null; variante?: string
}
type Brief = { id: string; localId: string; name: string; image?: string }
type SetBrief = { id: string; name: string }
type Detail = Brief & { variants_detailed?: { type?: string; thirdParty?: { tcgplayer?: number } }[] }
const languages: Record<string, string> = { KOR:'ko', PT: 'pt', ID: 'id', TH: 'th', INT: 'en', EN: 'en', JP: 'ja', 'CHN-T': 'zh-tw', IT: 'it', FR: 'fr', DE: 'de', ES: 'es' }
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const local = (s: string | number) => String(s).split('/')[0].trim().replace(/^0+(?=\d)/, '').toLowerCase()
const translations: Record<string, string> = {
  'Energia base Fuoco': 'Fire Energy', 'Energia base Erba': 'Grass Energy',
  'Energia base Lampo': 'Lightning Energy', 'Energia base Acqua': 'Water Energy',
  Pozione: 'Potion', Scambio: 'Switch'
}
function timeout(ms: number, deadline = Infinity) {
  const remaining=deadline-Date.now()
  if(remaining<=0) throw new Error('Tempo disponibile per le fonti esaurito')
  return AbortSignal.timeout(Math.max(1,Math.min(ms,remaining)))
}
async function json<T>(path: string, logs: string[], deadline = Infinity): Promise<T | null> {
  const url = `https://api.tcgdex.net/v2/${path}`
  try {
    const response = await fetch(url, { signal: timeout(6000,deadline), next: { revalidate: 3600 } })
    logs.push(`${url}: HTTP ${response.status}`)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`TCGdex HTTP ${response.status}`)
    return await response.json() as T
  } catch (error) {
    logs.push(String(error)); throw error
  }
}
async function validImage(url: string, logs: string[], deadline = Infinity): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: timeout(8000,deadline) })
    if (r.status !== 404 && !r.ok) throw new Error(`Image HTTP ${r.status}`)
    const valid = r.ok && !!r.headers.get('content-type')?.startsWith('image/')
    await r.body?.cancel()
    logs.push(`Image HTTP ${r.status}: ${url}`)
    return valid
  } catch (error) { logs.push(`Image: ${String(error)}`); throw error }
}
async function searchTcgdex(card: CardInput, deadline = Infinity): Promise<SearchResult> {
  const logs: string[] = []
  const miss = (message: string): SearchResult => ({ url: null, source: 'none', confidence: 'low', message, logs })
  const lang = languages[card.lingua]
  if (!lang) return miss(`Lingua ${card.lingua}: fonte non configurata; serve verifica manuale.`)
  let detail: Detail | null
  let match: Brief
  if (card.source_card_id && card.source_language === lang && (!card.source_uid || card.source_uid.startsWith('tcgdex:'))) {
    detail = await json<Detail>(`${lang}/cards/${encodeURIComponent(card.source_card_id)}`, logs, deadline)
    if (!detail) return miss(`Carta ${card.source_card_id} non disponibile nella fonte.`)
    match = detail
  } else {
    const code = card.sigla.split('@')[0].trim()
    const sets = await json<SetBrief[]>(`${lang}/sets`, logs, deadline)
    const set = sets?.find(s => s.id.toLowerCase() === code.toLowerCase())
    if (!set) return miss(`Set ${code} non disponibile su TCGdex (${lang}); nessuna sostituzione con altre espansioni.`)
    const data = await json<{ cards: Brief[] }>(`${lang}/sets/${encodeURIComponent(set.id)}`, logs, deadline)
    if (!data?.cards?.length) return miss(`Il set ${set.id} esiste, ma la fonte non contiene carte (${lang}).`)
    // MFB input numbers are catalogue positions, NOT printed/source local IDs.
    // Repeated names (energies, trainers, starter stamps) must remain unresolved.
    let candidates: Brief[]
    if (code.toUpperCase() === 'MFB') {
      const name = translations[card.nome] || card.nome
      candidates = data.cards.filter(c => normalize(c.name) === normalize(name))
    } else {
      candidates = data.cards.filter(c => local(c.localId) === local(card.source_local_id || card.numero))
    }
    if (candidates.length !== 1) return miss(`Abbinamento ${set.id}: ${candidates.length} candidati; servono identificativo/variante esatti. File ${card.file_name}.`)
    match = candidates[0]
    logs.push(`Identificata ${match.id} (${match.name}); file originale ${card.file_name}`)
    if (card.variante && !['normale', 'normal', ''].includes(card.variante.toLowerCase())) {
      return miss(`Carta ${match.id} identificata, ma variante “${card.variante}” da verificare manualmente.`)
    }
    detail = await json<Detail>(`${lang}/cards/${encodeURIComponent(match.id)}`, logs, deadline)
    if (!detail) return miss(`Dettaglio ${match.id} non disponibile.`)
  }
  if (!detail) return miss('Dettaglio non disponibile.')
  if (card.variante && !['normale','normal',''].includes(card.variante.toLowerCase())) return miss(`Variante ${card.variante} da verificare.`)
  if (detail.image) {
    const url = `${detail.image}/high.png`
    if (await validImage(url, logs, deadline)) return { url, source: 'tcgdex', confidence: 'high', message: `TCGdex ${lang}/${match.id}; immagine verificata.`, logs }
  }
  // English product IDs only: never use an English scan for an Asian card.
  if (lang === 'en') {
    const ids = [...new Set((detail.variants_detailed || []).filter(v => !v.type || v.type === 'normal').map(v => v.thirdParty?.tcgplayer).filter((id): id is number => Number.isInteger(id) && Number(id) > 0))]
    if (ids.length === 1) {
      const url = `https://product-images.tcgplayer.com/fit-in/600x600/${ids[0]}.jpg`
      if (await validImage(url, logs, deadline)) return { url, source: 'tcgplayer-via-tcgdex', confidence: 'medium', message: `TCGPlayer ${ids[0]} collegato a ${match.id} (${lang}). Controllare visivamente stampa e variante.`, logs }
    }
  }
  return miss(`Carta ${match.id} identificata, ma nessuna immagine disponibile nelle fonti configurate (${lang}).`)
}


/** Isolate sources: one unavailable provider must not hide a usable scan elsewhere. */
export async function aggressiveSearch(card: CardInput, options: { externalCandidates?: ImageCandidate[]; timeBudgetMs?: number } = {}): Promise<SearchResult> {
  const logs: string[] = []
  const errors: string[] = []
  const deadline=Date.now()+Math.min(options.timeBudgetMs || 45000,45000)
  if (card.variante && !['normale','normal',''].includes(card.variante.toLowerCase())) {
    return {url:null,source:'none',confidence:'low',message:`Variante ${card.variante}: abbinamento esatto da verificare.`,logs}
  }
  for (const candidate of options.externalCandidates || []) {
    try {
      if (await validImage(candidate.url,logs,deadline)) return {url:candidate.url,source:candidate.source,confidence:'high',message:`Immagine da ${candidate.source}. Provenienza: ${candidate.page || candidate.url}`,logs}
    } catch (error) { errors.push(String(error)); logs.push(`Fonte ${candidate.source}: ${String(error)}`) }
    // The Korean official site moved image hosts. Refresh from the exact card page,
    // selecting its feature image, never a related card, symbol or generic og:image.
    if (candidate.source==='atlas-official-ko' && candidate.page) {
      try {
        const page=new URL(candidate.page)
        if(page.hostname==='pokemoncard.co.kr' && page.protocol==='https:' && /^\/cards\/detail\/[a-zA-Z0-9_-]+\/?$/.test(page.pathname)) {
          const response=await fetch(page.href,{signal:timeout(6000,deadline),next:{revalidate:86400}})
          logs.push(`Pagina ufficiale coreana: HTTP ${response.status}`)
          if(!response.ok && response.status!==404)throw new Error(`Pokémon Korea HTTP ${response.status}`)
          if(response.ok) {
            const html=await response.text()
            const image=(html.match(/<img\b[^>]*>/gi) || []).find(tag=>/class=["'][^"']*\bfeature_image\b[^"']*["']/i.test(tag))
            const src=image?.match(/\bsrc=["']([^"']+)["']/i)?.[1]
            if(src) {
              const url=new URL(src.replace(/&amp;/g,'&'),page)
              if(['pokemoncard.co.kr','cards.image.pokemonkorea.co.kr'].includes(url.hostname) && url.protocol==='https:' && url.pathname.includes('/wmimages/') && await validImage(url.href,logs,deadline)) {
                return {url:url.href,source:'pokemon-korea-official-page',confidence:'high',message:`Immagine aggiornata dalla scheda ufficiale ${page.href}`,logs}
              }
            }
          }
        }
      } catch(error) {errors.push(String(error));logs.push(`Scheda coreana: ${String(error)}`)}
    }
  }
  let primary: SearchResult | undefined
  try { primary = await searchTcgdex(card,deadline); logs.push(...primary.logs); if (primary.url) return {...primary,logs} }
  catch (error) {errors.push(String(error));logs.push(`TCGdex: ${String(error)}`)}
  // Historical English JSON maintained by the original Pokémon TCG API project.
  // This is a historical fallback, not a source of future releases.
  if (['INT','EN'].includes(card.lingua) && card.sigla.split('@')[0].toUpperCase() !== 'MFB') {
    try {
      const set = card.sigla.split('@')[0].toLowerCase()
      if (/^[a-z0-9-]+$/.test(set)) {
        const response = await fetch(`https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en/${set}.json`,{signal:timeout(6000,deadline),next:{revalidate:86400}})
        logs.push(`Archivio PokemonTCG ${set}: HTTP ${response.status}`)
        if (!response.ok && response.status !== 404) throw new Error(`Archivio storico HTTP ${response.status}`)
        if (response.ok) {
          const cards = await response.json()
          const matches = Array.isArray(cards) ? cards.filter(c=>local(c.number)===local(card.source_local_id || card.numero)) : []
          if (matches.length === 1 && matches[0].images?.large) {
            const url=matches[0].images.large
            if (await validImage(url,logs,deadline)) return {url,source:'pokemontcg-historical',confidence:'high',message:`Archivio inglese PokemonTCG ${matches[0].id}; set e numero esatti.`,logs}
          }
        }
      }
    } catch(error) {errors.push(String(error));logs.push(`Archivio storico: ${String(error)}`)}
  }
  if (errors.length) throw new Error(`Fonti temporaneamente non disponibili: ${errors.join('; ')}`)
  return {...(primary || {url:null,source:'none',confidence:'low' as const,message:'Nessuna fonte ha restituito un abbinamento certo.'}),logs}
}
export const searchCardImage = aggressiveSearch
