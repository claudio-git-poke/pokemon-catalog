import { createClient } from '@supabase/supabase-js'
import { syncCatalog } from './sync-catalog.mjs'
import { runSession, sessionMinutes } from './catalog-session.mjs'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !secret) throw new Error('Configurare URL Supabase e SERVICE_ROLE_KEY nei secrets del worker.')
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
const minutes = sessionMinutes(process.env.CATALOG_RUN_MINUTES || '330')
async function hasWork() {
  const now = new Date().toISOString()
  const queries = [
    db.from('cards').select('id').in('image_status',['missing','placeholder']).lte('image_next_attempt_at',now).limit(1),
    db.from('catalog_sync_sets').select('source_uid').neq('set_id','__index__').lte('next_sync_at',now).limit(1)
  ]
  const results = await Promise.all(queries)
  for (const result of results) if (result.error) throw Error(result.error.message)
  return results.some(result => result.data.length > 0)
}
await runSession({ minutes, runCycle: () => syncCatalog({ db }), hasWork })
