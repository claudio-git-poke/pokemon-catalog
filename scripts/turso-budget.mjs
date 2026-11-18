// Free-plan guard for Turso. Exceeding any free quota blocks the whole account,
// so workers must stop well before the limit. The authoritative counters come
// from the Turso Platform API; when they are unavailable the guard fails closed.
export const FREE_LIMITS=Object.freeze({rows_written:10_000_000,rows_read:500_000_000,storage_bytes:5*1024**3})

// Turso counts every index entry and every row touched by triggers.
// Calibration on the official counter, with a 30% margin:
// - 18 Nov 2026, guards v2: 6,592 changes (cards and printings) cost 115,390
//   rows written, 38% of the first estimate;
// - 18 Nov 2026, guards v3: 14,300 card changes cost 145,124 rows written,
//   about 10.1 per card (factor 13). Printings are scaled by the reduction
//   measured in tests/turso-write-cost.test.mjs until a real measurement.
// The guard rereads the official counter before every run and stops at the
// configured ratio, so an underestimate cannot exhaust the free quota.
export const WRITE_FACTORS=Object.freeze({catalog_search_entries:30,cards:13,catalog_printing_inventory:10,default:8})
export const estimateWrites=(table,rows=1)=>rows*(WRITE_FACTORS[table]??WRITE_FACTORS.default)

export async function readTursoUsage({token,organization,fetchImpl=fetch}){
 if(!token||!organization)throw Error('Configurare TURSO_API_TOKEN e TURSO_ORGANIZATION per leggere i consumi Turso.')
 if(!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(organization))throw Error('TURSO_ORGANIZATION non valido.')
 const response=await fetchImpl('https://api.turso.tech/v1/organizations/'+organization+'/usage',{headers:{authorization:'Bearer '+token}})
 if(!response.ok)throw Error('Consumi Turso non disponibili: HTTP '+response.status)
 const usage=(await response.json())?.organization?.usage
 const values={rows_written:Number(usage?.rows_written),rows_read:Number(usage?.rows_read),storage_bytes:Number(usage?.storage_bytes)}
 if(!Object.values(values).every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('Risposta dei consumi Turso non valida.')
 return values
}

function nextReset(now,resetDay){
 const date=new Date(now),year=date.getUTCFullYear(),month=date.getUTCMonth()
 let next=Date.UTC(year,month,resetDay)
 if(next<=now)next=Date.UTC(year,month+1,resetDay)
 return next
}
function daysLeftInPeriod(now,resetDay){return Math.max(1,Math.ceil((nextReset(now,resetDay)-now)/86400000))}

// Spread what is left below the stop ratio over the remaining days and runs,
// so a single large backlog cannot spend the whole month at once.
// spendBy (optional, within the current period) spends what is left by that
// date instead of by the end of the period; after it, what remains is
// available run by run. The free quota resets at the start of each period,
// so spending earlier loses nothing.
// previousRunAt (start of the previous worker run), when known, makes the
// write budget proportional to time: this run gets the share of the remaining
// quota for the time elapsed since then, out of the time from then to the
// deadline. A run the scheduler skips makes the next one larger, so the pace
// does not depend on how many scheduled runs actually start.
export function planBudget(usage,{limits=FREE_LIMITS,stopRatio=0.8,now=Date.now(),resetDay=1,runsPerDay=2,maxRunWrites=400_000,maxRunReads=8_000_000,spendBy=null,previousRunAt=null}={}){
 if(!(stopRatio>0&&stopRatio<1))throw Error('Soglia di sicurezza non valida.')
 if(!(Number.isSafeInteger(maxRunWrites)&&maxRunWrites>0&&maxRunWrites<=1_000_000))throw Error('Tetto per esecuzione non valido.')
 const safe=key=>Math.floor(limits[key]*stopRatio)-usage[key]
 const left=daysLeftInPeriod(now,resetDay)
 const days=Number.isFinite(spendBy)?Math.min(left,Math.max(1,Math.ceil((spendBy-now)/86400000))):left,runs=days*runsPerDay
 const plan={days_left:left,spend_days:days,usage,limits,stop_ratio:stopRatio,writes:0,reads:0,allowed:false,reason:''}
 if(safe('storage_bytes')<=0)return {...plan,reason:'Spazio Turso oltre la soglia di sicurezza.'}
 if(safe('rows_written')<=0)return {...plan,reason:'Scritture Turso del mese oltre la soglia di sicurezza: riprendo dopo il rinnovo.'}
 if(safe('rows_read')<=0)return {...plan,reason:'Letture Turso del mese oltre la soglia di sicurezza: riprendo dopo il rinnovo.'}
 let share=1/runs
 if(Number.isFinite(previousRunAt)&&previousRunAt<now){
  const deadline=Number.isFinite(spendBy)?Math.min(spendBy,nextReset(now,resetDay)):nextReset(now,resetDay)
  share=deadline<=now?1:Math.min(1,(now-previousRunAt)/(deadline-previousRunAt))
 }
 const writes=Math.min(maxRunWrites,Math.floor(safe('rows_written')*share)),reads=Math.min(maxRunReads,Math.floor(safe('rows_read')/runs))
 const result={...plan,share:Math.round(share*10000)/10000,writes,reads}
 if(writes<estimateWrites('catalog_search_entries',200))return {...result,reason:'Quota residua per questa esecuzione troppo piccola: salto il turno.'}
 return {...result,allowed:true,reason:'Budget disponibile.'}
}
