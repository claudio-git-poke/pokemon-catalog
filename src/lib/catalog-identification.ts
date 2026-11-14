import { TAXONOMY } from './catalog-taxonomy.ts'
export const normalizeSearch=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ')
export const OBSERVATIONS = [
 ['shiny','La carta luccica quando la inclini?','Inizia'],['extra_mark','Vedi un simbolo o uno stampino aggiuntivo?','Inizia'],['numbered_deck_marks','Vedi piccoli disegni accompagnati da numeri?','Inizia'],['asian_script','Vedi caratteri giapponesi, cinesi, coreani o thailandesi?','Inizia'],
 ['shine_in_artwork','Luccica dentro il riquadro del Pokémon?','Riflessi'],['shine_outside_artwork','Luccica fuori dal riquadro del Pokémon?','Riflessi'],['shine_on_border','Luccicano anche i bordi?','Riflessi'],['shine_full_surface','Luccica quasi tutta la carta?','Riflessi'],['pattern_circles_or_swirls','Vedi cerchi, puntini o vortici?','Riflessi'],['pattern_stars','Vedi stelline nei riflessi?','Riflessi'],['pattern_lines','Vedi linee o strisce nei riflessi?','Riflessi'],['pattern_shards','Vedi frammenti simili a vetro o ghiaccio?','Riflessi'],['pattern_confetti','Vedi piccoli quadratini o coriandoli?','Riflessi'],['pattern_repeated_balls','Vedi tante piccole Ball ripetute?','Riflessi'],['pattern_ball_has_m','Riconosci una M nelle piccole Ball?','Riflessi'],['pattern_energy_symbols','Vedi simboli Energia ripetuti?','Riflessi'],['surface_textured','La superficie ha un rilievo percepibile?','Riflessi'],
 ['mark_top_left','In alto a sinistra','Posizione'],['mark_top_right','In alto a destra','Posizione'],['mark_middle_left','Al centro a sinistra','Posizione'],['mark_middle_right','Al centro a destra','Posizione'],['mark_bottom_left','In basso a sinistra','Posizione'],['mark_bottom_right','In basso a destra','Posizione'],['mark_inside_artwork','Dentro il riquadro dell’illustrazione','Posizione'],['multiple_extra_marks','Vedi più stampini?','Stampini'],
 ['mark_pumpkin_like','Lo stampino sembra una zucca o una faccia di Pikachu?','Stampini'],['mark_pokemon_like','Lo stampino assomiglia a un piccolo Pokémon?','Stampini'],['mark_ball_like','Lo stampino assomiglia a una Poké Ball?','Stampini'],['mark_snowflake_like','Lo stampino sembra un fiocco di neve?','Stampini'],['mark_logo_like','Lo stampino sembra un logo con delle scritte?','Stampini'],['mark_metallic','Lo stampino è dorato o argentato?','Stampini'],['printed_signature_visible','Vedi una firma stampata?','Stampini'],['staff_text_visible','Vedi STAFF?','Stampini'],['winner_text_visible','Vedi WINNER?','Stampini'],['pokemon_center_text_visible','Vedi Pokémon Center?','Stampini'],['first_edition_text_visible','Vedi 1st Edition o Prima Edizione?','Stampini'],
 ['name_has_lv','Nel nome c’è LV. o LV.X?','Carta'],['name_has_ex','Nel nome c’è ex o EX?','Carta'],['name_has_gx','Nel nome c’è GX?','Carta'],['name_has_vmax','Nel nome c’è VMAX?','Carta'],['name_has_vstar','Nel nome c’è VSTAR?','Carta'],['fraction_number_visible','Vedi un numero come 52/198?','Carta'],['collector_number_has_letters','Il numero della carta contiene lettere?','Carta'],['deck_number_visible','C’è un numero vicino a un piccolo disegno?','Carta'],['blue_border_visible','Il bordo è blu?','Carta'],['unusual_back','Il dorso sembra diverso da quello abituale?','Carta'],['full_card_art','L’illustrazione occupa quasi tutta la carta?','Carta'],['oversized','È più grande di una normale carta Pokémon?','Carta']
] as const
export type ObservationKey=typeof OBSERVATIONS[number][0]
export type Observations=Partial<Record<ObservationKey,boolean|null>>
export function parseIdentificationQuery(input:string){
 let text=' '+normalizeSearch(input.slice(0,180))+' '
 const tags:string[]=[],recognized:string[]=[]
 const aliases=TAXONOMY.flatMap(t=>t.aliases.map(alias=>({alias:normalizeSearch(alias),code:t.code,label:t.label}))).sort((a,b)=>b.alias.length-a.alias.length)
 for(const item of aliases){const phrase=' '+item.alias+' ';if(item.alias&&text.includes(phrase)){text=text.split(phrase).join(' ');if(!tags.includes(item.code)){tags.push(item.code);recognized.push(item.label)}}}
 const rawTokens=text.trim().split(/\s+/).filter(Boolean)
 const yearToken=rawTokens.find(t=>/^(19|20)\d{2}$/.test(t))
 const numberToken=rawTokens.find(t=>/^(?:[a-z]{0,4})?\d{1,3}[a-z]?$/.test(t) && t!==yearToken)
 const slash=input.match(/\b([a-z]*\d+[a-z]*)\s*\/\s*(\d+[a-z]*)\b/i)
 const number=slash?.[1]||numberToken||null,denominator=slash?.[2]||null
 const stop=new Set(['carta','carte','pokemon','pokémon','con','una','un','di','del','della','ha','il','la','lo'])
 const tokens=rawTokens.filter(t=>t!==yearToken&&t!==numberToken&&t!==denominator&&!stop.has(t)).slice(0,8)
 return {tags,recognized,tokens,number:number?.replace(/^0+(?=\d)/,'').toLowerCase()||null,denominator,year:yearToken?Number(yearToken):null}
}
export function validateObservations(value:unknown):Observations{
 if(!value || typeof value!=='object' || Array.isArray(value))return {}
 const allowed=new Set(OBSERVATIONS.map(o=>o[0] as string)),out:Observations={}
 for(const[key,v]of Object.entries(value))if(allowed.has(key)&&(v===true||v===false||v===null))out[key as ObservationKey]=v
 return out
}
export function expandTags(values:string[]):string[]{const result=new Set(values);for(const code of result){const term=TAXONOMY.find(t=>t.code===code);for(const parent of term?.parents||[])result.add(parent)}return [...result].sort()}
export function printingFacts(tags:string[],variant:{size?:string;stamp?:string[];subtype?:string}={}){
 const t=new Set(tags),facts:Record<string,boolean>={}
 if(t.has('visual:shiny'))facts.shiny=true
 if(t.has('finish:normal'))facts.shiny=false
 if(variant.size)facts.oversized=variant.size==='jumbo'
 if(variant.stamp?.length)facts.extra_mark=true
 for(const[stamp,key]of [['staff','staff_text_visible'],['winner','winner_text_visible'],['pokemon-center','pokemon_center_text_visible'],['1st-edition','first_edition_text_visible'],['trick-or-trade','mark_pumpkin_like'],['snowflake','mark_snowflake_like'],['pokeball','mark_ball_like']] as const)if(t.has('stamp:'+stamp))facts[key]=true
 if(variant.subtype==='blue-border')facts.blue_border_visible=true
 if(t.has('pattern:cosmos'))facts.pattern_circles_or_swirls=true
 if(t.has('pattern:starlight'))facts.pattern_stars=true
 if(t.has('pattern:cracked-ice'))facts.pattern_shards=true
 if(t.has('pattern:confetti'))facts.pattern_confetti=true
 if(t.has('pattern:energy'))facts.pattern_energy_symbols=true
 if(['tinsel','line'].some(p=>t.has('pattern:'+p)))facts.pattern_lines=true
 if(['pokeball','masterball','loveball','friendball','duskball','quickball'].some(p=>t.has('pattern:'+p)))facts.pattern_repeated_balls=true
 if(t.has('pattern:masterball'))facts.pattern_ball_has_m=true
 // Source metadata rarely certifies stamp coordinates or exact foil coverage. Leave them unknown.
 return facts
}
export type SourceVariant={type?:string;foil?:string;subtype?:string;stamp?:string[];size?:string;variantId?:string;thirdParty?:{tcgplayer?:number;cardmarket?:number};languages?:string[]}
export function sourcePrinting(variant:SourceVariant){
 let tags:string[]=[]
 if(variant.type)tags.push('finish:'+variant.type)
 if(variant.foil)tags.push('pattern:'+variant.foil)
 if(variant.subtype)tags.push('subtype:'+variant.subtype)
 for(const stamp of variant.stamp||[])tags.push('stamp:'+stamp)
 const families:Record<string,string>={'trick-or-trade':'trick-or-trade','pokemon-center':'pokemon-center','pre-release':'prerelease','snowflake':'holiday-calendar','professor-program':'professor-program'}
 for(const stamp of variant.stamp||[]){if(families[stamp])tags.push('family:'+families[stamp]);if(/^worlds-\d{4}$/.test(stamp))tags.push('event:'+stamp)}
 // A Worlds event stamp alone is not proof that this is a World Championships Deck replica.
 tags=expandTags(tags)
 return {tags,facts:printingFacts(tags,variant)}
}
