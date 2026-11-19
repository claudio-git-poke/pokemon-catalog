import {appendFile} from 'node:fs/promises'
import {readTursoUsage,planBudget} from './turso-budget.mjs'
import {safeTursoError} from './turso-client.mjs'
import {createPlatform,platformConfiguration} from './turso-platform.mjs'
// Prints the budget of this run and exposes it to the following workflow steps.
// Missing credentials or an unreadable usage report mean "do not write".
let plan
// A higher stop ratio can be granted until a given date (for example the end of
// a month with quota left); afterwards the default 80% applies again.
// Faster spending of the current month, valid only until the given date (the
// quota reset): afterwards the default even spread and run cap apply again.
function frontLoad(env=process.env,now=Date.now()){
 const until=Date.parse(env.TURSO_FRONT_LOAD_UNTIL||''),spendBy=Date.parse(env.TURSO_SPEND_BY||'')
 if(!Number.isFinite(until)||now>=until||!Number.isFinite(spendBy)||spendBy>=until)return {}
 const cap=Number(env.TURSO_MAX_RUN_WRITES)
 return {spendBy,...(Number.isSafeInteger(cap)&&cap>0&&cap<=1_000_000?{maxRunWrites:cap}:{})}
}
function stopRatio(env=process.env,now=Date.now()){
 const ratio=Number(env.TURSO_STOP_RATIO),until=Date.parse(env.TURSO_STOP_RATIO_UNTIL||'')
 return ratio>0&&ratio<=0.9&&Number.isFinite(until)&&now<until?ratio:0.8
}
// Measured real rows written per estimated write (TURSO_ESTIMATE_RATIO).
function estimateRatio(env=process.env){const r=Number(env.TURSO_ESTIMATE_RATIO);return r>=0.5&&r<=1?{estimateRatio:r}:{}}
// Final days of a month: a higher stop (at most 95%) with smaller runs, so a
// delayed usage counter can never push the account past the free limit.
function endgame(env=process.env,now=Date.now()){
 const ratio=Number(env.TURSO_ENDGAME_RATIO),from=Date.parse(env.TURSO_ENDGAME_FROM||''),until=Date.parse(env.TURSO_STOP_RATIO_UNTIL||''),cap=Number(env.TURSO_ENDGAME_MAX_RUN_WRITES)
 if(!(ratio>0.8&&ratio<=0.95)||!Number.isFinite(from)||!Number.isFinite(until)||now<from||now>=until||!(Number.isSafeInteger(cap)&&cap>0&&cap<=300_000))return {}
 return {stopRatio:ratio,maxRunWrites:cap}
}
// Start of the previous completed worker run, from the GitHub API (the
// scheduler may delay or skip runs). Unknown means an even split per run.
async function previousRunAt(env=process.env){
 const repo=env.GITHUB_REPOSITORY,token=env.GITHUB_TOKEN,workflow=env.TURSO_WORKER_WORKFLOW
 if(!repo||!token||!workflow||!/^[\w.-]+\/[\w.-]+$/.test(repo)||!/^[\w.-]+\.ya?ml$/.test(workflow))return null
 try{
  const response=await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?status=completed&per_page=10`,{headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json'}})
  if(!response.ok)return null
  const run=(await response.json()).workflow_runs?.find(r=>String(r.id)!==String(env.GITHUB_RUN_ID)&&r.conclusion==='success')
  const at=Date.parse(run?.run_started_at||'')
  return Number.isFinite(at)?at:null
 }catch{return null}
}
try{
 const usage=await readTursoUsage({token:process.env.TURSO_API_TOKEN?.trim(),organization:process.env.TURSO_ORGANIZATION?.trim()})
 plan=planBudget(usage,{resetDay:Number(process.env.TURSO_RESET_DAY||1),runsPerDay:Number(process.env.TURSO_RUNS_PER_DAY||2),stopRatio:stopRatio(),...frontLoad(),...endgame(),previousRunAt:await previousRunAt(),...estimateRatio()})
}catch(error){plan={allowed:false,writes:0,reads:0,reason:safeTursoError(error)}}
console.log(JSON.stringify({check:'turso-budget',...plan}))
try{for(const entry of await createPlatform(platformConfiguration()).databaseUsage())console.log(JSON.stringify({check:'turso-database-usage',...entry}))}catch(error){console.log('Dettaglio per database non disponibile: '+safeTursoError(error))}
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`allowed=${plan.allowed}\nwrites=${plan.writes}\nreads=${plan.reads}\n`)
if(!plan.allowed)console.log('Nessuna scrittura su Turso in questa esecuzione: '+plan.reason)
