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
export function publicationPhoto(entry,card){
 if(!entry.image_url||entry.source_payload?.reference_image_only)return null
 const languageMap={it:'IT',en:'EN',fr:'FR',de:'DE',es:'ES',pt:'PT',ja:'JP',jp:'JP',ko:'KOR',kor:'KOR','zh-cn':'CHN','zh-tw':'CHN-T',th:'TH',id:'ID',nl:'NL',pl:'PL',ru:'RU','es-mx':'ES-LA'}
 const explicit=entry.source_payload?.image_language||entry.source_payload?.source_language||card?.source_language
 const language=languageMap[String(explicit).toLowerCase()]||(['IT','EN','FR','DE','ES','PT','JP','KOR','CHN','CHN-T','TH','ID','NL','PL','RU','ES-LA'].includes(explicit)?explicit:null)
 if(!language||!/^https:\/\//.test(entry.image_url)||!entry.source_url)return null
 return {image_language:language,image:entry.image_url,image_hd:entry.source_payload?.image_hd||null,image_source:entry.source_url,image_verified:entry.verification==='reviewed'}
}
