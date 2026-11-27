// Traits from "twin" cards: the same printing (same set, same collector
// number) documented in another language. Rarity, Pokémon type, HP, stage,
// illustrator, regulation mark, category (ex, V, GX...) and card type do not
// change with the language, so a card without any of them borrows them from
// its twins. Finish, stamps, sizes and variants are never copied. A photo is
// borrowed only from a twin in the same language.
// Western and Asian editions are kept apart: their numbering differs.
import {readFileSync} from 'node:fs'
import {sheetLookup,looseKey} from '../src/lib/set-sheet-lookup.mjs'

const SPECIES=JSON.parse(readFileSync(new URL('../data/species-names.json',import.meta.url),'utf8'))
export const FAMILIES=['rarity','type','hp','stage','illustrator','regulation','category','card-type']
const ASIA=new Set(['JP','KOR','CHN-T','CHN','TH','ID'])
const WESTERN_FIRST=['INT','EN']
export const fold=s=>String(s||'').normalize('NFKC').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').normalize('NFC')

// Pokémon species named in a card name, in any language of the PokeAPI table.
export function speciesOf(name){
 const f=fold(name),found=new Set()
 const words=f.split(/[^\p{L}\p{N}'.-]+/u).filter(Boolean)
 for(let i=0;i<words.length;i++){
  let hit=false
  for(let n=3;n>=1&&!hit;n--){const w=words.slice(i,i+n).join(' ');if(SPECIES[w]){found.add(SPECIES[w]);hit=true}}
  // Pikachu-EX, Glurak-GX: the species is the part before the suffix.
  if(!hit&&words[i].includes('-'))for(const part of words[i].split('-'))if(SPECIES[part])found.add(SPECIES[part])
 }
 for(const run of f.match(/[\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}\p{Script=Hangul}ー・]+/gu)||[]){
  let i=0
  while(i<run.length){let hit=0;for(let n=Math.min(8,run.length-i);n>=2;n--){const s=run.slice(i,i+n);if(SPECIES[s]){found.add(SPECIES[s]);hit=n;break}}i+=hit||1}
 }
 return found
}
const unreadable=name=>/\p{Script=Thai}/u.test(String(name||''))
// Two names of the same printing: the same Pokémon, or no Pokémon at all
// (trainers, energies). In promo sets one number can hide different cards,
// so there the Pokémon must be recognised on both sides.
export function sameCard(a,b,{promo=false}={}){
 const sa=speciesOf(a),sb=speciesOf(b)
 if(sa.size&&sb.size)return sa.size===sb.size&&[...sa].every(x=>sb.has(x))
 if(promo)return false
 if(sa.size||sb.size)return unreadable(a)||unreadable(b)
 return true
}
export function cardNumber(card){
 let v=String(card.source_local_id||'').trim()
 if(!v||/^UNNUMBERED/i.test(v))v=card.numero>0?String(card.numero):''
 return v.split('/')[0].toUpperCase().replace(/^0+(?=\d)/,'').replace(/^([A-Z]+)0+(?=\d)/,'$1')
}
export function printingKeys(sheets){
 const find=sheetLookup(sheets),abbr=new Map()
 for(const s of Object.values(sheets))if(s.source==='tcgdex'&&s.abbreviation)abbr.set(looseKey(s.abbreviation),looseKey(s.code))
 const cache=new Map()
 const setKey=sigla=>{
  if(cache.has(sigla))return cache.get(sigla)
  const [code,lang]=String(sigla||'').toUpperCase().split('@');let key=null
  if(code&&lang){const sh=find(sigla),from=sh?.matched_as||sh?.derived_from;let c=looseKey(from?from.split('@')[0]:sh?.source==='tcgdex'?sh.code:code);c=abbr.get(c)||c;key=(ASIA.has(lang)?'A:':'W:')+c}
  cache.set(sigla,key);return key
 }
 return card=>{const s=setKey(card.sigla),n=cardNumber(card);return s&&n?`${s}#${n}`:null}
}
// Promo sets (SMP, SM-P, SVP1...) and anything named promo: stricter matching.
const isPromo=key=>{const code=String(key).split('#')[0].slice(2);return /P\d*$/.test(code)||code.includes('PROMO')}
const familyOf=tag=>String(tag).split(':')[0]

// cards: [{id,sigla,lingua,numero,source_local_id,nome,image_status,image_url}]
// tags: Map card id -> array of tags from its own sources (twin entries excluded)
export function planTwinTraits({cards,tags,sheets}){
 const keyOf=printingKeys(sheets),byKey=new Map(),keys=new Map()
 const core=id=>(tags.get(id)||[]).filter(t=>FAMILIES.includes(familyOf(t)))
 for(const c of cards){const k=keyOf(c);keys.set(c.id,k);if(!k)continue;if(!byKey.has(k))byKey.set(k,[]);byKey.get(k).push(c)}
 const entries=[],photos=[],stats={without_traits:0,with_twin:0,rejected_names:0,photos:0}
 for(const card of cards){
  const k=keys.get(card.id);if(!k)continue
  const promo=isPromo(k),group=byKey.get(k)
  if(!core(card.id).length){
   stats.without_traits++
   const refs=group.filter(r=>r.id!==card.id&&core(r.id).length)
   const twins=refs.filter(r=>sameCard(card.nome,r.nome,{promo}))
   if(refs.length&&!twins.length)stats.rejected_names++
   if(twins.length){
    // English editions first; a family is copied only if the twins agree.
    const ranked=[...twins].sort((a,b)=>(WESTERN_FIRST.includes(b.lingua)-WESTERN_FIRST.includes(a.lingua))||a.id-b.id)
    const best=ranked.filter(r=>WESTERN_FIRST.includes(r.lingua)).length?ranked.filter(r=>WESTERN_FIRST.includes(r.lingua)):ranked
    const copied=[]
    for(const family of FAMILIES){
     const values=best.map(r=>core(r.id).filter(t=>familyOf(t)===family).sort().join('|')).filter(Boolean)
     if(values.length&&values.every(v=>v===values[0]))copied.push(...values[0].split('|'))
    }
    if(copied.length){stats.with_twin++;entries.push({card,tags:[...new Set(copied)].sort(),from:best.map(r=>r.id)})}
   }
  }
  if(card.image_status!=='found'){
   const donor=group.filter(r=>r.id!==card.id&&r.lingua===card.lingua&&r.image_status==='found'&&r.image_url&&speciesOf(r.nome).size&&sameCard(card.nome,r.nome,{promo:true})).sort((a,b)=>a.id-b.id)[0]
   if(donor){photos.push({card,donor});stats.photos++}
  }
 }
 return {entries,photos,stats}
}
export function twinEntry({card,tags,from}){
 return {entry_key:`twin:${card.id}`,card_id:card.id,name:card.nome||'',set_code:card.sigla,language:card.lingua,collector_number:cardNumber(card)||null,
  tags,facts:{},source_url:null,verification:'catalog',image_url:null,
  source_payload:{provider:'twin',metadata_scope:'card-metadata-only',from_card_ids:from.slice(0,10),families:[...new Set(tags.map(familyOf))]},
  label:'Dati della stessa carta in un’altra lingua',search_text:`${card.nome||''} ${card.sigla} ${cardNumber(card)} ${tags.join(' ')}`.toLowerCase()}
}
