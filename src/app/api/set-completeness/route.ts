// Completeness of every catalogue set (weekly data/set-completeness.json)
// with the name and year of its set sheet. No database reads.
import data from '../../../../data/set-completeness.json'
import sheetsData from '../../../../data/set-sheets.json'
import {sheetLookup} from '@/lib/set-sheet-lookup.mjs'
type Row={sigla:string,lingua:string,cards:number,expected:number|null,missing:number|null,missing_numbers?:number[],with_photo:number,with_traits:number}
const find=sheetLookup((sheetsData as {sets:Record<string,unknown>}).sets) as (code:string)=>{name?:string|null,release_date?:string|null,series?:string|null}|null
const rows=(data as {sets:Row[]}).sets.map(r=>{const s=find(r.sigla);return {...r,name:s?.name||null,series:s?.series||null,year:s?.release_date?.slice(0,4)||null}})
export function GET(){return Response.json({generated_at:(data as {generated_at:string}).generated_at,sets:rows},{headers:{'cache-control':'public, max-age=3600, s-maxage=86400'}})}
