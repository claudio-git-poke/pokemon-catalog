// Legacy Japanese promo cards (no source, from the original catalog) carry a
// running number instead of the printed one. The same cards exist with the
// right number and the official photo in the Card Atlas promo sets. A legacy
// card is merged into the official card only when exactly one official card
// within a few numbers is the same Pokémon; the others are flagged.
import {sameCard,speciesOf} from './twin-traits.mjs'
export const LEGACY_SETS={'SM-P@JP':'SMP@JP','XY-P@JP':'XYP@JP','DP-P@JP':'DPP@JP','S-P@JP':'S-P@JP'}
export const WINDOW=8
export function planLegacyPromos(cards){
 const merges=[],flags=[]
 for(const [legacy,official] of Object.entries(LEGACY_SETS)){
  const targets=cards.filter(c=>c.sigla===official&&String(c.source_uid||'').startsWith('atlas:'))
  for(const card of cards.filter(c=>c.sigla===legacy&&!c.source_uid)){
   if(card.manual_overrides&&Object.keys(card.manual_overrides).length)continue
   const found=speciesOf(card.nome).size?targets.filter(t=>Math.abs(t.numero-card.numero)<=WINDOW&&sameCard(card.nome,t.nome,{promo:true})):[]
   if(found.length===1)merges.push({dup:card,keep:found[0]});else flags.push(card)
  }
 }
 return {merges,flags}
}
export async function runLegacyPromos({db,dryRun=true,log=console.log}){
 const check=async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data}
 const sets=[...Object.keys(LEGACY_SETS),...Object.values(LEGACY_SETS)]
 const cards=await check(db.from('cards').select('id,sigla,numero,nome,source_uid,manual_overrides').in('sigla',sets).limit(5000))
 const {merges,flags}=planLegacyPromos(cards)
 await log(`Promo giapponesi vecchie: ${merges.length} da unire alla carta ufficiale, ${flags.length} da verificare${dryRun?' (prova, nessuna modifica)':''}.`)
 if(dryRun)return {merges:merges.length,flags:flags.length}
 for(const {dup,keep} of merges){
  await check(db.from('catalog_search_entries').update({card_id:keep.id}).eq('card_id',dup.id).neq('entry_key','card:'+dup.id))
  await check(db.from('catalog_printing_inventory').update({card_id:keep.id}).eq('card_id',dup.id))
  await check(db.from('catalog_packaging_links').delete().eq('card_id',dup.id))
  await check(db.from('cards').delete().eq('id',dup.id))
 }
 for(let i=0;i<flags.length;i+=200)await check(db.from('catalog_search_entries').upsert(flags.slice(i,i+200).map(c=>({entry_key:'legacy:'+c.id,card_id:c.id,name:c.nome||'',set_code:c.sigla,language:'JP',tags:['status:numero-da-verificare'],facts:{},verification:'catalog',label:'Numero da verificare: carta del catalogo originale',search_text:`${c.nome||''} ${c.sigla} numero da verificare`.toLowerCase(),source_payload:{provider:'legacy-check'}})),{onConflict:'entry_key'}))
 return {merges:merges.length,flags:flags.length}
}
