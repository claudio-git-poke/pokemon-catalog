// Set sheets for the site: GET ?codes=SV8A@JP,SM-P@JP returns the sheet of each
// code (null when unknown); GET ?list=1 returns the sets with a name, newest
// first, for the expansion filter. Static data from data/set-sheets.json.
import data from '../../../../data/set-sheets.json'
import {sheetLookup} from '@/lib/set-sheet-lookup.mjs'
type Sheet={code:string,language:string,name:string|null,series?:string|null,release_date?:string|null,official?:number|null,total?:number|null,logo?:string|null,source:string,source_url?:string|null,derived_from?:string,filled_from?:string,matched_as?:string,also_from?:string[]}
const sets=(data as {sets:Record<string,Sheet>}).sets
const lookup=sheetLookup(sets) as (code:string)=>Sheet|null
const headers={'cache-control':'public, max-age=3600, s-maxage=86400'}
let list:{code:string,name:string,language:string,release_date:string|null}[]|null=null
export function GET(request:Request){
 const url=new URL(request.url)
 if(url.searchParams.get('list')){
  list??=Object.entries(sets).filter(([,s])=>s.name).map(([code,s])=>({code,name:s.name as string,language:s.language,release_date:s.release_date||null})).sort((a,b)=>(b.release_date||'').localeCompare(a.release_date||'')||a.code.localeCompare(b.code))
  return Response.json({generated_at:(data as {generated_at:string}).generated_at,sets:list},{headers})
 }
 const codes=[...new Set((url.searchParams.get('codes')||'').split(',').map(c=>c.trim()).filter(Boolean))].slice(0,200)
 return Response.json({sheets:Object.fromEntries(codes.map(c=>[c,lookup(c)]))},{headers})
}
