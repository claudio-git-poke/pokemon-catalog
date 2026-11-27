// Finds the set sheet of a catalog set code (the cards' `sigla`) in
// data/set-sheets.json. Shared by the site and scripts/build-set-sheets.mjs.
// Codes are compared without separators: the catalog writes SM-P where the
// sources write SMP.
export const looseKey=sigla=>String(sigla||'').toUpperCase().replace(/[\s._-]/g,'')
export function sheetLookup(sheets){
 const loose=new Map()
 for(const [k,s] of Object.entries(sheets)){const l=looseKey(k);if(!loose.has(l)||s.source==='tcgdex')loose.set(l,k)}
 // TCGdex also gives the official abbreviation (AQ for ecard2): a weaker alias.
 for(const [k,s] of Object.entries(sheets))if(s.abbreviation){const l=looseKey(`${s.abbreviation}@${s.language}`);if(!loose.has(l))loose.set(l,k)}
 const find=k=>sheets[k]?k:loose.get(looseKey(k))||null
 return sigla=>{
  const k=String(sigla||'').trim().toUpperCase(),own=find(k),[code,lang]=k.split('@')
  const origin=!lang?[]:['KOR','CHN-T','CHN','TH','ID'].includes(lang)?['JP']:lang==='JP'?[]:['INT','EN']
  const base=origin.map(from=>find(`${code}@${from}`)).find(Boolean)||null
  if(own){
   const sheet=own===k?{...sheets[own]}:{...sheets[own],matched_as:own}
   // A sheet without name or date borrows them from the original edition.
   if(base&&(!sheet.name||!sheet.release_date)){const b=sheets[base];for(const f of ['name','series','release_date'])if(!sheet[f]&&b[f])sheet[f]=b[f];sheet.filled_from=base}
   return sheet
  }
  return base?{...sheets[base],language:lang,derived_from:base}:null
 }
}
