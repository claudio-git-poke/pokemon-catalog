import {NextResponse} from 'next/server'
import {createCatalogServerClient} from '@/lib/catalog-server'
export const dynamic='force-dynamic'
export const fetchCache='force-no-store'
export async function GET(){
 const db=createCatalogServerClient()
 const [state,cards,sets,images,validation]=await Promise.all([
  db.from('catalog_export_state').select('*').eq('id','bindex').single(),
  db.from('set_carte').select('*',{count:'exact',head:true}),
  db.from('set_espansioni').select('*',{count:'exact',head:true}),
  db.from('set_carte_immagini').select('*',{count:'exact',head:true}),
  db.rpc('bindex_contract_report')
 ])
 const error=[state,cards,sets,images,validation].find(r=>r.error)?.error
 if(error)return NextResponse.json({ready:false,error:error.message},{status:503})
 return NextResponse.json({ready:state.data.ready&&validation.data.blocking===0,validation:validation.data,ready_means:'v1_contract_compatible',completeness:'not_certified',printing_inventory:{endpoint:'/api/bindex/printings',contract:'bindex-printings-v1',record_type:'source_evidence',canonical_mapping_required_for_collections:true},destination_copy:'not_verified_by_catalog',changes:'/api/bindex/changes',contract:'bindex-v1',direction:'catalogo → Bindex',tables:{cards:'set_carte',sets:'set_espansioni',images:'set_carte_immagini'},counts:{cards:cards.count,sets:sets.count,images:images.count},state:state.data},{headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}})
}
