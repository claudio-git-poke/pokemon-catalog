import {compareSources} from './compare-sources.mjs'
import {refreshQualityCache} from './refresh-quality-cache.mjs'
import {linkCardmarket} from './link-cardmarket.mjs'
import {publishBindexSafely} from './publish-bindex-safely.mjs'
import {syncDeckMappings,linkMfbIdentities} from './deck-mappings.mjs'
import { createClient } from '@supabase/supabase-js'
import { syncCuratedReleases } from './enrich-catalog.mjs'
import { syncCatalog } from './sync-catalog.mjs'
import { runSession, sessionMinutes } from './catalog-session.mjs'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !secret) throw new Error('Configurare URL Supabase e SERVICE_ROLE_KEY nei secrets del worker.')
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
console.log(`Registro incrementale v3, contratto Bindex, registro copertura, 16 percorsi linguistici e confronto elenchi: versione worker ${process.env.GITHUB_SHA||'locale'}.`)
const minutes = sessionMinutes(process.env.CATALOG_RUN_MINUTES || '330')
async function hasWork() {
  const now = new Date().toISOString()
  const queries = [
    db.from('cards').select('id').not('source_card_id','is',null).lte('traits_next_attempt_at',now).limit(1),
    db.from('cards').select('id').in('image_status',['missing','placeholder']).lte('image_next_attempt_at',now).limit(1),
    db.from('catalog_sync_sets').select('source_uid').neq('set_id','__index__').lte('next_sync_at',now).limit(1)
  ]
  const results = await Promise.all(queries)
  for (const result of results) if (result.error) throw Error(result.error.message)
  return results.some(result => result.data.length > 0)
}
await syncCuratedReleases({db})
await syncDeckMappings({db})
await linkMfbIdentities({db})
await runSession({ minutes, runCycle: async () => {
  const result=await syncCatalog({db,enrich:true})
  const crossSources=await compareSources({db})
  const publication=await publishBindexSafely({db})
  const marketplace=await linkCardmarket({db})
  const coverage=await refreshQualityCache({db})
  result.errors+=publication.errors+marketplace.errors+coverage.errors+crossSources.errors
  return result
}, hasWork })
