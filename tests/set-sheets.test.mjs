import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {limitlessDate,limitlessSetRows,atlasSheets,deriveSheets} from '../scripts/build-set-sheets.mjs'
import {sheetLookup,looseKey} from '../src/lib/set-sheet-lookup.mjs'
const sheets={
 'SV08@INT':{code:'sv08',language:'INT',name:'Surging Sparks',series:'Scarlet & Violet',release_date:'2024-11-08',official:191,total:252,abbreviation:'SSP',source:'tcgdex'},
 'ECARD2@INT':{code:'ecard2',language:'INT',name:'Aquapolis',release_date:'2003-01-15',abbreviation:'AQ',source:'tcgdex'},
 'SMP@JP':{code:'SMP',language:'JP',name:'Sun and Moon Promotional Cards',total:440,source:'atlas'},
 'SV8A@JP':{code:'SV8a',language:'JP',name:'テラスタルフェスex',series:'スカーレット&バイオレット',release_date:'2024-12-06',total:237,source:'tcgdex'},
 'M1L@KOR':{code:'M1L',language:'KOR',name:null,total:63,source:'atlas'},
 'M1L@JP':{code:'M1L',language:'JP',name:'メガブレイブ',release_date:'2025-08-01',total:63,source:'atlas'}}
test('set codes are matched exactly, without separators, by official abbreviation and through the original edition',()=>{
 const find=sheetLookup(sheets)
 assert.equal(looseKey('SM-P@JP'),'SMP@JP')
 assert.equal(find('sv08@int').name,'Surging Sparks')
 assert.equal(find('SM-P@JP').name,'Sun and Moon Promotional Cards');assert.equal(find('SM-P@JP').matched_as,'SMP@JP')
 assert.equal(find('AQ@EN').name,'Aquapolis');assert.equal(find('AQ@EN').derived_from,'ECARD2@INT')
 assert.equal(find('SV8A@TH').name,'テラスタルフェスex');assert.equal(find('SV8A@TH').derived_from,'SV8A@JP')
 const kor=find('M1L@KOR');assert.equal(kor.name,'メガブレイブ');assert.equal(kor.filled_from,'M1L@JP');assert.equal(kor.total,63)
 assert.equal(find('SPECIAL PRINT@EN'),null)
 assert.equal(find('MA3@ID'),null,'an Asian edition without a Japanese original stays without sheet')
 assert.deepEqual(Object.keys(deriveSheets(sheets,['SM-P@JP','XX@IT'])).filter(k=>!sheets[k]),['SM-P@JP'])
})
test('Limitless set rows give name, code, release date and total',()=>{
 assert.equal(limitlessDate('08 Nov 24'),'2024-11-08');assert.equal(limitlessDate('20 Oct 96'),'1996-10-20');assert.equal(limitlessDate('soon'),null)
 const html=`<table><tr><th>Set</th></tr><tr>
  <td><a href="/cards/SSP"><img class="set" alt="SSP" src="x.png" loading="lazy"> Surging Sparks <span class="code annotation">SSP</span></a></td>
  <td><a href="/cards/SSP">08 Nov 24</a></td>
  <td class="md-only"><a href="/cards/SSP">252 <span class="playability">44.44%</span></a></td>
  <td class="lg-only"><a class="card-price eur" href="https://www.cardmarket.com/en/Pokemon/Expansions/Surging-Sparks?utm_source=x">1€</a></td></tr></table>`
 assert.deepEqual(limitlessSetRows(html,'en'),[{code:'SSP',name:'Surging Sparks',release_date:'2024-11-08',total:252,cardmarket_expansion:'Surging-Sparks',source_url:'https://limitlesstcg.com/cards/SSP'}])
})
test('Atlas names a set only when its first cards come from the same product',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'atlas-'))
 const card=(name,total)=>JSON.stringify({set_total:total,sources:[{name,link:'https://www.pokemon-card.com/ex/x/'}]})
 await mkdir(path.join(root,'data_jp','SV8a'),{recursive:true});await mkdir(path.join(root,'data_jp','SMP'),{recursive:true})
 for(const i of [1,2,3]){await writeFile(path.join(root,'data_jp','SV8a',`${i}.json`),card('ハイクラスパック「テラスタルフェスex」','187'));await writeFile(path.join(root,'data_jp','SMP',`${i}.json`),card(`イベント ${i}`,'-1'))}
 const result=await atlasSheets(root)
 assert.equal(result['SV8A@JP'].name,'ハイクラスパック「テラスタルフェスex」');assert.equal(result['SV8A@JP'].total,187)
 assert.equal(result['SMP@JP'].name,null);assert.equal(result['SMP@JP'].total,null)
})
test('sheets from two sources are merged only when they describe the same set',async()=>{
 const {sameSet}=await import('../scripts/build-set-sheets.mjs')
 assert.equal(sameSet({name:'BW 30枚デッキ',total:60},{name:'Mega Gardevoir',total:120}),false)
 assert.equal(sameSet({name:null,total:440},{name:'Sun and Moon Promotional Cards',total:430}),true)
 assert.equal(sameSet({name:'A',total:null},{name:'B',total:100}),false)
 assert.equal(sameSet({name:null,total:null},{name:'B',total:100}),true)
})
