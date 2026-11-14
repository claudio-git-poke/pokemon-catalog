// Refresh against the reviewed upstream interface snapshot; no cards are inferred from a term.
import {readFile,writeFile} from 'node:fs/promises'
const root=new URL('../',import.meta.url),text=await readFile(new URL('scripts/sources/tcgdex-variant-types.d.ts',root),'utf8')
const terms=JSON.parse(await readFile(new URL('data/catalog-taxonomy.json',root),'utf8'))
const quoted=s=>[...s.matchAll(/['"]([a-z0-9-]+)['"]/g)].map(m=>m[1])
const sections=[['stamp',text.split('export type VariantStamps =')[1].split('export interface variant_detailed')[0]],['subtype',text.split('subtype?:')[1].split('/**')[0]],['pattern',text.split('foil?:')[1].split('/**')[0]],['finish',text.split('export type VariantType =')[1].split('export type VariantStamps')[0]]]
for(const[kind,section]of sections)for(const id of new Set(quoted(section))){if(!terms.some(t=>t.code===`${kind}:${id}`))terms.push({code:`${kind}:${id}`,label:id.replaceAll('-',' '),kind,aliases:[id.replaceAll('-',' ')],parents:kind==='pattern'?['visual:shiny']:[]})}
for(const t of terms)if(t.code==='family:battle-academy'&&!t.aliases.includes('ba'))t.aliases.push('ba')
const galaxy=terms.find(t=>t.code==='pattern:galaxy');if(galaxy)galaxy.parents=['pattern:cosmos','visual:shiny']
await writeFile(new URL('data/catalog-taxonomy.json',root),JSON.stringify(terms,null,2)+'\n')
await writeFile(new URL('src/lib/catalog-taxonomy.ts',root),'// Generated from data/catalog-taxonomy.json.\nexport const TAXONOMY = '+JSON.stringify(terms,null,2)+' as const\n')
const q=x=>"'"+x.replaceAll("'","''")+"'",a=xs=>'array['+xs.map(q).join(',')+']::text[]'
await writeFile(new URL('db/catalog-taxonomy-expanded.sql',root),terms.map(t=>`insert into public.catalog_terms(code,label,kind,aliases,parents) values(${q(t.code)},${q(t.label)},${q(t.kind)},${a(t.aliases)},${a(t.parents)}) on conflict(code) do update set label=excluded.label,aliases=excluded.aliases,parents=excluded.parents;`).join('\n')+'\n')
console.log(`${terms.length} terms, ${sections.map(([k,s])=>k+': '+new Set(quoted(s)).size).join(', ')}`)
