import {DatabaseSync} from 'node:sqlite'
// Local SQLite file with the small client surface used by the Turso snapshot,
// schema preparation and publisher modules (execute, batch, transaction).
// Used to build the whole catalog offline and upload it as one file.
export function sqliteFileClient(path,{fast=false}={}){
 const db=new DatabaseSync(path)
 db.exec('PRAGMA journal_mode=WAL;')
 // A build file is disposable until verified: durability is not needed while writing.
 if(fast)db.exec('PRAGMA synchronous=OFF;PRAGMA cache_size=-262144;PRAGMA temp_store=MEMORY;')
 const run=input=>{
  const {sql,args=[]}=typeof input==='string'?{sql:input}:input
  const statement=db.prepare(sql)
  if(statement.columns().length)return {rows:statement.all(...args)}
  return {rows:[],rowsAffected:Number(statement.run(...args).changes)}
 }
 const client={
  async execute(input){return run(input)},
  async batch(statements){
   db.exec('BEGIN')
   try{const out=statements.map(run);db.exec('COMMIT');return out}catch(error){db.exec('ROLLBACK');throw error}
  },
  async transaction(){
   db.exec('BEGIN IMMEDIATE')
   return {execute:async input=>run(input),batch:async statements=>statements.map(run),async commit(){db.exec('COMMIT')},async rollback(){db.exec('ROLLBACK')},close(){}}
  },
  exec(sql){db.exec(sql)},
  // Fold the WAL into the main file: required before uploading to Turso.
  checkpoint(){db.exec('PRAGMA wal_checkpoint(TRUNCATE);')},
  close(){db.close()}
 }
 return client
}
