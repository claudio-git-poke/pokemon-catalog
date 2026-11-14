// Apply only curated, evidence-backed changes. Identity columns are never updated.
import {readFile,writeFile} from 'node:fs/promises'
const [destination]=process.argv.slice(2)
if(!destination)throw Error('Specificare il percorso SQL di output.')
const reviews=JSON.parse(await readFile(new URL('../data/bindex-code-reviews.json',import.meta.url),'utf8'))
const allowed=new Set(['verified','no_code_in_source','pending']),seen=new Set()
for(const r of reviews){const key=JSON.stringify([r.sigla,r.numero,r.variante]);if(seen.has(key)||!allowed.has(r.status)||!r.source_urls.length)throw Error('Revisione non valida');seen.add(key);if(r.status==='verified'&&!/^[A-Z0-9][A-Z0-9.-]*( [A-Z0-9]+)?$/.test(r.proposed_code||''))throw Error('Codice non valido');if(r.status!=='verified'&&r.proposed_code!==null)throw Error('Codice non verificato')}
const json="'"+JSON.stringify(reviews).replaceAll("'","''")+"'::jsonb"
const cols=['sigla','numero','variante','cardmarket_id','status','proposed_code','source_urls','method','note','cardmarket_access']
let sql=`insert into public.catalog_code_reviews(${cols}) select ${cols} from jsonb_populate_recordset(null::public.catalog_code_reviews,${json}) on conflict(sigla,numero,variante) do update set status=excluded.status,proposed_code=excluded.proposed_code,source_urls=excluded.source_urls,method=excluded.method,note=excluded.note,cardmarket_access=excluded.cardmarket_access,aggiornato_il=clock_timestamp();\n`
sql+=`do $$ begin if exists(select 1 from public.catalog_code_reviews r join public.set_carte c using(sigla,numero,variante) where r.status='verified' and (c.cardmarket_id is distinct from r.cardmarket_id or (c.codice is not null and c.codice<>r.proposed_code))) then raise exception 'Identità o codice modificato nel frattempo: controllare prima di procedere';end if;end $$;\n`
sql+=`update public.set_carte c set codice=r.proposed_code from public.catalog_code_reviews r where (c.sigla,c.numero,c.variante)=(r.sigla,r.numero,r.variante) and r.status='verified' and c.codice is null and c.cardmarket_id=r.cardmarket_id;\n`
sql+=`update public.catalog_export_state set statistics=statistics||jsonb_build_object('codes_missing',(select count(*) from public.set_carte where codice is null),'code_reviews',(select jsonb_object_agg(status,n) from(select status,count(*) n from public.catalog_code_reviews group by status)x),'code_review_at',clock_timestamp()) where id='bindex';\n`
await writeFile(destination,sql)
console.log({reviewed:reviews.length,verified:reviews.filter(r=>r.status==='verified').length})
