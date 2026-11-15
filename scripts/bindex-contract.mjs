import {inventoryRecord} from './printing-inventory.mjs'
const pagePattern=/^https:\/\/www\.cardmarket\.com\/it\/Pokemon\/Products\/[^?#]+$/
export function validatePublication(row){
 if(typeof row.sigla!=='string'||!row.sigla.trim()||!Number.isSafeInteger(row.numero)||row.numero<=0||typeof row.variante!=='string'||! /^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.variante))return 'invalid_canonical_identity'
 if(typeof row.nome!=='string'||!row.nome.trim())return 'missing_canonical_name'
 if(row.codice!=null&&!/^[A-Z0-9][A-Z0-9.-]*( [A-Z0-9]+)?$/.test(row.codice))return 'invalid_printed_code'
 if(!Array.isArray(row.tag)||row.tag.some(t=>typeof t!=='string'||!t.trim()))return 'invalid_tags'
 if(row.cardmarket_id!=null&&(!Number.isSafeInteger(row.cardmarket_id)||row.cardmarket_id<=0))return 'invalid_product_id'
 return null
}
export const canonicalMarketPage=url=>typeof url==='string'&&pagePattern.test(url)?url:null
// Only explicitly scoped and language-matched photos enter the v1 photo table.
export function publicationPhoto(entry,card){
 const r=inventoryRecord({entry,card})
 if(!r.image_url)return null
 return {image_language:r.language,image:r.image_url,image_hd:r.image_hd,image_source:r.image_source_url,image_verified:r.image_status==='verified'}
}
