import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aggressiveSearch } from '@/lib/image-search'

export const maxDuration = 30

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  const logs: string[] = []
  const log = (msg: string) => {
    console.log('[search-image]', msg)
    logs.push(msg)
  }

  try {
    const body = await req.json()
    const { cardId } = body
    log(`Richiesta per cardId=${cardId}`)

    if (!cardId) {
      return NextResponse.json({ error: 'cardId richiesto', logs }, { status: 400 })
    }

    const { data: card, error } = await supabaseAdmin
      .from('cards')
      .select('*')
      .eq('id', cardId)
      .single()

    if (error || !card) {
      log(`Carta non trovata: ${error?.message}`)
      return NextResponse.json({ error: 'Carta non trovata', logs }, { status: 404 })
    }

    log(`Carta: ${card.nome} (${card.sigla} ${card.lingua})`)

    if (card.image_status === 'found' || card.image_status === 'manual') {
      log('Già ha foto, salto')
      return NextResponse.json({
        success: true,
        found: true,
        skipped: true,
        url: card.image_url,
        message: 'Carta già ha una foto',
        logs
      })
    }

    log('Avvio aggressiveSearch...')
    const result = await aggressiveSearch(card)
    log(`Risultato: found=${!!result.url} source=${result.source}`)

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
        logs
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
      confidence: result.confidence,
      message: result.message,
      logs
    })
  } catch (err: any) {
    log(`Exception: ${err.message}`)
    console.error(err)
    return NextResponse.json(
      { error: err.message || 'Errore interno', logs },
      { status: 500 }
    )
  }
}
