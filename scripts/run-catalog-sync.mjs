import { createClient } from '@supabase/supabase-js'
import { syncCatalog } from './sync-catalog.mjs'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !secret) throw new Error('Configurare URL Supabase e SERVICE_ROLE_KEY nei secrets del worker.')
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
const summary = await syncCatalog({ db })
if (summary.errors) process.exitCode = 1
