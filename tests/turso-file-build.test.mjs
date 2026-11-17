import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {schema,rowFor} from './helpers/turso-fixture.mjs'
import {sqliteFileClient} from '../scripts/sqlite-file-client.mjs'
import {buildCatalogFile,verifyUploadedCatalog} from '../scripts/turso-file-build.mjs'
test('offline build produces a verified, searchable, guarded catalog file',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'catalog-build-')),file=join(dir,'catalog.db')
 try{
  const data={
   cards:Array.from({length:2500},(_,i)=>rowFor('cards',{id:i+1,nome:'Pikachu '+i,sigla:'SV01',lingua:'IT',file_name:'f'+i+'.png'})),
   catalog_search_entries:Array.from({length:2500},(_,i)=>rowFor('catalog_search_entries',{entry_key:'e'+i,card_id:i+1,name:'Pikachu '+i,set_code:'SV01',language:'IT',verification:'source',search_text:'pikachu '+i,tags:['rarity:rare','type:lightning']})),
   catalog_manual_history:[]
  }
  const pages=new Map()
  const source={
   async count(table){return (data[table.table_name]||[]).length},
   async page(table,cursor,limit){const rows=data[table.table_name]||[];const start=cursor?pages.get(table.table_name+JSON.stringify(cursor)):0;const page=rows.slice(start,start+limit);if(page.length){const last=page.at(-1);pages.set(table.table_name+JSON.stringify(table.primary_key.map(k=>last[k])),start+page.length)}return page}
  }
  const client=sqliteFileClient(file,{fast:true})
  const {report}=await buildCatalogFile({client,source,schema,sourceId:'fixture'})
  assert.equal(report.verified,schema.tables.length);assert.equal(report.rows,5000)
  assert.equal(await verifyUploadedCatalog(client,report,schema),schema.tables.length)
  client.checkpoint();client.close()
  const db=new DatabaseSync(file,{readOnly:true})
  assert.equal(db.prepare("SELECT count(*) n FROM _catalog_entry_tags WHERE tag='type:lightning'").get().n,2500)
  assert.equal(db.prepare("SELECT count(*) n FROM _catalog_entry_fts WHERE _catalog_entry_fts MATCH 'pikachu'").get().n,2500)
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE '_catalog_manual_%'").get().n>0,true)
  assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode,'wal')
  db.close()
 }finally{await rm(dir,{recursive:true,force:true})}
})
