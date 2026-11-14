import { enrichCatalog } from './enrich-catalog.mjs'
import { createCatalogLogger } from './catalog-logger.mjs'
import { externalImages } from '../src/lib/external-cards.ts'
import { atlasSets,importAtlasSet } from './atlas-source.mjs'
import { aggressiveSearch } from '../src/lib/image-search.ts'
import { SOURCES, sourceUid, legacyMatch, newCard, retryAt } from './catalog-core.mjs'
export async function syncCatalog({ db, enrich = false, search = aggressiveSearch, fetchSource, budgetMs = 8 * 60 * 1000, atlasRoot = process.env.ATLAS_DATA_DIR, loadAtlasSets = atlasSets, importAtlas = importAtlasSet, imageLookup = externalImages }) {
  const deadline = Date.now() + budgetMs
  const now = () => new Date().toISOString()
  const later = hours => new Date(Date.now() + hours * 3600000).toISOString()
  const summary = { discoveredSets: 0, processedSets: 0, added: 0, linked: 0, found: 0, missing: 0, errors: 0, ambiguous: 0 }
  async function check(query) { const { data, error } = await query; if (error) throw new Error(error.message); return data }
  async function source(path) {
    if (fetchSource) return fetchSource(path)
    const response = await fetch(`https://api.tcgdex.net/v2/${path}`, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`Fonte TCGdex HTTP ${response.status}`)
    return await response.json()
  }
  const run = await check(db.from('catalog_sync_runs').insert({}).select('id').single())
  const log = createCatalogLogger({db,runId:run.id,summary})
  try {
    await log('Avvio: controllo catalogo e code di lavoro.', true)
    if(enrich)await enrichCatalog({db,log})
    // A found flag with no URL must not keep a card outside the image queue.
    await check(db.from('cards').update({image_status:'missing',image_next_attempt_at:now()}).eq('image_status','found').is('image_url',null))
    await check(db.from('cards').update({image_status:'missing',image_next_attempt_at:now()}).eq('image_status','found').eq('image_url',''))
    // Refresh set lists every day. Incomplete/empty language feeds remain visible as errors.
    for (const [lang] of SOURCES) {
      const last = await check(db.from('catalog_sync_sets').select('last_sync_at').eq('source_uid', `index:${lang}`).maybeSingle())
      if (last?.last_sync_at && Date.now() - Date.parse(last.last_sync_at) < 86400000) continue
      try {
        await log(`TCGdex ${lang}: aggiornamento elenco espansioni.`, true)
        const sets = await source(`${lang}/sets`)
        if (!Array.isArray(sets) || !sets.length) throw new Error('Elenco set vuoto o non valido')
        const known = []
      for (let offset = 0;; offset += 500) {
        const page = await check(db.from('catalog_sync_sets').select('*').eq('source_language',lang).range(offset,offset+499))
        known.push(...page); if (page.length < 500) break
      }
      const rows = sets.map(s => ({ source_uid: sourceUid(lang, s.id), source_language: lang, set_id: s.id, name: s.name, reported_count:s.cardCount?.total ?? null }))
        await check(db.from('catalog_sync_sets').upsert(rows, { onConflict: 'source_uid', ignoreDuplicates: true }))
        for (const row of rows) {
        const old = known.find(s => s.source_uid === row.source_uid)
        if (old && row.reported_count !== null && old.reported_count !== row.reported_count) {
          await check(db.from('catalog_sync_sets').update({ reported_count:row.reported_count,next_sync_at:now(),name:row.name }).eq('source_uid',row.source_uid))
        }
      }
      await log(`TCGdex ${lang}: ${rows.length} set disponibili.`)
      summary.discoveredSets += rows.filter(r => !known.some(s => s.source_uid === r.source_uid)).length
        await check(db.from('catalog_sync_sets').upsert({ source_uid: `index:${lang}`, source_language: lang, set_id: '__index__', name: `Elenco ${lang}`, next_sync_at: later(24), last_sync_at: now(), last_error: null }))
      } catch (error) {
        summary.errors++
        await log(`Errore elenco ${lang}: ${String(error)}`, true)
        await check(db.from('catalog_sync_sets').upsert({ source_uid: `index:${lang}`, source_language: lang, set_id: '__index__', name: `Elenco ${lang}`, next_sync_at: later(1), last_error: String(error) }))
      }
    }
    if (atlasRoot) {
      const last = await check(db.from('catalog_sync_sets').select('*').eq('source_uid','index:atlas').maybeSingle())
      if (!last?.last_sync_at || Date.now()-Date.parse(last.last_sync_at)>86400000) {
        try {
          await log('Card Atlas: lettura elenco espansioni JP/KOR/CHN-T.', true)
          const rows=await loadAtlasSets(atlasRoot)
          await check(db.from('catalog_sync_sets').upsert(rows,{onConflict:'source_uid',ignoreDuplicates:true}))
          await check(db.from('catalog_sync_sets').upsert({source_uid:'index:atlas',provider:'atlas',source_language:'multi',set_id:'__index__',name:'Archivio JP/KOR/CHN-T',last_sync_at:now(),next_sync_at:later(24),last_error:null}))
        } catch(error) {
          summary.errors++
          await log(`Errore indice Card Atlas: ${String(error)}`, true)
          await check(db.from('catalog_sync_sets').upsert({source_uid:'index:atlas',provider:'atlas',source_language:'multi',set_id:'__index__',name:'Archivio JP/KOR/CHN-T',next_sync_at:later(6),last_error:String(error)}))
        }
      }
    }
    // Fair allocation: the initial TCGdex backlog cannot starve the Asian archive.
    const sets = []
    for (const provider of ['atlas','tcgdex']) {
      if (provider==='atlas' && !atlasRoot) continue
      const due=await check(db.from('catalog_sync_sets').select('*').eq('provider',provider).neq('set_id','__index__').lte('next_sync_at',now()).order('next_sync_at').limit(provider==='tcgdex' && !atlasRoot ? 30 : 15))
      sets.push(...due)
    }
    await log(`${sets.length} set selezionati per questa esecuzione.`, true)
    for (const set of sets) {
      if (Date.now() > deadline - 120000) break // reserve time for image queue
      try {
        await log(`Set ${set.provider} · ${set.source_language} · ${set.set_id}: inizio importazione.`, true)
        if (set.provider==='atlas') {
          await importAtlas({db,set,root:atlasRoot,newCard,summary,deadline,log})
          await log(`Set ${set.set_id}: completato. Totale nuove carte: ${summary.added}.`, true)
          continue
        }
        const data = await source(`${set.source_language}/sets/${encodeURIComponent(set.set_id)}`)
        if (data.serie?.id === 'tcgp') {
          await log(`Set ${set.set_id}: escluso perché Pokémon TCG Pocket.`, true)
          await check(db.from('catalog_sync_sets').update({ next_sync_at:later(720),last_sync_at:now(),last_error:null }).eq('source_uid',set.source_uid))
          continue
        }
        if (!Array.isArray(data.cards) || !data.cards.length) throw new Error('Set privo di carte nella fonte: verrà riprovato')
        await log(`Set ${set.set_id}: ${data.cards.length} carte da confrontare.`)
        const localLanguage = SOURCES.find(([lang]) => lang === set.source_language)[1]
        const variants = [set.set_id, set.set_id.toUpperCase(), `${set.set_id}@${localLanguage}`, `${set.set_id.toUpperCase()}@${localLanguage}`]
        const existing = []
        for (let offset = 0;; offset += 500) {
          const rows = await check(db.from('cards').select('*').eq('lingua',localLanguage).in('sigla',variants).range(offset,offset+499))
          existing.push(...rows); if (rows.length < 500) break
        }
        let ambiguous = 0
        for (const card of data.cards) {
          if (Date.now() > deadline - 120000) throw new Error('Budget esecuzione raggiunto: ripresa automatica prossima esecuzione')
          const uid = sourceUid(set.source_language,card.id)
          if (existing.some(c => c.source_uid === uid)) { await log(`Già presente: ${card.name} · ${set.set_id}/${card.localId} · ${set.source_language}.`); continue }
          const linked = await check(db.from('cards').select('id').eq('source_uid',uid).maybeSingle())
          if (linked) { await log(`Già collegata: ${card.name} · ${set.set_id}/${card.localId}.`); continue }
          const { match, ambiguous: conflict } = legacyMatch(existing,data.cards,card,set.set_id)
          if (conflict) { ambiguous++; summary.ambiguous++; await log(`Ambigua: ${card.name} · ${card.localId}, lasciata da verificare.`); continue }
          if (match?.source_uid) {
            summary.alternatives=(summary.alternatives || 0)+1
            await log(`Fonte alternativa: ${card.name} · ${set.set_id}/${card.localId}.`)
          } else if (match) {
            await check(db.from('cards').update({ source_uid:uid, source_card_id:card.id, source_language:set.source_language,source_local_id:card.localId }).eq('id',match.id).is('source_uid',null).select('id').single())
            match.source_uid = uid; summary.linked++
            await log(`Collegata carta esistente: ${card.name} · ${set.set_id}/${card.localId} · ${set.source_language}.`)
          } else {
            await check(db.from('cards').upsert(newCard(card,set.set_id,set.source_language,localLanguage),{ onConflict:'source_uid',ignoreDuplicates:true }))
            summary.added++
            await log(`Inserita: ${card.name} · ${set.set_id}/${card.localId} · ${set.source_language}.`)
          }
        }
        await check(db.from('catalog_sync_sets').update({ next_sync_at:later(168), last_sync_at:now(), card_count:data.cards.length, last_error:ambiguous ? `${ambiguous} abbinamenti ambigui con il catalogo originale: revisione necessaria.` : null }).eq('source_uid',set.source_uid))
        summary.processedSets++
        await log(`Set ${set.set_id}: completato; ${ambiguous} abbinamenti ambigui.`, true)
      } catch (error) {
        const deferred = /Budget.*(raggiunto|esecuzione)/i.test(String(error))
        if (!deferred) summary.errors++
        await log(`${deferred ? 'Pausa' : 'Errore'} set ${set.set_id}: ${String(error)}`, true)
        await check(db.from('catalog_sync_sets').update({ next_sync_at:deferred ? now() : later(24),last_error:deferred ? null : String(error) }).eq('source_uid',set.source_uid))
      }
    }
    const queue = await check(db.from('cards').select('*').in('image_status',['missing','placeholder']).lte('image_next_attempt_at',now()).order('image_next_attempt_at').order('id').limit(400))
    await log(`Ricerca immagini: ${queue.length} carte selezionate; lavoro fino al limite di tempo.`, true)
    for (const card of queue) {
      if (Date.now() > deadline - 40000) break
      await log(`Cerco immagine: #${card.id} ${card.nome || card.name || card.file_name} · ${card.sigla}/${card.numero} · ${card.lingua}.`, true)
      const attempts = card.image_attempts + 1
      let patch
      try {
        const candidates = await imageLookup(db,card)
        await log(`Carta #${card.id}: ${candidates.length} candidati dall’indice esterno.`)
        const result = await search(card,{externalCandidates:candidates})
        for (const line of result.logs || []) await log(`Carta #${card.id} · ${line}`)
        await log(`Carta #${card.id}: ${result.message}`)
        patch = { image_attempts:attempts, image_next_attempt_at:retryAt(attempts,false), image_last_error:null }
        if (result.url) {
          Object.assign(patch,{ image_url:result.url,image_status:'found',image_source:result.source,notes:result.message })
        } else {
          Object.assign(patch,{ image_status:'placeholder',notes:result.message })
        }
      } catch (error) {
        summary.errors++
        patch = { image_attempts:attempts,image_next_attempt_at:retryAt(attempts,true),image_last_error:String(error) }
      }
      // Do not overwrite a manual image saved while the worker was searching.
      const saved = await check(db.from('cards').update(patch).eq('id',card.id).in('image_status',['missing','placeholder']).select('id'))
    if (saved.length && patch.image_status === 'found') summary.found++
    if (saved.length && patch.image_status === 'placeholder') summary.missing++
      await log(`Carta #${card.id}: ${!saved.length ? 'aggiornamento ignorato: modificata nel frattempo' : patch.image_status === 'found' ? 'immagine trovata · '+patch.image_source : patch.image_last_error ? 'errore · '+patch.image_last_error : 'immagine non trovata'}. Prossimo tentativo: ${patch.image_next_attempt_at}.`, true)
    }
    await log('Esecuzione conclusa. Il lavoro restante riprenderà al prossimo avvio.', true)
    await check(db.from('catalog_sync_runs').update({ finished_at:now(),status:summary.errors ? 'partial' : 'success',summary:{...summary,log_version:2,current:'Esecuzione conclusa',updated_at:now()} }).eq('id',run.id))
    console.log(JSON.stringify(summary))
    return summary
  } catch (error) {
    await log(`Esecuzione interrotta: ${String(error)}`, true)
    await check(db.from('catalog_sync_runs').update({finished_at:now(),status:'error',summary:{...summary,log_version:2,current:'Esecuzione interrotta',error:String(error),updated_at:now()}}).eq('id',run.id))
    throw error
  }

}
