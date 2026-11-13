import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aggressiveSearch } from '@/lib/image-search'

export const maxDuration = 30

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

    const { data: card, error } = await supabaseAdmin
      .from('cards')
      .select('*')
      .eq('id', cardId)
      .single()

    if (error || !card) {
      return NextResponse.json({ error: 'Carta non trovata' }, { status: 404 })
    }

    if (card.image_status === 'found' || card.image_status === 'manual') {
      return NextResponse.json({
        success: true,
        found: true,
        skipped: true,
        url: card.image_url,
        message: 'Carta già ha una foto'
      })
    }

    const result = await aggressiveSearch(card)

    if (result.url) {
      await supabaseAdmin
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
        confidence: result.confidence,
        message: result.message,
        logs: result.logs
      })
    }

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
      message: result.message,
      logs: result.logs
    })
  } catch (err: any) {
    console.error(err)
    return NextResponse.json({ error: err.message || 'Errore interno' }, { status: 500 })
  }
}
