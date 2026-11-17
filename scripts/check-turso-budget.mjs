import {appendFile} from 'node:fs/promises'
import {readTursoUsage,planBudget} from './turso-budget.mjs'
import {safeTursoError} from './turso-client.mjs'
// Prints the budget of this run and exposes it to the following workflow steps.
// Missing credentials or an unreadable usage report mean "do not write".
let plan
try{
 const usage=await readTursoUsage({token:process.env.TURSO_API_TOKEN?.trim(),organization:process.env.TURSO_ORGANIZATION?.trim()})
 plan=planBudget(usage,{resetDay:Number(process.env.TURSO_RESET_DAY||1),runsPerDay:Number(process.env.TURSO_RUNS_PER_DAY||2)})
}catch(error){plan={allowed:false,writes:0,reads:0,reason:safeTursoError(error)}}
console.log(JSON.stringify({check:'turso-budget',...plan}))
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`allowed=${plan.allowed}\nwrites=${plan.writes}\nreads=${plan.reads}\n`)
if(!plan.allowed)console.log('Nessuna scrittura su Turso in questa esecuzione: '+plan.reason)
