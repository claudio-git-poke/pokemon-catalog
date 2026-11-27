// Read-only diagnosis of Turso reads: top queries of the database (Platform
// API stats) and usage of the last hours, hour by hour. Uses no database rows.
import {platformConfiguration} from './turso-platform.mjs'
const {token,organization}=platformConfiguration()
const name=process.env.TURSO_DATABASE_NAME||'pokemon-catalog-2'
const API='https://api.turso.tech/v1/organizations/'+organization
const get=async path=>{const r=await fetch(API+path,{headers:{authorization:'Bearer '+token}});const text=await r.text();try{return {status:r.status,body:JSON.parse(text)}}catch{return {status:r.status,body:text.slice(0,300)}}}
const stats=await get('/databases/'+name+'/stats')
console.log('STATS',stats.status)
for(const q of (stats.body?.top_queries||[]).sort((a,b)=>(b.rows_read||0)-(a.rows_read||0)).slice(0,25))console.log(JSON.stringify({rows_read:q.rows_read,rows_written:q.rows_written,query:String(q.query).slice(0,400)}))
if(!stats.body?.top_queries)console.log(JSON.stringify(stats.body).slice(0,800))
const hours=Number(process.env.HOURS||24),now=Date.now()
for(let h=hours;h>0;h-=2){
 const from=new Date(now-h*3600e3).toISOString(),to=new Date(now-(h-2)*3600e3).toISOString()
 const u=await get('/databases/'+name+'/usage?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to))
 const v=u.body?.database?.total||u.body?.database?.usage||u.body?.total||u.body
 console.log('USAGE',from.slice(5,16),'→',to.slice(11,16),u.status,JSON.stringify(v).slice(0,200))
}
