import {TAXONOMY} from './catalog-taxonomy.ts'
export type PrintingEvidence={entry_key:string;label:string;tags:string[];facts:Record<string,boolean>;source_url:string|null;release_year:number|null;verification:string;image_url:string|null;updated_at:string;collector_number:string|null;denominator:string|null;deck_code?:string|null;deck_number?:number|null;source_payload?:{metadata_scope?:string;reference_image_only?:boolean;id?:string}}
export const PRINTING_FIELDS=[['finish:','Finitura'],['pattern:','Motivo olografico'],['stamp:','Stampino o firma'],['family:','Famiglia di distribuzione'],['rarity:','Rarità'],['category:','Meccanica della carta'],['regulation:','Regolamento'],['deck:','Mazzo']] as const
export function printingFieldValues(row:PrintingEvidence,prefix:string){
 return [...new Set(row.tags.filter(t=>t.startsWith(prefix)))].sort().map(code=>TAXONOMY.find(t=>t.code===code)?.label||code.slice(prefix.length).replaceAll('-',' '))
}
export function printingScope(row:PrintingEvidence){
 return row.source_payload?.metadata_scope==='card-metadata-only'?'card':'printing'
}
export function comparePrintings(left:PrintingEvidence,right:PrintingEvidence){
 return PRINTING_FIELDS.map(([prefix,label])=>{
  const a=printingFieldValues(left,prefix),b=printingFieldValues(right,prefix)
  return {prefix,label,left:a,right:b,status:!a.length||!b.length?'unknown':JSON.stringify(a)===JSON.stringify(b)?'same':'different'}
 })
}
export function printingLink(url:string,key:string){
 const target=new URL(url);target.searchParams.set('stampa',key);target.hash='stampe';return target.href
}
