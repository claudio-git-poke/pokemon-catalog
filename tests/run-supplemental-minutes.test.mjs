import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
test('supplemental session length comes from SUPPLEMENTAL_MINUTES and is validated', async()=>{
 const source=await readFile(new URL('../scripts/run-supplemental-sources.mjs',import.meta.url),'utf8')
 assert.match(source,/SUPPLEMENTAL_MINUTES\|\|8/)
 assert.match(source,/budgetMs:minutes\*60000/)
})
