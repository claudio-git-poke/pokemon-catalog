import {OBSERVATIONS,type Observations,type ObservationKey} from './catalog-identification.ts'

export type IdentificationMatch={deck_code?:string|null;deck_number?:number|null;entry_key:string;card_id:number;name:string;set_code:string;language:string;collector_number:string|null;denominator:string|null;release_year:number|null;image_url:string|null;reference_image_url:string|null;label:string;verification:string;tags:string[];known_facts:Record<string,boolean>;matched:number;contradicted:number;unknown:number;source_url:string|null}
export function explainObservations(facts:Record<string,boolean>,observations:Observations){
 const groups:{matched:{key:ObservationKey;text:string;answer:boolean}[];different:{key:ObservationKey;text:string;answer:boolean}[];unknown:{key:ObservationKey;text:string;answer:boolean}[]}={matched:[],different:[],unknown:[]}
 for(const [key,text] of OBSERVATIONS){const answer=observations[key];if(typeof answer!=='boolean')continue;const item={key,text,answer};if(typeof facts[key]!=='boolean')groups.unknown.push(item);else if(facts[key]===answer)groups.matched.push(item);else groups.different.push(item)}
 return groups
}
export function suggestObservation(matches:Pick<IdentificationMatch,'known_facts'>[],observations:Observations,skipped:ObservationKey[]=[]){
 // Counts describe only the visible result page, never the entire catalogue.
 const candidates=OBSERVATIONS.filter(([key])=>typeof observations[key]!=='boolean'&&!skipped.includes(key)).map(([key,text],order)=>{
  let yes=0,no=0,unknown=0
  for(const m of matches){if(m.known_facts[key]===true)yes++;else if(m.known_facts[key]===false)no++;else unknown++}
  return {key,text,yes,no,unknown,total:matches.length,order,score:Math.min(yes,no)}
 }).filter(c=>c.yes>0&&c.no>0).sort((a,b)=>b.score-a.score||a.unknown-b.unknown||a.order-b.order)
 return candidates[0]||null
}
export function evidenceSource(value:string|null){
 try{const u=new URL(value||'');return u.protocol==='https:'&&!u.username&&!u.password?{url:u.href,host:u.hostname}:null}catch{return null}
}
export function resultPhoto(match:Pick<IdentificationMatch,'image_url'|'reference_image_url'>,broken=false){
 if(broken)return {url:null,label:'Foto non disponibile',reference:false}
 if(match.image_url)return {url:match.image_url,label:'Foto associata alla stampa',reference:false}
 if(match.reference_image_url)return {url:match.reference_image_url,label:'Immagine di riferimento',reference:true}
 return {url:null,label:'Senza foto',reference:false}
}
