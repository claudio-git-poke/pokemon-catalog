import {createHash} from 'node:crypto'
import {qid,sourceTable} from './turso-rest.mjs'
import {installManualGuards} from './turso-manual.mjs'
import {utcSortSql} from './turso-values.mjs'
export function visualGroupKey(asset){return createHash('md5').update('['+[asset.kind,asset.scope,asset.image_sha256??'missing:'+asset.asset_key].map(JSON.stringify).join(', ')+']').digest('hex')}
export function publicCatalogSchema(schema){
 const asset=schema.tables.find(t=>t.table_name==='catalog_visual_assets')
 return {...schema,tables:[...schema.tables,{...asset,table_name:'catalog_visual_group_members',columns:[...asset.columns,{name:'visual_group_key',type:'text',nullable:false}],foreign_keys:[]}]}
}
export async function prepareCatalogSchema(client,schema,{log=()=>{}}={}){
 const meta=(await client.execute('SELECT complete FROM _catalog_snapshot_meta WHERE id=1')).rows[0]
 if(!Number(meta?.complete))return {ready:false,reason:'snapshot-incomplete'}
 await client.batch([
  'CREATE TABLE IF NOT EXISTS _catalog_api_state(id INTEGER PRIMARY KEY CHECK(id=1),ready INTEGER NOT NULL DEFAULT 0,prepared_at TEXT)',
  'INSERT INTO _catalog_api_state(id) VALUES(1) ON CONFLICT(id) DO NOTHING',
  'CREATE TABLE IF NOT EXISTS _catalog_api_build(task TEXT PRIMARY KEY,cursor INTEGER NOT NULL DEFAULT 0,complete INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS _catalog_visual_groups(group_key TEXT PRIMARY KEY,_row TEXT NOT NULL,kind TEXT NOT NULL,has_links INTEGER NOT NULL,languages TEXT NOT NULL)',
  "CREATE VIRTUAL TABLE IF NOT EXISTS _catalog_entry_fts USING fts5(search_text,content='',tokenize='unicode61 remove_diacritics 2')",
  'CREATE TABLE IF NOT EXISTS _catalog_entry_tags(tag TEXT NOT NULL,entry_rowid INTEGER NOT NULL,PRIMARY KEY(tag,entry_rowid)) WITHOUT ROWID',
  COUNT_CACHE_TABLE,
  'CREATE INDEX IF NOT EXISTS _catalog_entry_tags_row ON _catalog_entry_tags(entry_rowid)'
 ],'write')
 await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS _catalog_cards_file_unique ON _copy_cards(json_extract(_row,'$.file_name'))")
 if(Number((await client.execute('SELECT ready FROM _catalog_api_state WHERE id=1')).rows[0].ready)){
  await client.execute('UPDATE _catalog_api_state SET ready=0 WHERE id=1')
  await installManualGuards(client,schema)
  await client.execute('UPDATE _catalog_api_state SET ready=1 WHERE id=1')
  return {ready:true,already_prepared:true}
 }
 for(const table of schema.tables){
  const exists=(await client.execute({sql:'SELECT type FROM sqlite_master WHERE name=?',args:[table.table_name]})).rows[0]
  if(exists&&exists.type!=='view')throw Error('Nome già occupato nella destinazione: '+table.table_name)
  await client.execute(`CREATE VIEW IF NOT EXISTS ${qid(table.table_name)} AS SELECT ${table.columns.map(c=>`json_extract(_row,'$.${c.name}') AS ${qid(c.name)}`).join(',')},_row,_key,rowid AS _entry_rowid FROM ${sourceTable(table.table_name)}`)
  // The large historical log uses the compound run/id index below. A second
  // expression index duplicates its existing stored-key uniqueness and consumes quota.
  if(table.table_name!=='catalog_sync_events')await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS ${qid('_catalog_pk_'+table.table_name)} ON ${sourceTable(table.table_name)}(${table.primary_key.map(c=>`json_extract(_row,'$.${c}')`).join(',')})`)
 }
 const indexes=[['cards','source_uid'],['cards','sigla','lingua','numero'],['cards','image_status'],['catalog_search_entries','card_id'],['catalog_search_entries','set_code','card_id'],['catalog_search_entries','language'],['catalog_printing_inventory','card_id'],['catalog_visual_links','asset_key'],['catalog_packaging_links','card_id'],['catalog_sync_events','run_id','id']]
 for(const [name,...fields]of indexes)await client.execute(`CREATE INDEX IF NOT EXISTS ${qid('_catalog_idx_'+name+'_'+fields.join('_'))} ON ${sourceTable(name)}(${fields.map(f=>`json_extract(_row,'$.${f}')`).join(',')})`)
 await ensureReadIndexes(client)
 await client.execute("INSERT INTO _catalog_api_build(task) VALUES('search-index') ON CONFLICT(task) DO NOTHING")
 let saved=(await client.execute("SELECT * FROM _catalog_api_build WHERE task='search-index'")).rows[0]
 while(!Number(saved.complete)){
  const positions=(await client.execute({sql:'SELECT _position FROM _copy_catalog_search_entries WHERE _position>? ORDER BY _position LIMIT 1500',args:[Number(saved.cursor)]})).rows
  if(!positions.length){await client.execute("UPDATE _catalog_api_build SET complete=1 WHERE task='search-index'");break}
  const last=Number(positions.at(-1)._position),args=[Number(saved.cursor),last]
  await client.batch([
   {sql:"INSERT INTO _catalog_entry_fts(rowid,search_text) SELECT rowid,coalesce(json_extract(_row,'$.search_text'),'') FROM _copy_catalog_search_entries WHERE _position>? AND _position<=?",args},
   {sql:"INSERT OR IGNORE INTO _catalog_entry_tags(tag,entry_rowid) SELECT j.value,e.rowid FROM _copy_catalog_search_entries e,json_each(e._row,'$.tags') j WHERE e._position>? AND e._position<=? AND typeof(j.value)='text'",args},
   {sql:"UPDATE _catalog_api_build SET cursor=? WHERE task='search-index'",args:[last]}
  ],'write')
  saved=(await client.execute("SELECT * FROM _catalog_api_build WHERE task='search-index'")).rows[0]
  if(last%15000===0)await log({phase:'search-index',rows:last})
 }
 const assets=(await client.execute('SELECT _key,_row FROM _copy_catalog_visual_assets')).rows.map(r=>({...JSON.parse(r._row),_storage_key:r._key}))
 const columns=(await client.execute('PRAGMA table_info(_copy_catalog_visual_assets)')).rows
 if(!columns.some(c=>c.name==='_group_key'))await client.execute('ALTER TABLE _copy_catalog_visual_assets ADD COLUMN _group_key TEXT')
 const groups=new Map()
 for(const asset of assets){const key=visualGroupKey(asset);const members=groups.get(key)||[];members.push(asset);groups.set(key,members)}
 const statements=[]
 for(const [groupKey,members]of groups){
  members.sort((a,b)=>Number(b.availability==='available')-Number(a.availability==='available')||Number(b.match_mode!=null)-Number(a.match_mode!=null)||Number(b.source_language==='en')-Number(a.source_language==='en')||a.asset_key.localeCompare(b.asset_key))
  const {_storage_key,...representative}=members[0]
  const languages=[...new Set(members.map(a=>a.source_language))].sort(),sourceCodes=[...new Set(members.map(a=>a.source_code))].sort(),hasLinks=members.some(a=>a.match_mode!=null)
  const row={...representative,group_key:groupKey,languages,source_codes:sourceCodes,member_asset_keys:members.map(a=>a.asset_key).sort(),reference_count:members.length,has_links:hasLinks}
  statements.push({sql:'INSERT INTO _catalog_visual_groups(group_key,_row,kind,has_links,languages) VALUES(?,?,?,?,?) ON CONFLICT(group_key) DO UPDATE SET _row=excluded._row,kind=excluded.kind,has_links=excluded.has_links,languages=excluded.languages',args:[groupKey,JSON.stringify(row),row.kind,hasLinks?1:0,JSON.stringify(languages)]})
  for(const asset of members)statements.push({sql:'UPDATE _copy_catalog_visual_assets SET _group_key=? WHERE _key=?',args:[groupKey,asset._storage_key]})
 }
 for(let offset=0;offset<statements.length;offset+=100)await client.batch(statements.slice(offset,offset+100),'write')
 await client.execute('CREATE INDEX IF NOT EXISTS _catalog_visual_group_idx ON _copy_catalog_visual_assets(_group_key)')
 await client.execute("CREATE VIEW IF NOT EXISTS _copy_catalog_visual_group_members AS SELECT _key,_hash,_position,json_set(_row,'$.visual_group_key',_group_key) _row FROM _copy_catalog_visual_assets")
 // These triggers update only derived indexes; document contents and manual values stay authoritative.
 await client.batch([
  "CREATE TRIGGER IF NOT EXISTS _catalog_search_delete AFTER DELETE ON _copy_catalog_search_entries BEGIN INSERT INTO _catalog_entry_fts(_catalog_entry_fts,rowid,search_text) VALUES('delete',old.rowid,coalesce(json_extract(old._row,'$.search_text'),'')); DELETE FROM _catalog_entry_tags WHERE entry_rowid=old.rowid; END",
 ],'write')
 await installManualGuards(client,schema)
 await client.execute({sql:'UPDATE _catalog_api_state SET ready=1,prepared_at=? WHERE id=1',args:[new Date().toISOString()]})
 return {ready:true,groups:groups.size}
}

// Read indexes added after the first upload: searches by number or by total
// alone scanned all 349,530 printings (about 360,000 rows read each), and the
// incremental Bindex feeds sorted whole tables by modification time on every
// page (152,000 inventory rows per page of 500).
const field=f=>`json_extract(_row,'$.${f}')`
// Exact counts of large tables are reused until the catalog revision changes.
export const COUNT_CACHE_TABLE='CREATE TABLE IF NOT EXISTS _catalog_count_cache(key TEXT PRIMARY KEY,revision TEXT NOT NULL,n INTEGER NOT NULL,at TEXT NOT NULL) WITHOUT ROWID'
export const READ_INDEXES=[
 // /carte: page order and photo counters over about 195,000 cards.
 ['_catalog_idx_cards_catalog_order','cards',[field('sigla'),field('numero'),field('id')]],
 ['_catalog_idx_cards_photo','cards',[field('image_status'),field('image_url')]],
 ['_catalog_idx_catalog_search_entries_collector_number','catalog_search_entries',[field('collector_number')]],
 ['_catalog_idx_catalog_search_entries_denominator','catalog_search_entries',[field('denominator')]],
 ['_catalog_feed_set_carte','set_carte',[utcSortSql(field('aggiornato_il')),field('sigla'),field('numero'),field('variante')]],
 ['_catalog_feed_set_espansioni','set_espansioni',[utcSortSql(field('aggiornato_il')),field('sigla')]],
 ['_catalog_feed_set_carte_immagini','set_carte_immagini',[utcSortSql(field('aggiornato_il')),field('sigla'),field('numero'),field('variante'),field('lingua')]],
 ['_catalog_feed_printing_inventory','catalog_printing_inventory',[utcSortSql(field('updated_at')),field('record_key')]]
]
export async function ensureReadIndexes(client,{log=()=>{}}={}){
 const created=[]
 await client.execute(COUNT_CACHE_TABLE)
 for(const [index,name,expressions]of READ_INDEXES){
  if((await client.execute({sql:"SELECT 1 FROM sqlite_master WHERE type='index' AND name=?",args:[index]})).rows.length)continue
  await client.execute(`CREATE INDEX IF NOT EXISTS ${qid(index)} ON ${sourceTable(name)}(${expressions.join(',')})`)
  created.push(index);log({phase:'read-index',index})
 }
 return created
}
