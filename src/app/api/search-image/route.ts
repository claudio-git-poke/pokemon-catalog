import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { externalImages } from '@/lib/external-cards'
import { aggressiveSearch } from '@/lib/image-search'

export const maxDuration = 60

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const cardId = Number(body.cardId)

    if (!Number.isSafeInteger(cardId) || cardId <= 0) {
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

    const candidates = await externalImages(supabaseAdmin,card,{allowUnconfigured:true})
    const result = await aggressiveSearch(card,{externalCandidates:candidates})

    if (result.url) {
      const { data: saved, error: saveError } = await supabaseAdmin
        .from('cards')
        .update({
          image_url: result.url,
          image_status: 'found',
          image_source: result.source,
          notes: result.message
        })
        .eq('id', cardId).select('id').single()

      if (saveError || !saved) throw new Error('Immagine trovata ma salvataggio fallito: ' + (saveError?.message || 'nessuna riga aggiornata'))

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

    const { data: saved, error: saveError } = await supabaseAdmin
      .from('cards')
      .update({
        image_status: 'placeholder',
        image_source: result.source,
        notes: result.message
      })
      .eq('id', cardId).select('id').single()

    if (saveError || !saved) throw new Error('Salvataggio esito fallito: ' + (saveError?.message || 'nessuna riga aggiornata'))

    return NextResponse.json({
      success: true,
      found: false,
      url: null,
      source: result.source,
      message: result.message,
      logs: result.logs,
      alternatives: result.alternatives || []
    })
  } catch (err: any) {
    console.error(err)
    return NextResponse.json({ error: err.message || 'Errore interno' }, { status: 500 })
  }
}
