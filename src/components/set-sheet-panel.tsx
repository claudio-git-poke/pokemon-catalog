'use client'
// Set sheet of a card: name, series, release date and card totals, from
// data/set-sheets.json (TCGdex, Card Atlas, Limitless).
import Link from 'next/link'
import {useSetSheets} from '@/lib/use-set-sheets'
const SOURCES:Record<string,string>={tcgdex:'TCGdex',atlas:'archivio ufficiale (Card Atlas)',limitless:'Limitless'}
const date=(d?:string|null)=>d?new Date(d+'T00:00:00Z').toLocaleDateString('it-IT',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}):null
export default function SetSheetPanel({code}:{code:string}){
 const sheet=useSetSheets([code])(code)
 if(!sheet)return null
 const count=sheet.official&&sheet.total&&sheet.total!==sheet.official?`${sheet.official} ufficiali · ${sheet.total} in totale`:sheet.total||sheet.official?`${sheet.total||sheet.official} carte`:null
 const borrowed=sheet.derived_from||sheet.filled_from
 return <section className="bg-white rounded-xl shadow p-6 space-y-2" aria-label="Scheda del set">
  <h2 className="font-semibold">Set</h2>
  <div className="flex items-center gap-3">
   {sheet.logo&&<img src={`${sheet.logo}.png`} alt="" className="h-10 w-auto" loading="lazy"/>}
   <div><p className="font-medium">{sheet.name||code}</p>{sheet.series&&<p className="text-sm text-gray-500">{sheet.series}</p>}</div>
  </div>
  <div className="grid grid-cols-2 gap-2 text-sm">
   {date(sheet.release_date)&&<div><span className="text-gray-500">Uscita:</span> {date(sheet.release_date)}</div>}
   {count&&<div><span className="text-gray-500">Carte nel set:</span> {count}</div>}
  </div>
  <p className="text-xs text-gray-500">{sheet.also_from?.length?'Fonti':'Fonte'}: {[sheet.source,...(sheet.also_from||[])].map(s=>SOURCES[s]||s).join(', ')}{borrowed?` · dati presi dall’edizione ${borrowed}`:''}. <Link className="underline" href={`/carte?set=${encodeURIComponent(code)}`}>Tutte le carte di questo set</Link></p>
 </section>
}
