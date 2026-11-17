// A bounded, parameterized subset of the public PostgREST read contract.
// SQL identifiers come from the captured schema; user values are always bound.
export class CatalogRestError extends Error{
 constructor(message,code='PGRST100',status=400){super(message);this.code=code;this.status=status}
}
export const qid=value=>'"'+String(value).replaceAll('"','""')+'"'
export const sourceTable=name=>qid('_copy_'+name)
export function splitTop(value,delimiter=','){
 const parts=[];let start=0,depth=0,quoted=false,escaped=false
 for(let i=0;i<value.length;i++){
  const c=value[i]
  if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue}
  if(c==='"'){quoted=true;continue}
  if(c==='('||c==='{')depth++
  if(c===')'||c==='}')depth--
  if(depth<0)throw new CatalogRestError('Espressione non bilanciata.')
  if(c===delimiter&&depth===0){parts.push(value.slice(start,i).trim());start=i+1}
 }
 if(quoted||depth)throw new CatalogRestError('Espressione non bilanciata.')
 parts.push(value.slice(start).trim());return parts
}
export function tableSchema(schema,name,privileged=false){
 const table=schema.tables.find(t=>t.table_name===name)
 if(!table)throw new CatalogRestError('Tabella non disponibile.','PGRST205',404)
 if(!privileged&&!table.anon_read)throw new CatalogRestError('Lettura non consentita.','42501',403)
 if(!/^[a-z][a-z0-9_]*$/.test(name))throw new CatalogRestError('Nome tabella non valido.')
 return table
}
export function fieldExpression(table,field,alias='e'){
 const match=field.match(/^([a-z][a-z0-9_]*)(.*)$/)
 if(!match)throw new CatalogRestError('Campo non valido.')
 const column=table.columns.find(c=>c.name===match[1]);if(!column)throw new CatalogRestError('Campo sconosciuto: '+match[1])
 const steps=[...match[2].matchAll(/(->>?)([A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*)/g)]
 if(steps.map(s=>s[0]).join('')!==match[2])throw new CatalogRestError('Percorso JSON non valido.')
 const path='$.'+match[1]+steps.map(s=>/^\d+$/.test(s[2])?'['+s[2]+']':'."'+s[2]+'"').join('')
 let sql=`json_extract(${alias}._row,'${path}')`
 const text=steps.at(-1)?.[1]==='->>'
 if(text)sql=`CAST(${sql} AS TEXT)`
 return {sql,column,text,steps,name:steps.at(-1)?.[2]||column.name}
}
function literal(value){
 if(value.startsWith('"')){try{return JSON.parse(value)}catch{throw new CatalogRestError('Valore tra virgolette non valido.')}}
 return value
}
function scalar(value,column){
 value=literal(value)
 if(column.type==='boolean'&&['true','false'].includes(value))return value==='true'?1:0
 if(/^(?:bigint|integer|smallint|numeric|real|double precision)/.test(column.type)&&value!==''&&Number.isFinite(Number(value)))return Number(value)
 return value
}
function arrayValues(value){
 if(!value.startsWith('{')||!value.endsWith('}'))throw new CatalogRestError('Array non valido.')
 return value==='{}'?[]:splitTop(value.slice(1,-1)).map(literal)
}
export class ReadCompiler{
 constructor(schema,table,privileged=false){this.schema=schema;this.table=table;this.privileged=privileged;this.args=[];this.counter=0}
 bind(value){this.args.push(value);return '?'}
 compare(field,expression,table=this.table,alias='e'){
  const m=expression.match(/^(not\.)?(eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|ov|fts(?:\([^)]*\))?|plfts(?:\([^)]*\))?|phfts(?:\([^)]*\))?|wfts(?:\([^)]*\))?)\.(.*)$/s)
  if(!m)throw new CatalogRestError('Operatore non supportato.')
  const [,negative,op,value]=m,{sql,column}=fieldExpression(table,field,alias)
  let result
  if(['eq','neq','gt','gte','lt','lte'].includes(op))result=sql+' '+({eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='}[op])+' '+this.bind(scalar(value,column))
  else if(op==='is'){
   if(!['null','true','false'].includes(value))throw new CatalogRestError('Valore IS non valido.')
   result=sql+' IS '+({null:'NULL',true:'1',false:'0'}[value])
  }else if(op==='like'||op==='ilike'){
   const pattern=String(literal(value)).replaceAll('*','%')
   if(op==='ilike')result=`lower(${sql}) LIKE lower(${this.bind(pattern)})`
   else result=sql+' GLOB '+this.bind([...pattern].map(c=>c==='%'?'*':c==='_'?'?':c==='?'?'[?]':c==='['?'[[]':c).join(''))
  }else if(op==='in'){
   if(!value.startsWith('(')||!value.endsWith(')'))throw new CatalogRestError('Elenco IN non valido.')
   const values=value==='()'?[]:splitTop(value.slice(1,-1)).map(v=>scalar(v,column))
   if(values.length>1000)throw new CatalogRestError('Troppi valori nel filtro.')
   result=values.length?sql+' IN ('+values.map(v=>this.bind(v)).join(',')+')':'0'
  }else if(['cs','cd','ov'].includes(op)){
   const values=arrayValues(value)
   if(op==='cs')result=values.length?values.map(v=>`EXISTS(SELECT 1 FROM json_each(${sql}) j WHERE j.value=${this.bind(v)})`).join(' AND '):'1'
   if(op==='ov')result=values.length?`EXISTS(SELECT 1 FROM json_each(${sql}) j WHERE j.value IN (${values.map(v=>this.bind(v)).join(',')}))`:'0'
   if(op==='cd')result=`NOT EXISTS(SELECT 1 FROM json_each(${sql}) j WHERE j.value NOT IN (SELECT value FROM json_each(${this.bind(JSON.stringify(values))})))`
  }else{
   if(table.table_name!=='catalog_search_entries'||field!=='search_vector')throw new CatalogRestError('Ricerca testuale non disponibile sul campo.')
   const isPhrase=op.startsWith('phfts'),plain=op.startsWith('plfts')||op.startsWith('wfts')
   if(!plain&&!isPhrase&&/[|!<>]/.test(value))throw new CatalogRestError('Questa espressione testuale richiede termini congiunti con &.')
   const words=(plain||isPhrase?value.split(/\s+/):value.split('&')).map(v=>v.trim()).filter(Boolean)
   const query=isPhrase?'"'+words.join(' ').replaceAll('"','""')+'"':words.map(word=>{
    const prefix=word.endsWith(':*');word=word.replace(/:\*$/,'').replace(/^'(.*)'$/,'$1')
    return '"'+word.replaceAll('"','""')+'"'+(prefix?'*':'')
   }).join(' AND ')
   result=query?`${alias}.rowid IN(SELECT rowid FROM _catalog_entry_fts WHERE _catalog_entry_fts MATCH ${this.bind(query)})`:'0'
  }
  return negative?'NOT ('+result+')':'('+result+')'
 }
 boolean(value,operator='OR',table=this.table,alias='e'){
  if(!value.startsWith('(')||!value.endsWith(')'))throw new CatalogRestError('Gruppo di filtri non valido.')
  const conditions=splitTop(value.slice(1,-1));if(conditions.length>100)throw new CatalogRestError('Troppi filtri.')
  return '('+conditions.map(term=>{
   const group=term.match(/^(not\.)?(or|and)\((.*)\)$/s)
   if(group){const inner=this.boolean('('+group[3]+')',group[2].toUpperCase(),table,alias);return group[1]?'NOT '+inner:inner}
   const match=term.match(/^([a-z][a-z0-9_]*(?:->>?[A-Za-z0-9_-]+)*)\.(.*)$/s)
   if(!match)throw new CatalogRestError('Filtro non valido.')
   return this.compare(match[1],match[2],table,alias)
  }).join(' '+operator+' ')+')'
 }
 where(params,table=this.table,alias='e'){
  const ignored=new Set(['select','order','limit','offset','on_conflict','columns']),parts=[]
  if([...params.keys()].length>100)throw new CatalogRestError('Troppi filtri.')
  for(const [field,value]of params){
   if(ignored.has(field))continue
   if(['or','and','not.or','not.and'].includes(field)){const sql=this.boolean(value,field.endsWith('and')?'AND':'OR',table,alias);parts.push(field.startsWith('not.')?'NOT '+sql:sql)}
   else parts.push(this.compare(field,value,table,alias))
  }
  return parts.length?parts.join(' AND '):'1'
 }
 relation(table,name){
  const target=tableSchema(this.schema,name,this.privileged)
  const direct=(table.foreign_keys||[]).filter(f=>f.target.replace(/^public\./,'')===name)
  const inverse=(target.foreign_keys||[]).filter(f=>f.target.replace(/^public\./,'')===table.table_name)
  if(direct.length+inverse.length!==1)throw new CatalogRestError('Relazione sconosciuta o ambigua: '+name)
  return {target,foreign:(direct[0]||inverse[0]),many:!direct.length}
 }
 joinCondition(relation,parentAlias,targetAlias){
  const f=relation.foreign
  return f.columns.map((column,i)=>{
   const left=relation.many?fieldExpression(relation.target,column,targetAlias).sql:fieldExpression(this.currentParent,column,parentAlias).sql
   const right=relation.many?fieldExpression(this.currentParent,f.target_columns[i],parentAlias).sql:fieldExpression(relation.target,f.target_columns[i],targetAlias).sql
   return left+'='+right
  }).join(' AND ')
 }
 projection(select='*',table=this.table,alias='e',depth=0){
  if(depth>3)throw new CatalogRestError('Troppe relazioni annidate.')
  const fields=splitTop(select),entries=[],embeds=[];let star=false
  for(const field of fields){
   if(field==='*'){star=true;continue}
   const relation=field.match(/^(?:([a-z][a-z0-9_]*):)?([a-z][a-z0-9_]*)(?:!(inner|left))?\((.*)\)$/s)
   if(relation){
    if(relation[3]==='inner')throw new CatalogRestError('Usare un filtro esplicito per questa relazione.')
    const info=this.relation(table,relation[2]),a='j'+(++this.counter),child=this.projection(relation[4],info.target,a,depth+1)
    this.currentParent=table;const condition=this.joinCondition(info,alias,a)
    const query=info.many?`(SELECT coalesce(json_group_array(json(${child})),'[]') FROM ${sourceTable(info.target.table_name)} ${a} WHERE ${condition})`:`(SELECT ${child} FROM ${sourceTable(info.target.table_name)} ${a} WHERE ${condition} LIMIT 1)`
    embeds.push({key:relation[1]||relation[2],sql:'json('+query+')'});continue
   }
   const colon=field.indexOf(':'),name=colon>=0?field.slice(0,colon):null,expression=colon>=0?field.slice(colon+1):field
   if(name&&!/^[a-z][a-z0-9_]*$/.test(name))throw new CatalogRestError('Alias non valido.')
   const f=fieldExpression(table,expression,alias)
   let sql=f.sql
   if(f.column.type==='boolean'&&!f.steps.length)sql=`json(CASE ${sql} WHEN 1 THEN 'true' WHEN 0 THEN 'false' ELSE 'null' END)`
   entries.push({key:name||f.name,sql})
  }
  const all=[...entries,...embeds]
  if(star){if(!all.length)return `${alias}._row`;return 'json_set('+alias+'._row,'+all.map(e=>`'$.${e.key}',${e.sql}`).join(',')+')'}
  if(!all.length)throw new CatalogRestError('Selezione vuota.')
  return 'json_object('+all.map(e=>`'${e.key}',${e.sql}`).join(',')+')'
 }
 order(value,table=this.table,alias='e'){
  if(!value)return table.primary_key.map(k=>fieldExpression(table,k,alias).sql+' ASC').join(',')
  return splitTop(value).map(item=>{
   const match=item.match(/^(.+?)(?:\.(asc|desc))?(?:\.(nullsfirst|nullslast))?$/)
   if(!match)throw new CatalogRestError('Ordinamento non valido.')
   const related=match[1].match(/^([a-z][a-z0-9_]*)\(([a-z][a-z0-9_]*)\)$/)
   let expression
   if(related){
    const info=this.relation(table,related[1]);if(info.many)throw new CatalogRestError('Ordinamento su relazione multipla non supportato.')
    const a='o'+(++this.counter);this.currentParent=table
    expression=`(SELECT ${fieldExpression(info.target,related[2],a).sql} FROM ${sourceTable(info.target.table_name)} ${a} WHERE ${this.joinCondition(info,alias,a)} LIMIT 1)`
   }else expression=fieldExpression(table,match[1],alias).sql
   return expression+' '+(match[2]||'asc').toUpperCase()+(match[3]?' NULLS '+(match[3]==='nullsfirst'?'FIRST':'LAST'):'')
  }).join(',')
 }
}
export async function readCatalogRows(client,schema,name,params=new URLSearchParams(),options={}){
 const table=tableSchema(schema,name,options.privileged),compiler=new ReadCompiler(schema,table,options.privileged)
 const where=compiler.where(params),projection=compiler.projection(params.get('select')||'*'),order=compiler.order(params.get('order'))
 const requested=Number(params.get('limit')??1000),offset=Number(params.get('offset')??0)
 if(!Number.isSafeInteger(requested)||requested<0||!Number.isSafeInteger(offset)||offset<0||offset>2000000)throw new CatalogRestError('Paginazione non valida.')
 const limit=Math.min(requested,1000)
 const count=options.count?Number((await client.execute({sql:`SELECT count(*) n FROM ${sourceTable(name)} e WHERE ${where}`,args:compiler.args})).rows[0].n):null
 const rows=options.head?[]:(await client.execute({sql:`SELECT ${projection} AS document FROM ${sourceTable(name)} e WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,args:[...compiler.args,limit,offset]})).rows.map(r=>JSON.parse(r.document))
 return {rows,count,offset,limit}
}
