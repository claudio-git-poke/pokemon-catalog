import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Card = {
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
