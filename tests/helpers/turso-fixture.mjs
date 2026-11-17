import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {initializeSnapshot,copyTable,canonicalJson,hash,recordKey} from '../../scripts/turso-snapshot.mjs'
import {prepareCatalogSchema} from '../../src/server/turso-schema.mjs'
export const schema=JSON.parse(readFileSync(new URL('../../data/turso-source-schema.json',import.meta.url),'utf8'))
export function rowFor(name,patch){return {...Object.fromEntries(schema.tables.find(t=>t.table_name===name).columns.map(c=>[c.name,c.nullable?null:c.type.endsWith('[]')?[]:c.type==='jsonb'?{}:c.type==='boolean'?false:/^(bigint|integer|smallint)/.test(c.type)?0:''])),...(name==='cards'?{file_name:'fixture-'+patch.id+'.png'}:{}),...patch}}
export function memoryClient(){const db=new DatabaseSync(':memory:');const c={async execute(input){const {sql,args=[]}=typeof input==='string'?{sql:input}:input;const s=db.prepare(sql);if(s.columns().length)return {rows:s.all(...args)};return {rows:[],rowsAffected:Number(s.run(...args).changes)}},async batch(statements){db.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await c.execute(s));db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}},async transaction(){db.exec('BEGIN IMMEDIATE');return {execute:c.execute,async batch(statements){const out=[];for(const statement of statements)out.push(await c.execute(statement));return out},async commit(){db.exec('COMMIT')},async rollback(){db.exec('ROLLBACK')},close(){}}},close(){db.close()}};return c}
export async function catalogFixture(data={}){
 const c=memoryClient();await initializeSnapshot(c,schema.tables,'domain-fixture')
 for(const table of schema.tables){const rows=(data[table.table_name]||[]).map(r=>rowFor(table.table_name,r));await copyTable({client:c,table,source:{async count(){return rows.length},async page(){return rows}}})}
 await c.execute('UPDATE _catalog_snapshot_meta SET complete=1 WHERE id=1');await prepareCatalogSchema(c,schema);return c
}
export async function putRow(c,name,patch,mode='automatic'){
 const table=schema.tables.find(t=>t.table_name===name),row=rowFor(name,patch),key=recordKey(table,row).key,serialized=canonicalJson(row)
 const position=Number((await c.execute('SELECT coalesce(max(_position),0)+1 n FROM "_copy_'+name+'"')).rows[0].n)
 await c.batch([{sql:'UPDATE _catalog_write_context SET mode=? WHERE id=1',args:[mode]},{sql:'INSERT INTO "_copy_'+name+'"(_key,_row,_hash,_position) VALUES(?,?,?,?)',args:[key,serialized,hash(serialized),position]},"UPDATE _catalog_write_context SET mode='manual' WHERE id=1"])
}
