import {qid,sourceTable} from './turso-rest.mjs'
// Workers set mode=automatic inside their transaction. Direct SQL remains manual.
const EXCLUDED=['manual_overrides','created_at','updated_at','aggiornato_il','linked_at','search_text','search_vector','image_attempts','image_next_attempt_at','image_last_error','traits_checked_at','traits_next_attempt_at','traits_last_error','source_updated_at']
const excluded=EXCLUDED.map(k=>"'"+k+"'").join(',')
const typed=alias=>`CASE ${alias}.type WHEN 'object' THEN json(${alias}.value) WHEN 'array' THEN json(${alias}.value) WHEN 'true' THEN json('true') WHEN 'false' THEN json('false') ELSE ${alias}.value END`
function enforcedRow(oldRow,newRow,isCard){
 const photo=isCard?`UNION ALL SELECT 3,key,value,type FROM json_each(${newRow}) WHERE key IN ('image_url','image_status','image_source') AND EXISTS(SELECT 1 FROM json_each(${newRow}) n LEFT JOIN json_each(${oldRow}) o USING(key) WHERE n.key IN ('image_url','image_status','image_source') AND (n.value IS NOT o.value OR n.type IS NOT o.type))`:''
 return `(WITH RECURSIVE changes AS(
 SELECT 1 phase,n.key,n.value,n.type FROM json_each(${newRow},'$.manual_overrides') n WHERE n.key NOT IN (${excluded})
 UNION ALL SELECT 2,n.key,n.value,n.type FROM json_each(${newRow}) n LEFT JOIN json_each(${oldRow}) o USING(key)
 WHERE n.key NOT IN (${excluded}) AND (n.value IS NOT o.value OR n.type IS NOT o.type) ${photo}
 ),ordered AS(SELECT row_number() OVER(ORDER BY phase,key) seq,key,value,type FROM changes),
 capture(i,doc) AS(SELECT 0,coalesce(json_extract(${oldRow},'$.manual_overrides'),'{}') UNION ALL
 SELECT c.i+1,json_set(c.doc,'$.'||json_quote(o.key),${typed('o')}) FROM capture c JOIN ordered o ON o.seq=c.i+1),
 chosen AS(SELECT CASE WHEN (SELECT mode FROM _catalog_write_context WHERE id=1)='automatic' THEN coalesce(json_extract(${oldRow},'$.manual_overrides'),'{}') ELSE (SELECT doc FROM capture ORDER BY i DESC LIMIT 1) END doc),
 locks AS(SELECT row_number() OVER(ORDER BY key) seq,j.key,j.value,j.type FROM chosen,json_each(chosen.doc) j WHERE j.key NOT IN (${excluded})),
 apply_lock(i,doc) AS(SELECT 0,${newRow} UNION ALL SELECT a.i+1,json_set(a.doc,'$.'||json_quote(l.key),${typed('l')}) FROM apply_lock a JOIN locks l ON l.seq=a.i+1)
 SELECT json_set((SELECT doc FROM apply_lock ORDER BY i DESC LIMIT 1),'$.manual_overrides',json(chosen.doc)) FROM chosen)`
}
function historyInsert(table,oldRow,newRow){
 const identity=table.primary_key.map(k=>`'${k}',json_extract(${newRow},'$.${k}')`).join(',')
 return `INSERT INTO _copy_catalog_manual_history(_key,_row,_hash,_position)
 SELECT json_array(seed.id),json_object('id',seed.id,'at',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'table_name','${table.table_name}',
 'record_key',json_object(${identity}),'changed_fields',json((SELECT json_group_array(n.key) FROM json_each(${newRow},'$.manual_overrides') n LEFT JOIN json_each(${oldRow},'$.manual_overrides') o USING(key) WHERE n.value IS NOT o.value OR n.type IS NOT o.type)),
 'before_values',json((SELECT json_group_object(n.key,CASE json_type(${oldRow},'$.'||json_quote(n.key)) WHEN 'object' THEN json(json_extract(${oldRow},'$.'||json_quote(n.key))) WHEN 'array' THEN json(json_extract(${oldRow},'$.'||json_quote(n.key))) WHEN 'true' THEN json('true') WHEN 'false' THEN json('false') ELSE json_extract(${oldRow},'$.'||json_quote(n.key)) END) FROM json_each(${newRow},'$.manual_overrides') n LEFT JOIN json_each(${oldRow},'$.manual_overrides') o USING(key) WHERE n.value IS NOT o.value OR n.type IS NOT o.type)),
 'after_values',json((SELECT json_group_object(n.key,CASE json_type(${newRow},'$.'||json_quote(n.key)) WHEN 'object' THEN json(json_extract(${newRow},'$.'||json_quote(n.key))) WHEN 'array' THEN json(json_extract(${newRow},'$.'||json_quote(n.key))) WHEN 'true' THEN json('true') WHEN 'false' THEN json('false') ELSE json_extract(${newRow},'$.'||json_quote(n.key)) END) FROM json_each(${newRow},'$.manual_overrides') n LEFT JOIN json_each(${oldRow},'$.manual_overrides') o USING(key) WHERE n.value IS NOT o.value OR n.type IS NOT o.type)),
 'previous_overrides',json(coalesce(json_extract(${oldRow},'$.manual_overrides'),'{}')),'new_overrides',json(json_extract(${newRow},'$.manual_overrides')),
 'actor_role','manual','actor_subject',NULL,'reason',(SELECT reason FROM _catalog_write_context WHERE id=1)),
 'pending',seed.position FROM(SELECT coalesce(max(json_extract(_row,'$.id')),0)+1 id,coalesce(max(_position),0)+1 position FROM _copy_catalog_manual_history WHERE (SELECT mode FROM _catalog_write_context WHERE id=1)<>'automatic')seed
 WHERE (SELECT mode FROM _catalog_write_context WHERE id=1)<>'automatic' AND EXISTS(SELECT 1 FROM json_each(${newRow},'$.manual_overrides') n LEFT JOIN json_each(${oldRow},'$.manual_overrides') o USING(key) WHERE n.value IS NOT o.value OR n.type IS NOT o.type)`
}
const searchText=row=>`lower(coalesce(json_extract(${row},'$.name'),'')||' '||coalesce(json_extract(${row},'$.set_code'),'')||' '||coalesce(json_extract(${row},'$.collector_number'),'')||' '||coalesce(json_extract(${row},'$.label'),'')||' '||coalesce((SELECT group_concat(value,' ') FROM json_each(${row},'$.tags')),''))`
function projectedChildren(parent,oldParent){
 let row='e._row'
 for(const [child,field]of [['name','nome'],['set_code','sigla'],['language','lingua']]){
  const value=`CASE WHEN json_type(e._row,'$.manual_overrides.${child}') IS NOT NULL THEN json_extract(e._row,'$.manual_overrides.${child}') WHEN json_type(${parent},'$.manual_overrides.${field}') IS NOT NULL OR json_extract(e._row,'$.verification')='catalog' THEN json_extract(${parent},'$.${field}') ELSE json_extract(e._row,'$.${child}') END`
  row=`json_set(${row},'$.${child}',${child==='name'?`coalesce(${value},'')`:value})`
 }
 const affected=`json_extract(e._row,'$.card_id')=json_extract(${parent},'$.id') AND (${['nome','sigla','lingua'].map(k=>`json_extract(${oldParent},'$.${k}') IS NOT json_extract(${parent},'$.${k}') OR json_extract(${oldParent},'$.manual_overrides.${k}') IS NOT json_extract(${parent},'$.manual_overrides.${k}')`).join(' OR ')})`
 const plain=affected.replaceAll('e._row','_row'),projected=row.replaceAll('e._row','_row')
 return `INSERT INTO _catalog_entry_fts(_catalog_entry_fts,rowid,search_text) SELECT 'delete',e.rowid,coalesce(json_extract(e._row,'$.search_text'),'') FROM _copy_catalog_search_entries e WHERE ${affected};
 UPDATE _copy_catalog_search_entries SET _row=json_set(${projected},'$.updated_at',strftime('%Y-%m-%dT%H:%M:%fZ','now')),_hash='pending' WHERE ${plain};
 UPDATE _copy_catalog_search_entries SET _row=json_set(_row,'$.search_text',${searchText('_row')}) WHERE ${plain};
 INSERT INTO _catalog_entry_fts(rowid,search_text) SELECT e.rowid,coalesce(json_extract(e._row,'$.search_text'),'') FROM _copy_catalog_search_entries e WHERE ${affected};`
}
export async function installManualGuards(client,schema){
 await client.execute('CREATE TABLE IF NOT EXISTS _catalog_guard_version(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL)')
 const version=Number((await client.execute('SELECT version FROM _catalog_guard_version WHERE id=1')).rows[0]?.version||0)
 if(version>=2)return
 // Installing a new version is resumable: the ready flag is cleared by the
 // caller, and the version is committed only after every trigger exists.
 for(const table of schema.tables.filter(t=>t.columns.some(c=>c.name==='manual_overrides'))){
  for(const op of ['insert','update'])await client.execute(`DROP TRIGGER IF EXISTS ${qid('_catalog_manual_'+table.table_name+'_'+op)}`)
 }
 await client.batch([
  "CREATE TABLE IF NOT EXISTS _catalog_write_context(id INTEGER PRIMARY KEY CHECK(id=1),mode TEXT NOT NULL DEFAULT 'manual',depth INTEGER NOT NULL DEFAULT 0,reason TEXT)",
  "INSERT INTO _catalog_write_context(id) VALUES(1) ON CONFLICT(id) DO NOTHING",
  "CREATE TABLE IF NOT EXISTS _catalog_manual_outbox(table_name TEXT NOT NULL,record_key TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(table_name,record_key)) WITHOUT ROWID",
  "CREATE TRIGGER IF NOT EXISTS _catalog_history_immutable BEFORE UPDATE OF _row ON _copy_catalog_manual_history BEGIN SELECT raise(ABORT,'La cronologia manuale è append-only'); END",
  "CREATE TRIGGER IF NOT EXISTS _catalog_history_no_delete BEFORE DELETE ON _copy_catalog_manual_history BEGIN SELECT raise(ABORT,'La cronologia manuale è append-only'); END"
 ],'write')
 for(const table of schema.tables.filter(t=>t.columns.some(c=>c.name==='manual_overrides'))){
  const name=table.table_name,storage=sourceTable(name),identity=`json_array(${table.primary_key.map(k=>`json_extract(new._row,'$.${k}')`).join(',')})`
  await client.execute(`CREATE TRIGGER IF NOT EXISTS ${qid('_catalog_identity_'+name)} BEFORE UPDATE OF _row ON ${storage} WHEN new._key<>${identity} BEGIN SELECT raise(ABORT,'La chiave originale non può cambiare'); END`)
  for(const op of ['INSERT','UPDATE']){
   const oldRow=op==='INSERT'?"'{}'":'old._row',newRow='new._row',result=enforcedRow(oldRow,newRow,name==='cards'),finalRow=`(SELECT _row FROM ${storage} WHERE _key=new._key)`
   const required=table.columns.filter(c=>!c.nullable&&!c.generated).map(c=>`json_type(${finalRow},'$.${c.name}') IS NULL OR json_type(${finalRow},'$.${c.name}')='null'`).join(' OR ')
   await client.execute(`CREATE TRIGGER IF NOT EXISTS ${qid('_catalog_manual_'+name+'_'+op.toLowerCase())} AFTER ${op==='UPDATE'?'UPDATE OF _row':'INSERT'} ON ${storage}
   WHEN (SELECT depth FROM _catalog_write_context WHERE id=1)=0 BEGIN
    UPDATE _catalog_write_context SET depth=1 WHERE id=1;
    ${name==='catalog_search_entries'&&op==='UPDATE'?"INSERT INTO _catalog_entry_fts(_catalog_entry_fts,rowid,search_text) VALUES('delete',old.rowid,coalesce(json_extract(old._row,'$.search_text'),''));":''}
    UPDATE ${storage} SET _row=${result},_hash='pending' WHERE _key=new._key;
    ${name==='catalog_search_entries'?`UPDATE ${storage} SET _row=json_set(_row,'$.search_text',${searchText('_row')}) WHERE _key=new._key AND json_extract(_row,'$.manual_overrides')<>'{}';`:''}
    ${required?`SELECT CASE WHEN ${required} THEN raise(ABORT,'Campo obbligatorio mancante') END;`:''}
    ${historyInsert(table,oldRow,finalRow)};
    INSERT INTO _catalog_manual_outbox(table_name,record_key,version,updated_at)
    SELECT '${name}',new._key,1,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE (SELECT mode FROM _catalog_write_context WHERE id=1)<>'automatic'
    ON CONFLICT(table_name,record_key) DO UPDATE SET version=version+1,updated_at=excluded.updated_at;
    UPDATE _copy_catalog_live_updates SET _row=json_set(_row,'$.revision',coalesce(json_extract(_row,'$.revision'),0)+1,'$.updated_at',strftime('%Y-%m-%dT%H:%M:%fZ','now')),_hash='pending' WHERE json_extract(_row,'$.scope')='catalog';
    ${name==='cards'?projectedChildren(finalRow,oldRow):''}
    ${name==='catalog_search_entries'?`INSERT INTO _catalog_entry_fts(rowid,search_text) SELECT rowid,coalesce(json_extract(_row,'$.search_text'),'') FROM ${storage} WHERE _key=new._key; DELETE FROM _catalog_entry_tags WHERE entry_rowid=new.rowid; INSERT OR IGNORE INTO _catalog_entry_tags(tag,entry_rowid) SELECT j.value,new.rowid FROM ${storage} e,json_each(e._row,'$.tags')j WHERE e._key=new._key AND typeof(j.value)='text';`:''}
    UPDATE _catalog_write_context SET depth=0 WHERE id=1;
   END`)
  }
  const childGuard=name==='cards'?" OR EXISTS(SELECT 1 FROM _copy_catalog_search_entries e WHERE json_extract(e._row,'$.card_id')=json_extract(old._row,'$.id') AND json_extract(e._row,'$.manual_overrides')<>'{}')":''
  await client.execute(`CREATE TRIGGER IF NOT EXISTS ${qid('_catalog_preserve_delete_'+name)} BEFORE DELETE ON ${storage} WHEN (SELECT mode FROM _catalog_write_context WHERE id=1)='automatic' AND (json_extract(old._row,'$.manual_overrides')<>'{}'${childGuard}) BEGIN SELECT raise(IGNORE); END`)
  const fields=table.columns.map(column=>{
   let value='new.'+qid(column.name)
   if(column.type==='jsonb'||column.type==='json'||column.type.endsWith('[]'))value='json('+value+')'
   else if(column.type==='boolean')value=`json(CASE ${value} WHEN 1 THEN 'true' WHEN 0 THEN 'false' ELSE 'null' END)`
   return `'${column.name}',${value}`
  }).join(',')
  await client.execute(`CREATE TRIGGER IF NOT EXISTS ${qid('_catalog_edit_'+name)} INSTEAD OF UPDATE ON ${qid(name)} BEGIN UPDATE ${storage} SET _row=json_object(${fields}) WHERE _key=old._key; END`)
 }
 await client.execute('INSERT INTO _catalog_guard_version(id,version) VALUES(1,2) ON CONFLICT(id) DO UPDATE SET version=excluded.version')
}
