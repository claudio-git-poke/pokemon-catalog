import {readFile,writeFile,appendFile} from 'node:fs/promises'
import pg from 'pg'
// End of a local-copy run: records how many cards and photos the run added and
// decides whether the chain stops. It stops after STOP_AFTER_QUIET (2)
// consecutive group A runs that each added fewer than QUIET_THRESHOLD (10)
// cards and fewer than QUIET_THRESHOLD photos: the sources have nothing new.
const dir=process.env.LOCAL_COPY_DIR||'/tmp/local-copy',stateFile=dir+'/state.json'
const output=async(key,value)=>{if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`${key}=${value}\n`)}
export function nextQuietState(state,end,{threshold=10,stopAfter=2}={}){
 const start=state.start||end
 const added={cards:end.cards-start.cards,photos:end.photos-start.photos}
 const quiet=added.cards<threshold&&added.photos<threshold
 let quietA=Number(state.quiet_a||0)
 if(state.last_group==='A')quietA=quiet?quietA+1:0
 const history=[...(state.history||[]),{run:state.runs,group:state.last_group,at:state.last_run_at,...end,added_cards:added.cards,added_photos:added.photos}].slice(-60)
 return {state:{...state,end,quiet_a:quietA,history},added,stop:quietA>=stopAfter}
}
// Markdown progress table shown on the run page (Actions → Catalogo locale).
export function progressSummary(state,stop){
 const n=v=>Number(v).toLocaleString('it-IT')
 const rows=(state.history||[]).slice(-30).reverse().map(h=>`| ${h.run} | ${h.group} | ${String(h.at||'').slice(0,16).replace('T',' ')} | ${n(h.cards)} | ${n(h.photos)} | +${n(h.added_cards)} | +${n(h.added_photos)} |`)
 return [`## Avanzamento della copia locale`,``,`**Carte:** ${n(state.end.cards)} · **Con foto:** ${n(state.end.photos)} · **Giri:** ${state.runs}`,``,
  stop?`**La catena si è fermata:** due giri A di fila senza novità. Il file da scaricare è in preparazione.`:`Giri A consecutivi senza novità: ${state.quiet_a||0} su 2.`,``,
  `| Giro | Gruppo | Inizio (UTC) | Carte | Con foto | Carte nuove | Foto nuove |`,`|---|---|---|---|---|---|---|`,...rows,``].join('\n')
}
if(import.meta.url===`file://${process.argv[1]}`){
 const db=new pg.Client({connectionString:process.env.WORKER_PG_URL});await db.connect()
 try{
  const state=JSON.parse(await readFile(stateFile,'utf8'))
  const row=(await db.query('SELECT count(*)::int AS cards,count(image_url)::int AS photos FROM public.cards')).rows[0]
  const result=nextQuietState(state,{cards:row.cards,photos:row.photos},{threshold:Number(process.env.QUIET_THRESHOLD||10),stopAfter:Number(process.env.STOP_AFTER_QUIET||2)})
  await writeFile(stateFile,JSON.stringify(result.state))
  console.log(JSON.stringify({phase:'local-copy-stats',group:state.last_group,run:state.runs,...result.state.end,added:result.added,quiet_a:result.state.quiet_a,stop:result.stop}))
  await output('stop',String(result.stop))
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,progressSummary(result.state,result.stop))
 }finally{await db.end()}
}
