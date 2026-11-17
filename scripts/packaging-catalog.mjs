import {createHash} from 'node:crypto'
import {normalizeSearch} from '../src/lib/catalog-identification.ts'
const languages={EN:'INT',IT:'IT',FR:'FR',DE:'DE',ES:'ES',PT:'PT',JP:'JP',KO:'KOR','ZH-TW':'CHN-T','ZH-CN':'CHN',ID:'ID',TH:'TH'}
const series={SWSH:'SWSHP',SVP:'SVP',MEP:'MEP',SM:'SMP',XY:'XYP',BW:'BWP',DP:'DPP',HGSS:'HGSSP'}
const japanese=new Set(['PLAY','PPP','ADV-P','PCG-P','DP-P','P','XY-P','BW-P','SM-P','S-P','SV-P','M-P'])
export function packagingIdentity(number,language){
 let m
 if(language==='und')return null
 if((m=number.match(/^WOTC\s+(\d+)$/i)))return {set:'BASEP',number:String(Number(m[1])),language}
 if((m=number.match(/^(SWSH|SVP|MEP|SM|XY|BW|DP|HGSS)(\d+[a-z]?)$/i)))return {set:series[m[1].toUpperCase()],number:m[2].toLowerCase().replace(/^0+(?=\d)/,''),language}
 if((m=number.match(/^(\d+[a-z]?)\/([A-Z][A-Z0-9-]*)$/i))&&japanese.has(m[2].toUpperCase()))return {set:m[2].toUpperCase(),number:m[1].toLowerCase().replace(/^0+(?=\d)/,''),language}
 if((m=number.match(/^(SV-P)-(\d+)$/i)))return {set:'SV-P',number:String(Number(m[2])),language}
 return null
}
export function parsePackagingCatalog(text){
 const hash=createHash('sha256').update(text).digest('hex'),document_key='sealed:2026-11-17:'+hash.slice(0,12),lines=text.split(/\r?\n/),sources=new Map()
 for(let i=0;i<lines.length;i++){
  const m=lines[i].match(/^\[(F\d+)\]\s+(.+)$/)
  if(!m)continue
  const url=lines[i+1]?.trim()
  if(sources.has(m[1])||!/^https:\/\//.test(url||''))throw Error('Fonte non valida: '+m[1])
  sources.set(m[1],{source_id:m[1],title:m[2],url})
 }
 const rows=[],ids=new Set()
 for(const line of lines){
  if(!/^\d{4} \|/.test(line))continue
  const fields=line.split('|').map(x=>x.trim())
  if(fields.length!==9||ids.has(fields[0]))throw Error('Riga duplicata o non valida')
  const [id,group_name,raw_language,name,card_number,packaging_description,claimed_evidence_level,origin,refs]=fields
  ids.add(id)
  if(!['A','B','C'].includes(claimed_evidence_level))throw Error('Livello di prova non valido')
  const language=languages[raw_language]||'und',packaging_types=[...new Set(packaging_description.match(/S[1-4]/g)||[])]
  if(!packaging_types.length)throw Error('Tipo di confezione mancante')
  const source_refs=refs.split(',').map(x=>{const source=sources.get(x.trim());if(!source)throw Error('Fonte assente: '+x);return source})
  const uncertainties=['sealed-not-independently-verified']
  if(language==='und')uncertainties.push('card-language-unknown')
  if(packaging_types.length>1)uncertainties.push('packaging-type-ambiguous')
  if(packaging_types.includes('S3'))uncertainties.push('individual-pack-contents-unknown')
  if(packaging_types.includes('S4'))uncertainties.push('sealed-deck-contents')
  if(claimed_evidence_level!=='A')uncertainties.push('partial-or-indirect-evidence')
  rows.push({candidate_key:document_key+':'+id,document_key,source_row_number:Number(id),source_row:line,
   group_name,raw_language,language,language_status:language==='und'?'unknown':'documented',name,card_number,
   packaging_types,packaging_description,claimed_evidence_level,origin,source_refs,uncertainties,
   search_text:normalizeSearch([name,card_number,group_name,origin,raw_language].join(' '))})
 }
 const footer=text.match(/RIGHE:\s*(\d+)\s*\|\s*A=(\d+)\s*\|\s*B=(\d+)\s*\|\s*C=(\d+)/)
 const counts=Object.fromEntries(['A','B','C'].map(k=>[k,rows.filter(r=>r.claimed_evidence_level===k).length]))
 if(!footer||rows.length!==Number(footer[1])||['A','B','C'].some((k,i)=>counts[k]!==Number(footer[i+2])))throw Error('Riepilogo del documento discordante')
 const limits=lines.indexOf('LIMITI E LACUNE')
 return {document:{document_key,title:lines[0],document_date:'2026-11-17',sha256:hash,archive_path:'data/packaging/catalogo-sealed-2026-11-17.txt',source_manifest:[...sources.values()],limitations:limits<0?[]:lines.slice(limits+1).filter(x=>x.startsWith('- ')).map(x=>x.slice(2))},rows,counts}
}
export function cardPackagingIdentity(card){
 const language=card.lingua==='EN'?'INT':card.lingua,set=(card.sigla||'').split('@')[0].toUpperCase()
 const sourceLanguages={INT:'en',IT:'it',FR:'fr',DE:'de',ES:'es',PT:'pt',JP:'ja',KOR:'ko','CHN-T':'zh-tw',CHN:'zh-cn',ID:'id',TH:'th'}
 if(!sourceLanguages[language]||card.source_language&&card.source_language!==sourceLanguages[language])return null
 let local=String(card.source_local_id||'').toUpperCase()
 if(!local)return null
 const prefix=Object.entries(series).find(([,s])=>s===set)?.[0]
 if(prefix&&local.startsWith(prefix))local=local.slice(prefix.length)
 if(!/^\d+[A-Z]?$/.test(local))return null
 return {set,language,number:local.toLowerCase().replace(/^0+(?=\d)/,'')}
}
const identityKey=i=>i?JSON.stringify([i.set,i.number,i.language]):null
export function proposePackagingLinks(rows,cards){
 const index=new Map()
 for(const card of cards){const key=identityKey(cardPackagingIdentity(card));if(key){if(!index.has(key))index.set(key,[]);index.get(key).push(card)}}
 const links=[]
 for(const row of rows){
  const key=identityKey(packagingIdentity(row.card_number,row.language))
  for(const card of index.get(key)||[])links.push({candidate_key:row.candidate_key,card_id:card.id,source_uid_snapshot:card.source_uid||null,method:'exact-set-number-language',status:'candidate',entry_key:null,evidence_url:null,note:'Serie, numero e lingua concordanti; stampa e confezionamento da verificare.'})
 }
 return links
}
