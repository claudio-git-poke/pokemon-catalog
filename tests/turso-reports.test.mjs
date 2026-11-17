import {test} from 'node:test'
import assert from 'node:assert/strict'
import {catalogFixture} from './helpers/turso-fixture.mjs'
import {coverageAuditReport,crossSourceReport} from '../src/server/turso-reports.mjs'

test('cross-source comparisons join source identities and preserve unestablished independence',async()=>{
 const c=await catalogFixture({catalog_sync_sets:[{source_uid:'tcgdex:it:sv02',provider:'tcgdex',source_language:'it',set_id:'sv02',name:'Evoluzioni',coverage_scope:'physical'},{source_uid:'atlas:it:SV02',provider:'atlas',source_language:'it',set_id:'SV02',coverage_scope:'physical'}],catalog_source_comparisons:[{pair_key:'opaque-old-key',primary_uid:'tcgdex:it:sv02',secondary_uid:'atlas:it:SV02',status:'differences',result:{missing:['269']}}]})
 const report=await crossSourceReport(c);assert.equal(report.total,1);assert.equal(report.rows[0].status,'differences');assert.equal(report.rows[0].independence_status,'unestablished');assert.equal(report.rows[0].variants_status,'unverified');assert.deepEqual(report.rows[0].result,{missing:['269']})
 assert.equal((await crossSourceReport(c,{wanted_status:''})).total,0)
 c.close()
})
test('coverage keeps unmeasured values null and distinguishes explicit empty manifests from certified lists',async()=>{
 const c=await catalogFixture({catalog_sync_sets:[{source_uid:'tcgdex:it:sv02',provider:'tcgdex',source_language:'it',set_id:'sv02',name:'Evoluzioni',coverage_scope:'physical',manifest_count:0,resolved_count:0,manifest_digest:null,resolved_digest:null,coverage_detail:{comparison_scope:'expected_source_links'}}]})
 const report=await coverageAuditReport(c);assert.equal(report.total,1);assert.equal(report.rows[0].cards,null);assert.equal(report.rows[0].missing_count,null);assert.equal(report.rows[0].unexpected_count,null);assert.equal(report.stats.unmeasured,1)
 assert.equal((await coverageAuditReport(c,{wanted_issue:'unchecked'})).total,1)
 assert.equal((await coverageAuditReport(c,{wanted_language:''})).total,0)
 c.close()
})
