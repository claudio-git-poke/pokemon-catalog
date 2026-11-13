import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aggressiveSearch } from '@/lib/image-search'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { cardId } = body

    if (!cardId) {
      return NextResponse.json({ error: 'cardId richiesto' }, { status: 400 })
    }

    // Carica la carta
    const { data: card, error } = await supabase
      .from('cards')
      .select('*')
      .eq('id', cardId)
      .single()

    if (error || !card) {
      return NextResponse.json({ error: 'Carta non trovata' }, { status: 404 })
    }

    // Esegui ricerca aggressiva
    const result = await aggressiveSearch(card)

    if (result.url) {
      // Aggiorna la carta con l'immagine trovata
      await supabase
        .from('cards')
        .update({
          image_url: result.url,
          image_status: 'found',
          image_source: result.source,
          notes: result.message
        })
        .eq('id', cardId)

      return NextResponse.json({
        success: true,
        found: true,
        url: result.url,
        source: result.source,
        message: result.message
      })
    } else {
      // Segna come placeholder e lascia nota chiara
      await supabase
        .from('cards')
        .update({
          image_status: 'placeholder',
          image_source: result.source,
          notes: result.message
        })
        .eq('id', cardId)

      return NextResponse.json({
        success: true,
        found: false,
        url: null,
        source: result.source,
        message: result.message
      })
    }
  } catch (err: any) {
    console.error(err)
    return NextResponse.json({ error: err.message || 'Errore interno' }, { status: 500 })
  }
}
