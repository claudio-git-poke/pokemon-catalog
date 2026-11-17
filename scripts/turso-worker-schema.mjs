// Rebuild the existing application SQL only in an isolated, disposable PostgreSQL.
// This module never connects to, modifies, or drops the original Supabase project.
const qid=value=>'"'+String(value).replaceAll('"','""')+'"'
const literal=value=>"'"+String(value).replaceAll("'","''")+"'"
const qualified=(schema,name)=>qid(schema)+'.'+qid(name)
export function workerSchemaStatements(snapshot){
 if(snapshot.version!==1||snapshot.tables?.length!==31||snapshot.functions?.length!==71)throw Error('Schema del worker incompleto.')
 const statements=[
  "SET check_function_bodies=off; SET timezone='UTC'; SET standard_conforming_strings=on;",
  ...['anon','authenticated','service_role'].map(role=>`DO $role$ BEGIN CREATE ROLE ${qid(role)} NOLOGIN ${role==='service_role'?'BYPASSRLS':''}; EXCEPTION WHEN duplicate_object THEN NULL; END $role$;`),
  'CREATE SCHEMA IF NOT EXISTS catalog_internal; CREATE SCHEMA IF NOT EXISTS auth;',
  "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid $$;",
  'GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role; GRANT USAGE ON SCHEMA catalog_internal TO service_role;'
 ]
 for(const sequence of snapshot.sequences.filter(s=>!s.ownership?.identity))statements.push(sequenceSql(sequence))
 for(const table of snapshot.tables){
  const columns=table.columns.map(column=>{
   let sql=qid(column.name)+' '+column.type
   if(column.identity){
    const sequence=snapshot.sequences.find(s=>s.ownership?.table===table.name&&s.ownership?.column===column.name)
    if(!sequence)throw Error('Sequenza identity mancante.')
    sql+=' GENERATED '+(column.identity==='a'?'ALWAYS':'BY DEFAULT')+' AS IDENTITY (SEQUENCE NAME '+qualified(sequence.schema,sequence.name)+' '+sequenceOptions(sequence)+')'
   }else if(column.generated)sql+=' GENERATED ALWAYS AS ('+column.default+') STORED'
   else if(column.default!==null)sql+=' DEFAULT '+column.default
   return sql+(column.not_null?' NOT NULL':'')
  })
  statements.push('CREATE TABLE '+qualified('public',table.name)+'('+columns.join(',')+');')
 }
 statements.push(...snapshot.functions.filter(f=>!f.deferred).map(f=>f.definition))
 const pending=new Map(snapshot.views.map(v=>[v.name,v])),done=new Set()
 while(pending.size){
  const available=[...pending.values()].filter(v=>v.dependencies.every(d=>done.has(d)))
  if(!available.length)throw Error('Dipendenza circolare fra viste del worker.')
  for(const view of available){statements.push('CREATE VIEW '+qualified('public',view.name)+' WITH(security_invoker=true) AS '+view.definition);pending.delete(view.name);done.add(view.name)}
 }
 statements.push(...snapshot.functions.filter(f=>f.deferred).map(f=>f.definition))
 const constraintOrder={p:0,u:1,c:2,f:3}
 for(const constraint of [...snapshot.constraints].sort((a,b)=>(constraintOrder[a.type]??4)-(constraintOrder[b.type]??4)))statements.push('ALTER TABLE '+qualified('public',constraint.table)+' ADD CONSTRAINT '+qid(constraint.name)+' '+constraint.definition+';')
 statements.push(...snapshot.indexes.map(sql=>sql+';'),...snapshot.triggers.map(sql=>sql+';'))
 for(const policy of snapshot.policies){
  const roles=policy.roles.map(qid).join(',')
  statements.push('CREATE POLICY '+qid(policy.policyname)+' ON '+qualified(policy.schemaname,policy.tablename)+' AS '+policy.permissive+' FOR '+policy.cmd+' TO '+roles+(policy.qual?' USING('+policy.qual+')':'')+(policy.with_check?' WITH CHECK('+policy.with_check+')':'')+';')
 }
 for(const table of snapshot.tables){
  const name=qualified('public',table.name)
  statements.push('REVOKE ALL ON '+name+' FROM PUBLIC,anon,authenticated,service_role;')
  if(table.rls)statements.push('ALTER TABLE '+name+' ENABLE ROW LEVEL SECURITY;')
  statements.push(...grants(table,name))
 }
 for(const view of snapshot.views)statements.push(...grants(view,qualified('public',view.name)))
 for(const fn of snapshot.functions){
  const name=qualified(fn.schema,fn.name)+'('+fn.args+')'
  statements.push('REVOKE ALL ON FUNCTION '+name+' FROM PUBLIC,anon,authenticated,service_role;')
  if(fn.execute_roles?.length)statements.push('GRANT EXECUTE ON FUNCTION '+name+' TO '+fn.execute_roles.map(qid).join(',')+';')
 }
 statements.push('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role; SET check_function_bodies=on;')
 return statements
}
function sequenceOptions(s){
 for(const key of ['start','increment','min','max','cache'])if(!/^-?\d+$/.test(s[key]))throw Error('Opzione di sequenza non valida.')
 return 'START WITH '+s.start+' INCREMENT BY '+s.increment+' MINVALUE '+s.min+' MAXVALUE '+s.max+' CACHE '+s.cache+(s.cycle?' CYCLE':' NO CYCLE')
}
function sequenceSql(s){return 'CREATE SEQUENCE '+qualified(s.schema,s.name)+' AS '+s.type+' '+sequenceOptions(s)+';'}
function grants(entry,name){return Object.entries(entry.grants||{}).filter(([,privileges])=>privileges?.length).map(([role,privileges])=>'GRANT '+privileges.join(',')+' ON '+name+' TO '+qid(role)+';')}

export function restorePageSql(table,rows){
 const writable=table.columns.filter(c=>!c.generated).map(c=>qid(c.name))
 return 'INSERT INTO '+qualified('public',table.name)+'('+writable.join(',')+') OVERRIDING SYSTEM VALUE SELECT '+writable.join(',')+' FROM jsonb_populate_recordset(NULL::'+qualified('public',table.name)+','+literal(JSON.stringify(rows))+'::jsonb);'
}
