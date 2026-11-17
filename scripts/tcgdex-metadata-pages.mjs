import {rarityTags} from './card-metadata.mjs'
import {searchableMetadataTags,metadataPayload} from './card-metadata-tags.mjs'
export const METADATA_FIELDS='id localId name rarity types regulationMark stage hp illustrator suffix trainerType energyType set { id name }'
export function metadataQuery(language,page,size=250){
 if(!/^[a-z]{2}(?:-[a-z]{2})?$/.test(language)||!Number.isInteger(page)||page<1||![100,250,500,2000].includes(size))throw Error('Invalid metadata page')
 // filters:{} avoids the upstream resolver treating pagination objects as text filters.
 return `query { cards(filters:{},pagination:{page:${page},itemsPerPage:${size}},sort:{field:"id",order:"ASC"}) @locale(lang:"${language}") { ${METADATA_FIELDS} } }`
}
export function metadataEvidence(language,body,page){
 if(body.errors?.length||!Array.isArray(body.data?.cards))throw Error('Invalid GraphQL metadata response: '+JSON.stringify(body.errors||{}))
 const ids=new Set()
 return body.data.cards.map(card=>{
  if(!card||typeof card.id!=='string'||typeof card.localId!=='string'||!card.set?.id||card.id!==card.set.id+'-'+card.localId||ids.has(card.id)||typeof card.name!=='string')throw Error('Invalid or duplicate source identity in metadata page')
  if(card.types!=null&&(!Array.isArray(card.types)||card.types.some(t=>typeof t!=='string')))throw Error('Invalid card types')
  ids.add(card.id)
  return {source_uid:`tcgdex:${language}:${card.id}`,source_language:language,source_card_id:card.id,
   metadata:metadataPayload(card,language),tags:[...new Set([...rarityTags(card.rarity,language),...searchableMetadataTags(card,language)])].sort(),
   evidence:{method:'tcgdex-graphql',endpoint:'https://api.tcgdex.net/v2/graphql',language,page}}
 })
}
export async function fetchMetadataPage(language,page,size=250,fetcher=fetch){
 for(let attempt=0;;attempt++){
  try{
   const response=await fetcher('https://api.tcgdex.net/v2/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:metadataQuery(language,page,size)}),signal:AbortSignal.timeout(30000)})
   if(!response.ok)throw Object.assign(Error('TCGdex GraphQL HTTP '+response.status),{status:response.status})
   return metadataEvidence(language,await response.json(),page)
  }catch(error){
   if(attempt||error.status&&![429,500,502,503,504].includes(error.status)||/^Invalid/.test(error.message))throw error
   await new Promise(r=>setTimeout(r,750))
  }
 }
}
