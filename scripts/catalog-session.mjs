export function sessionMinutes(value = '330') {
  const minutes = Number(value)
  if (!Number.isFinite(minutes) || minutes < 8 || minutes > 330) throw Error('CATALOG_RUN_MINUTES deve essere tra 8 e 330.')
  return minutes
}

export async function runSession({ runCycle, hasWork, minutes = 330, clock = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log }) {
  const deadline = clock() + sessionMinutes(minutes) * 60000
  let cycles = 0
  while (cycles === 0 || deadline - clock() >= 8 * 60000) {
    if (cycles && !await hasWork()) {
      log('Code esaurite: nessun lavoro disponibile ora. Attendo il prossimo avvio programmato.')
      break
    }
    log(`Ciclo ${cycles + 1}: avvio; sessione fino a ${new Date(deadline).toISOString()}.`)
    const summary = await runCycle()
    cycles++
    log(`Ciclo ${cycles}: ${summary.added} carte inserite, ${summary.found} immagini trovate, ${summary.errors} problemi registrati. I problemi delle singole fonti non fermano la sessione.`)
    if (deadline - clock() < 8 * 60000) break
    await pause(5000)
  }
  log(`Sessione conclusa: ${cycles} cicli. Avanzamento salvato nel database.`)
  return cycles
}
