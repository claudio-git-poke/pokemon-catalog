// Read official translation JSON as data; never execute upstream code.
import {readFile,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {normalizeSearch} from '../src/lib/catalog-identification.ts'
const root=process.argv[2]
if(!root)throw Error('Provide the checked-out tcgdex/cards-database directory')
const commit=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim()
const fields=['types','stage','suffix','trainerType','category','rarity'],languages={en:Object.fromEntries(fields.map(k=>[k,{}]))}
const rarity=JSON.parse(await readFile(new URL('../data/catalog-rarity-aliases.json',import.meta.url),'utf8'))
const codes=name=>name==='ACE SPEC Rare'?['rarity:ace-spec-rare','rarity:ace']:name==='Black White Rare'?['rarity:black-white-rare','rarity:bwr']:'rarity:'+normalizeSearch(name).replaceAll(' ','-')
for(const lang of ['it','fr','de','es','pt']){
 const translations=JSON.parse(await readFile(root+'/meta/translations/'+lang+'.json','utf8'))
 languages[lang]={}
 for(const field of fields){
  languages[lang][field]={}
  for(const [canonical,translated] of Object.entries(translations[field]||{})){
   languages.en[field][normalizeSearch(canonical)]=canonical
   languages[lang][field][normalizeSearch(translated)]=canonical
   if(field==='rarity'){
    rarity.languages.en[normalizeSearch(canonical)]??=codes(canonical)
    rarity.languages[lang][normalizeSearch(translated)]??=codes(canonical)
   }
  }
 }
}
for(const lang of Object.keys(languages))for(const [label,canonical] of Object.entries(languages[lang].rarity))
 if(['ACE SPEC Rare','Black White Rare'].includes(canonical))rarity.languages[lang][label]=codes(canonical)
const source={repository:'https://github.com/tcgdex/cards-database',commit,path:'meta/translations'}
rarity.provenance.upstream_translations=source
await writeFile(new URL('../data/catalog-metadata-aliases.json',import.meta.url),JSON.stringify({source,languages},null,2)+'\n')
await writeFile(new URL('../data/catalog-rarity-aliases.json',import.meta.url),JSON.stringify(rarity,null,2)+'\n')
