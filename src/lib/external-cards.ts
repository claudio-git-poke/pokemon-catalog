import type { SupabaseClient } from '@supabase/supabase-js'
import type { CardInput, ImageCandidate } from './image-search'
export function canonicalSet(code: string) { return code.split('@')[0].trim().toLowerCase() }
export function canonicalNumber(value: string | number) { return String(value).split('/')[0].trim().replace(/^0+(?=\d)/,'').toUpperCase() }
export async function externalImages(db: SupabaseClient, card: CardInput, options: { allowUnconfigured?: boolean } = {}): Promise<ImageCandidate[]> {
  if (!card.sigla || !card.lingua) return []
  let query = db.from('catalog_external_cards').select('source_uid,image_url,page_url,provider')
  if (card.source_uid?.startsWith('atlas:')) query = query.eq('source_uid',card.source_uid)
  else query = query.eq('language',card.lingua).eq('set_code',canonicalSet(card.sigla)).eq('local_id',canonicalNumber(card.source_local_id || card.numero))
  const {data,error} = await query.limit(20)
  if (error && options.allowUnconfigured && ['PGRST205','42P01'].includes(error.code)) return []
  if (error) throw new Error('Indice fonti alternative: '+error.message)
  if ((data || []).length >= 20) return []
  const unique = [...new Map((data || []).filter(r=>r.image_url).map(r=>[r.image_url,r])).values()]
  // Several pictures for the same printed number can be different stamps/promos.
  if (unique.length !== 1) return []
  return unique.map(r=>({url:r.image_url,source:r.provider,page:r.page_url}))
}
