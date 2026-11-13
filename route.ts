import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aggressiveSearch } from '@/lib/image-search'

export const maxDuration = 30 // secondi (Vercel)

const supabaseAdmin = createClient(
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

    // Carica carta
    const { data: card, error } = await supabaseAdmin
      .from('cards')
      .select('*')
      .eq('id', cardId)
      .single()

    if (error || !card) {
      return NextResponse.json({ error: 'Carta non trovata' }, { status: 404 })
    }

    // Non riscrivere se già ha una foto "found" o "manual"
    if (card.image_status === 'found' || card.image_status === 'manual') {
      return NextResponse.json({
        success: true,
        found: true,
        skipped: true,
        url: card.image_url,
        message: 'Carta già ha una foto, salto.'
      })
    }

    // Esegui ricerca aggressiva
    const result = await aggressiveSearch(card)

    if (result.url) {
      const { error: updateError } = await supabaseAdmin
        .from('cards')
        .update({
          image_url: result.url,
          image_status: 'found',
          image_source: result.source,
          notes: result.message
        })
        .eq('id', cardId)

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        found: true,
        url: result.url,
        source: result.source,
        confidence: result.confidence,
        message: result.message
      })
    }

    // Non trovata → placeholder
    await supabaseAdmin
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
      confidence: result.confidence,
      message: result.message
    })
  } catch (err: any) {
    console.error('[search-image]', err)
    return NextResponse.json(
      { error: err.message || 'Errore interno durante la ricerca' },
      { status: 500 }
    )
  }
}
