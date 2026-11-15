import {createHash} from 'node:crypto'
export function sourceManifest(expectedIds,resolvedIds){
 const digest=ids=>createHash('sha256').update(JSON.stringify([...new Set(ids)].sort())).digest('hex')
 if(expectedIds.some(id=>typeof id!=='string'||!id)||resolvedIds.some(id=>typeof id!=='string'||!id))throw Error('Identità della fonte non valida')
 return {manifest_count:expectedIds.length,resolved_count:new Set(resolvedIds).size,manifest_digest:digest(expectedIds),resolved_digest:digest(resolvedIds),coverage_checked_at:new Date().toISOString(),coverage_scope:'physical'}
}
