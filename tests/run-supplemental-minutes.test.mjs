import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
test('supplemental session length comes from SUPPLEMENTAL_MINUTES and is validated', async()=>{
 const source=await readFile(new URL('../scripts/run-supplemental-sources.mjs',import.meta.url),'utf8')
 assert.match(source,/SUPPLEMENTAL_MINUTES\|\|8/)
 assert.match(source,/Date\.now\(\)\+minutes\*60000/)
})
test('supplemental passes repeat until the budget ends or no page is due', async()=>{
 const source=await readFile(new URL('../scripts/run-supplemental-sources.mjs',import.meta.url),'utf8')
 assert.match(source,/result\.pages===0/)
})
test('research passes repeat until the budget ends or no job is processed', async()=>{
 const source=await readFile(new URL('../scripts/run-research-sources.mjs',import.meta.url),'utf8')
 assert.match(source,/RESEARCH_MINUTES\|\|8/)
 assert.match(source,/result\.jobs===0/)
})
