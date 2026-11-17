import {writeFile} from 'node:fs/promises'
export const SOURCE_WORKFLOWS=['atlas-tags.yml','card-metadata-repair.yml','catalog-comparisons.yml','catalog-sync.yml','catalog-tags.yml','coverage-audit.yml','packaging-catalog.yml','printing-inventory.yml','research-sources.yml','source-manifest-audit.yml','special-release-audit.yml','supplemental-sources.yml','visual-assets.yml']
export async function freezeSourceWorkers({token,repo,runId,fetcher=fetch,log=console.log,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(repo!=='claudio-git-poke/pokemon-catalog'||!token)throw Error('Configurazione GitHub per la migrazione non valida.')
 const base='https://api.github.com/repos/'+repo
 async function api(path,method='GET'){
  const r=await fetcher(base+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(20000)})
  if(!r.ok&&!(method==='POST'&&path.endsWith('/cancel')&&[409,422].includes(r.status)))throw Error('GitHub: impossibile sospendere gli importatori (HTTP '+r.status+').')
  const body=await r.text();return body?JSON.parse(body):null
 }
 const workflows=[],ids=new Set()
 for(const file of SOURCE_WORKFLOWS){
  const w=await api('/actions/workflows/'+file);ids.add(w.id);workflows.push({id:w.id,file,state:w.state})
  if(w.state==='active')await api('/actions/workflows/'+w.id+'/disable','PUT')
 }
 let cancelled=0
 for(const status of ['in_progress','queued','waiting','pending','requested']){
  const runs=await api('/actions/runs?per_page=100&status='+status)
  for(const run of runs.workflow_runs||[]){
   if(String(run.id)===String(runId)||!ids.has(run.workflow_id))continue
   await api('/actions/runs/'+run.id+'/cancel','POST');cancelled++
  }
 }
 for(let attempt=0;attempt<12;attempt++){
  const runs=await api('/actions/runs?per_page=100&status=in_progress')
  if(!(runs.workflow_runs||[]).some(r=>ids.has(r.workflow_id))){log(JSON.stringify({phase:'source-workers-paused',workflows:workflows.length,cancelled}));return {workflows,cancelled}}
  await wait(5000)
 }
 throw Error('Un importatore Supabase è ancora attivo: copia rinviata per conservare una fonte stabile.')
}
if(import.meta.url===`file://${process.argv[1]}`){
 try{const result=await freezeSourceWorkers({token:process.env.GH_ACTIONS_TOKEN,repo:process.env.GITHUB_REPOSITORY,runId:process.env.GITHUB_RUN_ID});await writeFile('turso-paused-workflows.json',JSON.stringify(result,null,2))}
 catch(error){console.error(error.message);process.exitCode=1}
}
