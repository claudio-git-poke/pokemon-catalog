// Minimal PostgREST-shaped test adapter. Executes worker queries against real PostgreSQL (PGlite).
const ident = s => { if (!/^[a-z_][a-z_0-9]*$/i.test(s)) throw Error('Invalid identifier'); return `"${s}"` }
export function postgresClient(pg) {
 return { from(table) {
  let mode='select',payload,options={},conditions=[],orders=[],limit,offset=0,single=false,optional=false
  const q={
   select(){return q},insert(p){mode='insert';payload=p;return q},upsert(p,o={}){mode='upsert';payload=p;options=o;return q},update(p){mode='update';payload=p;return q},
   eq(k,v){conditions.push([k,'=',v]);return q},neq(k,v){conditions.push([k,'<>',v]);return q},lte(k,v){conditions.push([k,'<=',v]);return q},is(k,v){conditions.push([k,'is',v]);return q},in(k,v){conditions.push([k,'in',v]);return q},
   order(k){orders.push(k);return q},limit(n){limit=n;return q},range(a,b){offset=a;limit=b-a+1;return q},single(){single=true;return q},maybeSingle(){single=true;optional=true;return q},
   async then(resolve,reject){
    try {
     const params=[]; const value=v=>{params.push(typeof v==='object' && v!==null ? JSON.stringify(v):v);return `$${params.length}`}
     const where=()=>conditions.length ? ' where '+conditions.map(([k,op,v])=>op==='is'?`${ident(k)} is null`:op==='in'?`${ident(k)} in (${v.map(value).join(',')})`:`${ident(k)} ${op} ${value(v)}`).join(' and '):''
     let sql
     if(mode==='select')sql=`select * from ${ident(table)}${where()}${orders.length?' order by '+orders.map(ident).join(','):''}${limit!==undefined?' limit '+limit:''} offset ${offset}`
     else if(mode==='update')sql=`update ${ident(table)} set ${Object.entries(payload).map(([k,v])=>`${ident(k)}=${value(v)}`).join(',')}${where()} returning *`
     else {
      const rows=Array.isArray(payload)?payload:[payload], keys=Object.keys(rows[0])
      sql=keys.length?`insert into ${ident(table)} (${keys.map(ident).join(',')}) values ${rows.map(r=>'('+keys.map(k=>value(r[k])).join(',')+')').join(',')}`:`insert into ${ident(table)} default values`
      if(mode==='upsert') {
       const key=options.onConflict || (table==='catalog_sync_sets'?'source_uid':'id')
       sql+=` on conflict (${ident(key)}) do `+(options.ignoreDuplicates?'nothing':`update set ${keys.map(k=>`${ident(k)}=excluded.${ident(k)}`).join(',')}`)
      }
      sql+=' returning *'
     }
     const {rows}=await pg.query(sql,params)
     if(single && rows.length!==1 && !(optional && rows.length===0))throw Error('Expected one row')
     return resolve({data:single?(rows[0]||null):rows,error:null})
    }catch(e){return resolve({data:null,error:{message:e.message}})}
   }
  };return q
 }}
}
