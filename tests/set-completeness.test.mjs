import {test} from 'node:test'
import assert from 'node:assert/strict'
import {completeness} from '../scripts/build-set-completeness.mjs'
test('completeness counts present, expected and missing numbers per set; borrowed sheets are not judged',()=>{
 const sheets={'SV08@INT':{code:'sv08',language:'INT',total:5,official:4,source:'tcgdex'},'SV8A@JP':{code:'SV8a',language:'JP',total:3,source:'atlas'}}
 const cards=[1,2,4].map(n=>({id:n,sigla:'SV08@INT',lingua:'INT',numero:n,photo:n!==4}))
  .concat([{id:10,sigla:'SV8A@TH',lingua:'TH',numero:1,photo:true}])
 const rows=Object.fromEntries(completeness({cards,traitCards:new Set([1]),sheets}).map(r=>[r.sigla,r]))
 assert.deepEqual(JSON.parse(JSON.stringify(rows['SV08@INT'])),{sigla:'SV08@INT',lingua:'INT',cards:3,expected:5,missing:2,missing_numbers:[3],with_photo:2,with_traits:1})
 assert.equal(rows['SV8A@TH'].expected,null,'Thai edition borrows the Japanese sheet: its total is not used')
 const split=Object.fromEntries(completeness({cards:[{id:1,sigla:'SV08@INT',lingua:'INT',numero:1},{id:2,sigla:'SSP@INT',lingua:'INT',numero:2},{id:3,sigla:'SV08@INT',lingua:'INT',numero:4}],traitCards:new Set(),sheets:{...sheets,'SV08@INT':{...sheets['SV08@INT'],abbreviation:'SSP'}}}).map(r=>[r.sigla,r]))
 assert.equal(split['SV08@INT'].missing,2,'number 2 sits under SSP@INT: present elsewhere');assert.equal(split['SV08@INT'].elsewhere,1);assert.deepEqual(split['SV08@INT'].missing_numbers,[3])
})
