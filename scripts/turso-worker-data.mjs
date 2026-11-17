import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto'
import {gzipSync,gunzipSync} from 'node:zlib'
import {canonicalJson,hash} from './turso-snapshot.mjs'
import {restorePageSql} from './turso-worker-schema.mjs'
const qid=value=>'"'+String(value).replaceAll('"','""')+'"'
const MAX_PACKET=50*1024*1024
const MAX_CHANGES=12000

// The original technical log stays in Turso. A disposable worker needs only
// new log events; domain data and the full manual history are always restored.
export async function hydrateWorker({client,snapshot,executeSql,log=()=>{}}){
 // executeSql must use one persistent disposable PostgreSQL session, so its
 // replication setting remains in effect across every hydration page.
 const complete=(await client.execute('SELECT complete FROM _catalog_snapshot_meta WHERE id=1')).rows[0]
 if(!Number(complete?.complete))throw Error('La copia non è ancora verificata.')
 await executeSql('SET session_replication_role=replica;')
 try{
  for(const table of snapshot.tables){
   if(table.name==='catalog_sync_events')continue
   let position=0,total=0,pageSize=table.name==='catalog_sync_runs'?10:400
   for(;;){
    const page=(await client.execute({sql:'SELECT _row,_position FROM '+qid('_copy_'+table.name)+' WHERE _position>? ORDER BY _position LIMIT ?',args:[position,pageSize]})).rows
    if(!page.length)break
    const rows=page.map(r=>JSON.parse(r._row))
    await executeSql(restorePageSql(table,rows));position=Number(page.at(-1)._position);total+=rows.length
    if(page.length<pageSize)break
   }
   await log({phase:'restore-worker',table:table.name,rows:total})
  }
  for(const sequence of snapshot.sequences){
   const owner=sequence.ownership;if(!owner)continue
   const maximum=(await client.execute('SELECT json_extract(_row,\'$.'+owner.column+'\') value FROM '+qid('_copy_'+owner.table)+' ORDER BY _position DESC LIMIT 1')).rows[0]?.value
   if(maximum!=null){if(!Number.isSafeInteger(Number(maximum))||Number(maximum)<1)throw Error('Sequenza non rappresentabile senza perdita.');await executeSql("SELECT pg_catalog.setval('"+sequence.schema+'.'+sequence.name+"',"+Number(maximum)+',true);')}
  }
 }finally{await executeSql('SET session_replication_role=origin;')}
}

export function captureDeltaStatements(snapshot){
 const statements=[
  'CREATE TABLE catalog_internal.turso_worker_delta(table_name text NOT NULL,record_key jsonb NOT NULL,first_old jsonb,last_new jsonb,PRIMARY KEY(table_name,record_key));',
  `CREATE FUNCTION catalog_internal.capture_turso_delta() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
   DECLARE previous jsonb;following jsonb;old_key jsonb;new_key jsonb;fields text[];field text;
   BEGIN
    fields:=string_to_array(TG_ARGV[0],',');
    IF TG_OP<>'INSERT' THEN previous:=to_jsonb(OLD);SELECT jsonb_agg(previous->f ORDER BY position) INTO old_key FROM unnest(fields) WITH ORDINALITY x(f,position);END IF;
    IF TG_OP<>'DELETE' THEN following:=to_jsonb(NEW);SELECT jsonb_agg(following->f ORDER BY position) INTO new_key FROM unnest(fields) WITH ORDINALITY x(f,position);END IF;
    IF TG_OP='UPDATE' AND old_key IS DISTINCT FROM new_key THEN
     INSERT INTO catalog_internal.turso_worker_delta VALUES(TG_TABLE_NAME,old_key,previous,NULL)
     ON CONFLICT(table_name,record_key) DO UPDATE SET last_new=NULL;
     previous:=NULL;
    END IF;
    INSERT INTO catalog_internal.turso_worker_delta VALUES(TG_TABLE_NAME,coalesce(new_key,old_key),previous,following)
    ON CONFLICT(table_name,record_key) DO UPDATE SET last_new=excluded.last_new;
    RETURN NULL;
   END $fn$;`
 ]
 for(const table of snapshot.tables){
  // Technical log rows never reach Turso: they are kept in GitHub Actions output.
  if(table.name==='catalog_sync_events')continue
  const primary=snapshot.constraints.find(c=>c.table===table.name&&c.type==='p')?.definition.match(/^PRIMARY KEY \(([^)]+)\)/)?.[1].split(',').map(k=>k.trim().replaceAll('"',''))
  if(!primary?.length||primary.some(k=>!/^[a-z][a-z0-9_]*$/.test(k)))throw Error('Chiave primaria non valida: '+table.name)
  statements.push('CREATE TRIGGER zzzzzz_turso_delta AFTER INSERT OR UPDATE OR DELETE ON public.'+qid(table.name)+" FOR EACH ROW EXECUTE FUNCTION catalog_internal.capture_turso_delta('"+primary.join(',')+"');")
 }
 return statements
}

