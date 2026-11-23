import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
test('the downloadable file drops the append-only manual history', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pub-')),source=join(dir,'s.db'),target=join(dir,'t.db')
 try{
  const db=new DatabaseSync(source)
  db.exec('CREATE TABLE "_copy_catalog_manual_history"(_key,_row);CREATE TABLE cards(a);INSERT INTO cards VALUES(1);INSERT INTO "_copy_catalog_manual_history" VALUES(1,2),(3,4);CREATE TRIGGER h_no_delete BEFORE DELETE ON "_copy_catalog_manual_history" BEGIN SELECT RAISE(ABORT,\'append-only\'); END')
  db.close()
  await promisify(execFile)(process.execPath,['scripts/public-catalog-file.mjs'],{env:{PATH:process.env.PATH,CATALOG_FILE:source,PUBLIC_FILE:target}})
  const out=new DatabaseSync(target)
  assert.equal(out.prepare('SELECT count(*) AS n FROM "_copy_catalog_manual_history"').get().n,0)
  assert.equal(out.prepare('SELECT count(*) AS n FROM cards').get().n,1)
  out.close()
 }finally{await rm(dir,{recursive:true,force:true})}
})
