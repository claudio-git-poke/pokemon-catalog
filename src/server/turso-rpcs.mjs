import {CatalogRestError} from './turso-rest.mjs'
import {identifyCards,bindexExportPage,bindexPrintingPage,bindexContractReport,variantCoverage} from './turso-read-rpcs.mjs'
import {visualCards,visualGroupCards,visualGroupPage} from './turso-visual.mjs'
import {coverageReport,coverageAuditReport,crossSourceReport} from './turso-reports.mjs'

const READ_RPCS={
 identify_catalog_cards:[identifyCards,'tokens required_tags card_number card_denominator wanted_year wanted_language observations page_offset page_size'],
 bindex_export_page:[bindexExportPage,'kind after_time after_key until_time page_size'],
 bindex_printing_page:[bindexPrintingPage,'after_time after_key until_time page_size'],
 bindex_contract_report:[bindexContractReport,''],
 catalog_variant_coverage:[variantCoverage,''],
 catalog_visual_cards:[visualCards,'symbol_key after_key page_size include_review'],
 catalog_visual_group_cards:[visualGroupCards,'symbol_group after_key page_size include_review filter_language'],
 catalog_visual_group_page:[visualGroupPage,'after_group page_size filter_kind filter_language include_unlinked'],
 catalog_coverage_report:[coverageReport,'wanted_status wanted_language wanted_provider query_text page_offset page_size'],
 catalog_coverage_audit_report:[coverageAuditReport,'wanted_issue wanted_language wanted_provider query_text page_offset page_size'],
 catalog_cross_source_report:[crossSourceReport,'wanted_status page_offset']
}
export async function readCatalogRpc(client,name,params={}){
 const entry=Object.hasOwn(READ_RPCS,name)?READ_RPCS[name]:null
 if(!entry)throw new CatalogRestError('Funzione non disponibile.','PGRST202',404)
 if(!params||typeof params!=='object'||Array.isArray(params))throw new CatalogRestError('Parametri non validi.')
 const allowed=new Set(entry[1].split(' ').filter(Boolean))
 for(const [key,value]of Object.entries(params)){
  if(!allowed.has(key))throw new CatalogRestError('Parametro sconosciuto: '+key)
  if(key==='page_size'||key==='page_offset'||key==='wanted_year'){
   if(value!==null&&(!Number.isSafeInteger(value)||(key==='page_offset'&&value<0)||(key==='page_size'&&value<1)))throw new CatalogRestError('Numero non valido: '+key)
  }else if(['include_review','include_unlinked'].includes(key)&&typeof value!=='boolean')throw new CatalogRestError('Valore booleano non valido: '+key)
 }
 return entry[0](client,params)
}
