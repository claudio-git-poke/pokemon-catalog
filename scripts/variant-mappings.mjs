import {TAXONOMY} from '../src/lib/catalog-taxonomy.ts'
import {expandTags,normalizeSearch,printingFacts} from '../src/lib/catalog-identification.ts'
const deckPokemon=new Set(['pikachu','bulbasaur','charmander','squirtle'])
// Names used as printed player-signature stamps by the upstream database.
export const SIGNATURES=new Set(['chris-fulop','tsuguyoshi-yamato','reed-weichler','kevin-nguyen','takashi-yoneda','michael-gonzalez','curran-hill','jeremy-maron','jimmy-ballard','miska-saari','hiroki-yano','jason-klaczynski','liao-fu-guan','jeremy-scharff-kim','akira-miyazaki','tom-roos','jun-hasebe','dylan-lefavour','tristan-robinson','paul-atanassov','david-cohen','tsubasa-nakamura','michael-pramawat','mychael-bryan','stephen-silvestro','yuka-furusawa','jason-martinez','yuta-komatsuda','ross-cawthorn','gustavo-wada','christopher-kan','igor-costa','zachary-bokhari','shuto-itagaki','chase-moloney','jesse-parker','gabriel-fernandez','sakuya-ota','shao-tong-yen','jose-cruz-galindo-resendiz'])
export function mapVariant(card,detail,v){
 const set=(detail.set?.id||card.sigla?.split('@')[0]||'').toLowerCase(),stamps=v.stamp||[]
 let tags=expandTags([...(v.type?['finish:'+v.type]:[]),...(v.foil?['pattern:'+v.foil]:[]),...(v.subtype?['subtype:'+v.subtype]:[]),...stamps.map(s=>'stamp:'+s)])
 const facts=printingFacts(tags,v),attributes={}
 const unrecognized=Object.keys(v).filter(k=>!['type','foil','subtype','stamp','stamps','size','variantId','thirdParty','languages'].includes(k));if(unrecognized.length)attributes.unmapped_fields=unrecognized
 if(v.subtype==='cosmos'){tags.push('pattern:cosmos','visual:shiny');facts.pattern_circles_or_swirls=true;facts.shiny=true}
 if(v.type==='normal'&&v.foil){delete facts.shiny;attributes.conflict='normal type with foil pattern; shine unresolved'}
 if(v.size)tags.push('size:'+v.size)
 const signature=stamps.filter(s=>SIGNATURES.has(s)),world=stamps.find(s=>/^worlds-\d{4}$/.test(s))
 if(signature.length){facts.printed_signature_visible=true;attributes.signature=signature}
 if(world){tags.push('event:'+world);attributes.event_year=Number(world.slice(-4))}
 if(world&&signature.length){tags.push('family:world-championships');attributes.release_year=Number(world.slice(-4))}
 for(const[stamp,family]of Object.entries({'trick-or-trade':'trick-or-trade','pre-release':'prerelease','pokemon-center':'pokemon-center','professor-program':'professor-program','countdown-calendar':'holiday-calendar','snowflake':'holiday-calendar'}))if(stamps.includes(stamp))tags.push('family:'+family)
 if(stamps.some(s=>/^(poke|great|ultra|master)-ball-league$/.test(s))||v.foil==='league')tags.push('family:league')
 if(set.startsWith('tk-'))tags.push('family:trainer-kit')
 if(set==='svi'&&['ja','ko'].includes(card.source_language))tags.push('family:battle-academy')
 if(set==='mfb'){
  tags.push('family:my-first-battle');attributes.release_year=2023
  const decks=stamps.filter(s=>deckPokemon.has(s));if(decks.length===1){attributes.deck=decks[0];tags.push('deck:'+decks[0]);facts.mark_pokemon_like=true;facts.mark_bottom_right=true}
  Object.assign(facts,{unusual_back:true,fraction_number_visible:false,collector_number_has_letters:false,numbered_deck_marks:false,deck_number_visible:false,blue_border_visible:v.subtype==='blue-border'})
  if(stamps.includes('pokeball'))facts.mark_inside_artwork=true
 }
 const suffix=detail.suffix?.toLowerCase();if(suffix)tags.push('category:'+suffix)
 if(detail.level!==undefined){facts.name_has_lv=true;tags.push('category:'+(String(detail.level).toUpperCase()==='X'?'lv-x':'lv'))}
 if(['VMAX','VSTAR','BREAK','V-UNION'].includes(detail.stage))tags.push('category:'+detail.stage.toLowerCase())
 // A rarity is searchable metadata; it does not establish texture, foil coverage or an exact scan.
 if(detail.rarity)tags.push('rarity:'+normalizeSearch(detail.rarity).replaceAll(' ','-'))
 return {tags:expandTags(tags),facts,attributes}
}
export function termsForEntries(entries){
 const known=new Map(TAXONOMY.map(t=>[t.code,t])),terms=new Map()
 for(const e of entries)for(const code of e.tags){if(!/^[a-z][a-z-]*:[a-z0-9-]+$/.test(code))continue;const [kind,id]=code.split(':');terms.set(code,known.get(code)||{code,label:id.replaceAll('-',' '),kind,aliases:kind==='deck'?['mazzo '+id.replaceAll('-',' '),id.replaceAll('-',' ')+' deck']:[id.replaceAll('-',' ')],parents:[]})}
 return [...terms.values()]
}
