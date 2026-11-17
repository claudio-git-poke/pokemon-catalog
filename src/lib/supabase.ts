import { createClient } from '@supabase/supabase-js'

export const catalogUsesTurso = process.env.NEXT_PUBLIC_CATALOG_DATABASE === 'turso'
const supabaseUrl = catalogUsesTurso ? `${typeof window === 'undefined' ? 'http://catalog.internal' : window.location.origin}/api/catalog-db` : process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = catalogUsesTurso ? 'catalog-public' : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey,{auth:{persistSession:!catalogUsesTurso,autoRefreshToken:!catalogUsesTurso}})

export type Card = {
  manual_overrides?: Record<string, unknown>
  source_local_id?: string | null
  source_uid?: string | null
  source_card_id?: string | null
  source_language?: string | null
  image_attempts?: number
  image_next_attempt_at?: string
  image_last_error?: string | null
  id: number
  file_name: string
  sigla: string
  lingua: string
  numero: number
  variante: string
  codice: string | null
  nome: string
  link_cardmarket: string | null
  image_url: string | null
  image_status: 'missing' | 'placeholder' | 'found' | 'manual'
  image_source: string | null
  notes: string | null
  created_at: string
  updated_at: string
}
