import {readFileSync} from 'node:fs'
import {normalizeSearch} from '../src/lib/catalog-identification.ts'
const dictionary=JSON.parse(readFileSync(new URL('../data/catalog-metadata-aliases.json',import.meta.url),'utf8')).languages
const slug=value=>normalizeSearch(String(value)).replaceAll(' ','-')
export function canonicalMetadataValue(field,value,language='en'){
 if(typeof value!=='string')return null
 const key=normalizeSearch(value)
 return dictionary[language]?.[field]?.[key]||dictionary.en[field]?.[key]||null
}
export function searchableMetadataTags(detail,language='en'){
 const tags=[]
 for(const type of Array.isArray(detail.types)?detail.types:[]){
  if(typeof type!=='string'||!slug(type))continue
  tags.push('type:'+slug(type));const canonical=canonicalMetadataValue('types',type,language)
  if(canonical)tags.push('type:'+slug(canonical))
 }
 if(typeof detail.regulationMark==='string'&&/^[A-Z]$/.test(detail.regulationMark))tags.push('regulation:'+detail.regulationMark.toLowerCase())
 if(Number.isInteger(detail.hp)&&detail.hp>=0&&detail.hp<=9999)tags.push('hp:'+detail.hp)
 if(typeof detail.illustrator==='string'&&detail.illustrator.length<=300&&slug(detail.illustrator))tags.push('illustrator:'+slug(detail.illustrator))
 const stage=canonicalMetadataValue('stage',detail.stage,language)
 if(typeof detail.stage==='string'&&slug(detail.stage))tags.push('stage:'+slug(detail.stage))
 if(stage){
  tags.push('stage:'+({Stage1:'stage-1',Stage2:'stage-2'}[stage]||slug(stage)))
  if(['VMAX','VSTAR','BREAK','V-UNION'].includes(stage))tags.push('category:'+slug(stage))
 }
 const suffix=canonicalMetadataValue('suffix',detail.suffix,language)
 if(suffix==='TAG TEAM-GX')tags.push('category:tag-team','category:gx')
 else if(suffix)tags.push('category:'+slug(suffix))
 const rarity=canonicalMetadataValue('rarity',detail.rarity,language)
 if(rarity==='ACE SPEC Rare'||canonicalMetadataValue('trainerType',detail.trainerType,language)==='Ace Spec')tags.push('category:ace-spec')
 if(rarity==='Radiant Rare')tags.push('category:radiant')
 // These are literal marks in the SOURCE card name, not inferred foil or texture.
 if(rarity==='Prism Star'||typeof detail.name==='string'&&detail.name.includes('◇'))tags.push('category:prism-star')
 if(typeof detail.name==='string'&&detail.name.includes('☆'))tags.push('category:gold-star')
 return [...new Set(tags)].sort()
}
export function metadataPayload(detail,language){
 const result={id:detail.id,source_language:language}
 for(const key of ['localId','rarity','types','regulationMark','stage','hp','illustrator','suffix','trainerType','energyType','set'])result[key]=detail[key]??null
 if(typeof detail.name==='string')result.source_name=detail.name
 return result
}