export function sealWorkerDelta(packet,key=randomBytes(32)){
 if(!packet||packet.contract!=='catalog-worker-delta-v1'||!Array.isArray(packet.changes)||packet.changes.length>MAX_CHANGES)throw Error('Differenze del worker non valide o troppo numerose.')
 const text=canonicalJson(packet)
 if(Buffer.byteLength(text)>MAX_PACKET)throw Error('Differenze del worker troppo grandi: ridurre il lotto.')
 if(key.length!==32)throw Error('Chiave di cifratura non valida.')
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),compressed=gzipSync(text)
 const ciphertext=Buffer.concat([cipher.update(compressed),cipher.final()])
 const bytes=Buffer.concat([Buffer.from('TURSO-D1'),iv,cipher.getAuthTag(),ciphertext])
 return {bytes,key,digest:hash(bytes),changes:packet.changes.length}
}
export function openWorkerDelta(bytes,key,expectedDigest){
 if(bytes.length<36||bytes.length>MAX_PACKET+100000||key.length!==32||bytes.subarray(0,8).toString()!=='TURSO-D1'||hash(bytes)!==expectedDigest)throw Error('Archivio del worker non valido.')
 let packet
 try{
  const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(8,20));decipher.setAuthTag(bytes.subarray(20,36))
  const compressed=Buffer.concat([decipher.update(bytes.subarray(36)),decipher.final()])
  packet=JSON.parse(gunzipSync(compressed,{maxOutputLength:MAX_PACKET}).toString('utf8'))
 }catch{throw Error('Archivio del worker non autenticato o non leggibile.')}
 if(packet.contract!=='catalog-worker-delta-v1'||!Array.isArray(packet.changes)||packet.changes.length>MAX_CHANGES)throw Error('Contratto del worker non valido.')
 return packet
}

// Apply only fields changed by this worker and still equal to its starting
// snapshot. Newer concurrent values and explicit manual empty values win.
export function mergeWorkerChange(before,after,current){
 if(after===null)return before!==null&&current!==null&&canonicalJson(before)===canonicalJson(current)&&!Object.keys(current.manual_overrides||{}).length?{operation:'delete'}:{operation:'keep'}
 if(current===null)return before===null?{operation:'write',row:after}:{operation:'keep'}
 if(before===null)return canonicalJson(after)===canonicalJson(current)?{operation:'keep'}:{operation:'conflict'}
 const row={...current}
 for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
  if(key==='manual_overrides'||!Object.hasOwn(after,key))continue
  const old=before[key]??null,next=after[key]??null,latest=current[key]??null
  if(canonicalJson(old)!==canonicalJson(next)&&canonicalJson(old)===canonicalJson(latest))row[key]=next
 }
 for(const [key,value]of Object.entries(current.manual_overrides||{}))row[key]=value
 if(Object.hasOwn(current,'manual_overrides'))row.manual_overrides=current.manual_overrides??{}
 return canonicalJson(row)===canonicalJson(current)?{operation:'keep'}:{operation:'write',row}
}
