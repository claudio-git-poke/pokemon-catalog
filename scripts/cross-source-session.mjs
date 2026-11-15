import {compareSourcePair} from './compare-sources.mjs'
export async function runCrossSourceSession({db,log=console.log,onProgress=()=>{},budgetMs=12*60000,limit=60,clock=Date.now,comparePair=compareSourcePair}){
 if(!Number.isFinite(budgetMs)||budgetMs<20000||budgetMs>12*60000||!Number.isInteger(limit)||limit<1||limit>60)throw Error('Limiti del confronto non validi')
 const deadline=clock()+budgetMs
 const stats={checked:0,concordant:0,differences:0,uncomparable:0,errors:0,stop_reason:'limit'}
 while(stats.checked<limit){
  if(deadline-clock()<20000){stats.stop_reason='budget';break}
  const {data:pairs,error}=await db.rpc('catalog_cross_source_due',{batch_size:1})
  if(error)throw Error('Selezione confronti: '+error.message)
  if(!pairs?.length){stats.stop_reason='exhausted';break}
  const pair=pairs[0]
  await log(`Confronto ${stats.checked+1}/${limit}: ${pair.source_language}/${pair.primary_set}; leggo lo snapshot importato e l’elenco TCGdex.`)
  // comparePair only returns after saving evidence or the explicit source error.
  const result=await comparePair({db,pair,clock})
  stats.checked++
  if(result.status==='error')stats.errors++;else if(Object.hasOwn(stats,result.status))stats[result.status]++
  onProgress({...stats})
  await log(`Confronto ${pair.source_language}/${pair.primary_set}: ${result.status} · ${result.reason}`)
  if(result.status==='error'&&/HTTP (429|503)\b/.test(result.reason||'')){stats.stop_reason='source_unavailable';break}
 }
 onProgress({...stats})
 await log(`Confronti conclusi: ${stats.checked} salvati; ${stats.concordant} concordanti, ${stats.differences} differenze, ${stats.uncomparable} ambiguità, ${stats.errors} errori. Motivo arresto: ${stats.stop_reason}.`,true)
 return stats
}
