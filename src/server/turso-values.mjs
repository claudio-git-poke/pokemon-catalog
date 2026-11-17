import {CatalogRestError} from './turso-rest.mjs'
export const normalizeCatalog=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ')
export const catalogNumber=value=>String(value??'').split('/')[0].replace(/^0+(?=\d)/,'').toLowerCase()
export function utcTimestamp(value){
 let text=String(value??'');if(/^\d{4}-\d\d-\d\d$/.test(text))text+='T00:00:00Z'
 const match=text.match(/^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/i)
 if(!match)throw new CatalogRestError('Timestamp non valido.')
 const date=new Date(match[1]+'T'+match[2]+match[4]);if(!Number.isFinite(date.getTime()))throw new CatalogRestError('Timestamp non valido.')
 return date.toISOString().slice(0,19)+'.'+(match[3]||'').padEnd(6,'0')+'Z'
}
export function utcSortSql(value){
 const zone=`CASE WHEN upper(substr(${value},-1))='Z' THEN 'Z' WHEN substr(${value},-6,1) IN ('+','-') THEN substr(${value},-6) ELSE 'Z' END`
 const fraction=`CASE WHEN substr(${value},20,1)='.' THEN replace(replace(substr(${value},21),${zone},''),'z','') ELSE '' END`
 return `(strftime('%Y-%m-%dT%H:%M:%S',substr(${value},1,19)||(${zone}))||'.'||substr((${fraction})||'000000',1,6)||'Z')`
}
