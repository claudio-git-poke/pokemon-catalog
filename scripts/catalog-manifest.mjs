import {createHash} from 'node:crypto'
export function sourceManifest(expectedIds,resolvedIds){
 const digest=ids=>createHash('sha256').update(JSON.stringify([...new Set(ids)].sort())).digest('hex')
 if(expectedIds.some(id=>typeof id!=='string'||!id)||resolvedIds.some(id=>typeof id!=='string'||!id))throw Error('Identità della fonte non valida')
 const expected=new Set(expectedIds),resolved=new Set(resolvedIds)
 const missing=[...expected].filter(id=>!resolved.has(id)).sort(),unexpected=[...resolved].filter(id=>!expected.has(id)).sort()
 return {manifest_count:expectedIds.length,resolved_count:resolved.size,manifest_digest:digest(expectedIds),resolved_digest:digest(resolvedIds),coverage_checked_at:new Date().toISOString(),coverage_scope:'physical',
  coverage_detail:{expected_unique_count:expected.size,duplicate_count:expectedIds.length-expected.size,missing_count:missing.length,unexpected_count:unexpected.length,missing_ids:missing.slice(0,30),unexpected_ids:unexpected.slice(0,30),sample_limit:30}}
}
