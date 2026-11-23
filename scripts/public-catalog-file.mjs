import {copyFile,rm} from 'node:fs/promises'
import {DatabaseSync} from 'node:sqlite'
// Downloadable copy of the built catalog file without the manual-edit history
// (the repository is public, so artifacts can be downloaded by anyone).
const source=process.env.CATALOG_FILE||'/tmp/pokemon-catalog.db',target=process.env.PUBLIC_FILE||'/tmp/download/pokemon-catalog.db'
await rm(target,{force:true})
await copyFile(source,target)
const db=new DatabaseSync(target)
db.exec('PRAGMA journal_mode=DELETE;')
// The history table is append-only in the real database (triggers refuse
// deletes); the downloadable copy is a different file, so those triggers go.
for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('_copy_catalog_manual_history','_catalog_manual_outbox')").all())db.exec('DROP TRIGGER "'+String(name).replace(/"/g,'""')+'"')
const removed=Number(db.prepare('DELETE FROM "_copy_catalog_manual_history"').run().changes)
if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='_catalog_manual_outbox'").get())db.exec('DELETE FROM _catalog_manual_outbox')
db.exec('VACUUM;')
const left=db.prepare('SELECT count(*) AS n FROM "_copy_catalog_manual_history"').get().n
db.close()
if(left!==0)throw Error('Cronologia manuale non rimossa dal file da scaricare.')
console.log(JSON.stringify({phase:'public-file-ready',removed_manual_history:removed}))
