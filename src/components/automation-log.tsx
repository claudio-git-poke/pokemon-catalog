'use client'
// The per-event log is no longer stored in the database: it filled the free
// quota and every second of polling consumed reads. GitHub Actions keeps the
// complete output of each session; the run summary stays on /automazione.
const ACTIONS_URL='https://github.com/claudio-git-poke/pokemon-catalog/actions'
export default function AutomationLog({runId}:{runId:number;onPause?:()=>void}){
 return <div className="space-y-2 text-sm">
  <p>Il registro dettagliato dell’esecuzione #{runId} non è più salvato nel database, per restare nei limiti del piano gratuito.</p>
  <p>Ogni riga di ogni sessione è nei log di GitHub Actions: <a className="underline" href={ACTIONS_URL} target="_blank" rel="noreferrer">apri le esecuzioni</a> e scegli il workflow con la stessa data di avvio. Il riepilogo e l’attività corrente restano visibili qui sopra.</p>
 </div>
}
