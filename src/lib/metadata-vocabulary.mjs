// Canonical card metadata (stage, Pokémon type, card type, rarity, category):
// each source writes the same value in its own language (stage:basis,
// stage:base, stage:basic). The vocabulary maps every variant to one code
// with an Italian label, and gives back all variants of a code for searches
// and filters, so stored tags never need rewriting.
import data from '../../data/metadata-vocabulary.json' with {type:'json'}
const canonical=new Map(),variants=new Map(),labels=new Map()
for(const items of Object.values(data.families))for(const {code,label,aliases} of items){labels.set(code,label);variants.set(code,[...new Set([code,...aliases])]);for(const a of aliases)canonical.set(a,code)}
export const METADATA_FAMILIES=Object.keys(data.families)
export const canonicalTag=tag=>canonical.get(String(tag))||String(tag)
export const tagVariants=code=>variants.get(code)||[code]
export const tagLabel=code=>labels.get(canonicalTag(code))||null
export const familyOptions=family=>(data.families[family]||[]).map(({code,label})=>({code,label}))
export const canonicalTags=tags=>[...new Set((tags||[]).map(canonicalTag))]
