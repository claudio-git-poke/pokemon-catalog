export const SOURCES = [
  ['en','INT'], ['it','IT'], ['fr','FR'], ['de','DE'], ['es','ES'], ['pt','PT'],
  ['ko','KOR'], ['ja','JP'], ['zh-tw','CHN-T'], ['id','ID'], ['th','TH']
]
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const aliases = { 'Energia base Fuoco': 'Fire Energy', 'Energia base Erba': 'Grass Energy', 'Energia base Lampo': 'Lightning Energy', 'Energia base Acqua': 'Water Energy', Pozione: 'Potion', Scambio: 'Switch' }
export function sourceUid(lang, id) { return `tcgdex:${lang}:${id}` }
export function retryAt(attempts, failed, now = Date.now()) {
  // Genuine missing scan: 1, 2, 4, 8, 16, then every 30 days. Transient error: 1..24 hours.
  const hours = failed ? Math.min(24, 2 ** Math.min(attempts - 1, 5)) : Math.min(720, 24 * 2 ** Math.min(attempts - 1, 5))
  return new Date(now + hours * 3600000).toISOString()
}
export function legacyMatch(existing, allSourceCards, source, setId) {
  const unlinked = existing.filter(c => ['normale','normal',''].includes((c.variante || '').toLowerCase()))
  if (setId.toLowerCase() === 'mfb') {
    const sameName = allSourceCards.filter(c => normalize(c.name) === normalize(source.name))
    const local = unlinked.filter(c => normalize(aliases[c.nome] || c.nome) === normalize(source.name))
    return sameName.length === 1 && local.length === 1 ? { match: local[0], ambiguous: false } : { match: null, ambiguous: local.length > 0 }
  }
  const exact = unlinked.filter(c => normalize(String(c.source_local_id || c.numero).replace(/^0+/, '')) === normalize(String(source.localId).replace(/^0+/, '')))
  return { match: exact.length === 1 ? exact[0] : null, ambiguous: exact.length > 1 }
}
export function newCard(source, setId, lang, localLanguage) {
  return {
    source_uid: sourceUid(lang, source.id), source_card_id: source.id, source_language: lang, source_local_id:source.localId,
    nome: source.name, sigla: `${setId.toUpperCase()}@${localLanguage}`, lingua: localLanguage,
    numero: Number.parseInt(source.localId, 10) || 0, codice: `${setId} ${source.localId}`,
    variante: 'normale', file_name: `${setId}_${localLanguage}_${source.localId}.jpg`,
    image_status: 'missing', image_url: null, image_source: null, link_cardmarket: null,
    notes: `Importazione automatica TCGdex ${lang}/${source.id}.`,
    image_next_attempt_at: new Date().toISOString()
  }
}
