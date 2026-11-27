// Official Japanese card database (www.pokemon-card.com): photos for the
// Japanese promo cards (SM-P, XY-P, S-P, ...). The source never creates cards:
// an official promo is attached to the catalog card with the same promo set
// and number only when the card's name is the same Pokémon (Japanese names are
// mapped through the PokeAPI species table), and its photo is used only where
// the catalog card has none.
import {readFileSync} from 'node:fs'
import {persistEvidence} from './supplemental-sources.mjs'
const check=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
const SPECIES=JSON.parse(readFileSync(new URL('../data/species-names-ja.json',import.meta.url),'utf8'))
const JA_NAMES=Object.keys(SPECIES).sort((a,b)=>b.length-a.length)
export const BASE='https://www.pokemon-card.com'
export const resultUrl=page=>`${BASE}/card-search/resultAPI.php?keyword=&se_ta=&regulation_sidebar_form=all&pg=&illust=&sm_and_keyword=true&page=${page}`
export const detailUrl=id=>`${BASE}/card-search/details.php/card/${id}/regu/all`
// Promo images live in folders such as SMP, SMP2, XYP, S-P, SV-P, M-P,
// MMB-P, DPtP, SVP1 (seen in the Card Atlas copy of the official site). The
// detail page confirms the promo number (007 / SM-P) anyway.
export const isPromoFolder=thumb=>/^(?:[A-Z][A-Za-z0-9]*-P|[A-Z][A-Za-z]+P)\d*$/.test(String(thumb||'').split('/').at(-2)||'')
const fold=s=>String(s||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase()
export function detailNumber(html){
 const text=String(html||'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ')
 const m=text.match(/(\d{1,3})\s*\/\s*([A-Z]{1,4}-P)(?![A-Za-z])/)
 return m?{number:String(Number(m[1])),set:m[2]}:null
}
// true: same Pokémon; false: a different one; null: no Pokémon name to compare.
export function sameSpecies(jaName,cardName){
 const found=[];let rest=String(jaName||'')
 for(const ja of JA_NAMES)if(rest.includes(ja)){found.push(ja);rest=rest.split(ja).join(' ')}
 if(!found.length)return null
 const target=fold(cardName)
 // Whole words only, so that Mew does not match Mewtwo.
 const word=name=>new RegExp(`(^|[^\\p{L}])${fold(name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}($|[^\\p{L}])`,'u')
 return found.some(ja=>SPECIES[ja].some(name=>word(name).test(target)))
}
export function officialRecord(card,html){
 const where=detailNumber(html);if(!where)return null
 const id=String(card.cardID),thumb=String(card.cardThumbFile||'')
 if(!/^\d+$/.test(id)||!thumb.startsWith('/assets/images/card_images/'))return null
 const name=String(card.cardNameAltText||card.cardNameViewText||'').trim()
 return {uid:`pokemon-card-jp:${id}`,lang:'ja',language:'JP',set:where.set,number:where.number,denominator:null,name,image:BASE+thumb,url:detailUrl(id),provider:'pokemon-card-jp',search:'official promo',payload:{official_source:true}}
}
export async function persistOfficialPromos(db,records){
 const stats={added:0,changed:0,photos:0,unmatched:0}
 if(!records.length)return stats
 const known=new Map()
 for(const row of await check(db.from('catalog_search_entries').select('entry_key,card_id').in('entry_key',records.map(r=>r.uid))))if(row.card_id)known.set(row.entry_key,row.card_id)
 const bySet=new Map()
 for(const r of records)if(!known.has(r.uid)){const k=`${r.set}@JP`;if(!bySet.has(k))bySet.set(k,[]);bySet.get(k).push(r)}
 const photos=new Map()
 for(const [sigla,list] of bySet){
  const rows=await check(db.from('cards').select('id,nome,numero,image_status').eq('sigla',sigla).eq('lingua','JP').in('numero',[...new Set(list.map(r=>Number(r.number)))]).limit(1000))
  for(const r of list){
   const matches=rows.filter(c=>c.numero===Number(r.number)&&sameSpecies(r.name,c.nome)===true)
   if(matches.length!==1){stats.unmatched++;continue}
   known.set(r.uid,matches[0].id)
   if(matches[0].image_status!=='found'&&!photos.has(matches[0].id))photos.set(matches[0].id,r.image)
  }
 }
 for(const [id,image] of photos){await check(db.from('cards').update({image_url:image,image_status:'found',image_source:'pokemon-card-jp',image_last_error:null}).eq('id',id).neq('image_status','found'));stats.photos++}
 const linked=records.filter(r=>known.has(r.uid))
 const saved=await persistEvidence(db,linked,{linked:known})
 stats.changed=saved.changed
 return stats
}
