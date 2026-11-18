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

function daysLeftInPeriod(now,resetDay){
 const date=new Date(now),year=date.getUTCFullYear(),month=date.getUTCMonth()
 let next=Date.UTC(year,month,resetDay)
 if(next<=now)next=Date.UTC(year,month+1,resetDay)
 return Math.max(1,Math.ceil((next-now)/86400000))
}

// Spread what is left below the stop ratio over the remaining days and runs,
// so a single large backlog cannot spend the whole month at once.
export function planBudget(usage,{limits=FREE_LIMITS,stopRatio=0.8,now=Date.now(),resetDay=1,runsPerDay=2,maxRunWrites=400_000,maxRunReads=8_000_000}={}){
 if(!(stopRatio>0&&stopRatio<1))throw Error('Soglia di sicurezza non valida.')
 const safe=key=>Math.floor(limits[key]*stopRatio)-usage[key]
 const days=daysLeftInPeriod(now,resetDay),runs=days*runsPerDay
 const plan={days_left:days,usage,limits,stop_ratio:stopRatio,writes:0,reads:0,allowed:false,reason:''}
 if(safe('storage_bytes')<=0)return {...plan,reason:'Spazio Turso oltre la soglia di sicurezza.'}
 if(safe('rows_written')<=0)return {...plan,reason:'Scritture Turso del mese oltre la soglia di sicurezza: riprendo dopo il rinnovo.'}
 if(safe('rows_read')<=0)return {...plan,reason:'Letture Turso del mese oltre la soglia di sicurezza: riprendo dopo il rinnovo.'}
 const writes=Math.min(maxRunWrites,Math.floor(safe('rows_written')/runs)),reads=Math.min(maxRunReads,Math.floor(safe('rows_read')/runs))
 if(writes<estimateWrites('catalog_search_entries',200))return {...plan,writes,reads,reason:'Quota residua per questa esecuzione troppo piccola: salto il turno.'}
 return {...plan,writes,reads,allowed:true,reason:'Budget disponibile.'}
}
