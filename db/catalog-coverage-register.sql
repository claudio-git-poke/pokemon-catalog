-- Lightweight register: only source/set metadata, never a full scan of card records.
alter table public.catalog_sync_sets
 add column coverage_detail jsonb check(coverage_detail is null or jsonb_typeof(coverage_detail)='object'),
 add column manifest_count integer check(manifest_count>=0),
 add column resolved_count integer check(resolved_count>=0),
 add column manifest_digest text,
 add column resolved_digest text,
 add column coverage_checked_at timestamptz,
 add column coverage_scope text not null default 'unclassified' check(coverage_scope in ('unclassified','physical','digital'));
create table public.catalog_language_sources(
 source_language text primary key,local_code text not null unique,label text not null,region text not null,
 source_url text not null check(source_url~'^https://api[.]tcgdex[.]net/v2/'),
 probe_status text not null default 'unprobed' check(probe_status in ('unprobed','available','empty','error')),
 listed_sets integer check(listed_sets>=0),last_probe_at timestamptz,last_error text
);
alter table public.catalog_language_sources enable row level security;
revoke all on public.catalog_language_sources from public,anon,authenticated;
grant select on public.catalog_language_sources to anon,authenticated;
grant all on public.catalog_language_sources to service_role;
create policy language_sources_read on public.catalog_language_sources for select to anon,authenticated using(true);
create policy language_sources_worker on public.catalog_language_sources for all to service_role using(true) with check(true);
insert into public.catalog_language_sources(source_language,local_code,label,region,source_url) select source_language,local_code,label,region,source_url from jsonb_to_recordset($languages$[{"source_language":"en","local_code":"INT","label":"Inglese / internazionale","region":"Internazionale","source_url":"https://api.tcgdex.net/v2/en/sets"},{"source_language":"it","local_code":"IT","label":"Italiano","region":"Europa","source_url":"https://api.tcgdex.net/v2/it/sets"},{"source_language":"fr","local_code":"FR","label":"Francese","region":"Europa","source_url":"https://api.tcgdex.net/v2/fr/sets"},{"source_language":"de","local_code":"DE","label":"Tedesco","region":"Europa","source_url":"https://api.tcgdex.net/v2/de/sets"},{"source_language":"es","local_code":"ES","label":"Spagnolo europeo","region":"Europa","source_url":"https://api.tcgdex.net/v2/es/sets"},{"source_language":"pt","local_code":"PT","label":"Portoghese","region":"Brasile","source_url":"https://api.tcgdex.net/v2/pt/sets"},{"source_language":"ko","local_code":"KOR","label":"Coreano","region":"Corea","source_url":"https://api.tcgdex.net/v2/ko/sets"},{"source_language":"ja","local_code":"JP","label":"Giapponese","region":"Giappone","source_url":"https://api.tcgdex.net/v2/ja/sets"},{"source_language":"zh-tw","local_code":"CHN-T","label":"Cinese tradizionale","region":"Taiwan / Hong Kong","source_url":"https://api.tcgdex.net/v2/zh-tw/sets"},{"source_language":"id","local_code":"ID","label":"Indonesiano","region":"Indonesia","source_url":"https://api.tcgdex.net/v2/id/sets"},{"source_language":"th","local_code":"TH","label":"Thailandese","region":"Thailandia","source_url":"https://api.tcgdex.net/v2/th/sets"},{"source_language":"zh-cn","local_code":"CHN","label":"Cinese semplificato","region":"Cina continentale","source_url":"https://api.tcgdex.net/v2/zh-cn/sets"},{"source_language":"nl","local_code":"NL","label":"Olandese","region":"Europa · storico","source_url":"https://api.tcgdex.net/v2/nl/sets"},{"source_language":"pl","local_code":"PL","label":"Polacco","region":"Europa · storico","source_url":"https://api.tcgdex.net/v2/pl/sets"},{"source_language":"ru","local_code":"RU","label":"Russo","region":"Russia · storico","source_url":"https://api.tcgdex.net/v2/ru/sets"},{"source_language":"es-mx","local_code":"ES-LA","label":"Spagnolo latinoamericano","region":"America Latina","source_url":"https://api.tcgdex.net/v2/es-mx/sets"}]$languages$::jsonb) as x(source_language text,local_code text,label text,region text,source_url text);
create function public.catalog_record_language_probe() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.provider='tcgdex' and new.set_id='__index__' then
  update public.catalog_language_sources set
   probe_status=case when new.last_error is null then 'available' else 'error' end,
   listed_sets=case when new.last_error is null then (select count(*) from public.catalog_sync_sets s where s.provider='tcgdex' and s.source_language=new.source_language and s.set_id<>'__index__') else listed_sets end,
   last_probe_at=clock_timestamp(),last_error=new.last_error
  where source_language=new.source_language;
 end if;
 return new;
end $$;
create trigger catalog_record_language_probe after insert or update on public.catalog_sync_sets for each row execute function public.catalog_record_language_probe();
revoke all on function public.catalog_record_language_probe() from public,anon,authenticated;
grant execute on function public.catalog_record_language_probe() to service_role;
-- Preserve observed index history without pretending old imports have manifest evidence.
update public.catalog_language_sources l set probe_status=case when s.last_error is null then 'available' else 'error' end,last_probe_at=s.last_sync_at,last_error=s.last_error,
 listed_sets=(select count(*) from public.catalog_sync_sets x where x.provider='tcgdex' and x.source_language=l.source_language and x.set_id<>'__index__')
from public.catalog_sync_sets s where s.source_uid='index:'||l.source_language and s.last_sync_at is not null;

-- Registry projection: public read, underlying RLS remains in force.
create view public.catalog_coverage_register with(security_invoker=true) as
with sets as (
 select s.source_uid target_key,'set'::text target_type,s.provider,s.source_language,coalesce(l.label,s.source_language) language_label,coalesce(l.region,'Da documentare') region,
  s.set_id release_code,s.name,s.coverage_scope,
  coalesce(s.reported_count,s.manifest_count) expected_count,s.resolved_count,
  s.coverage_checked_at checked_at,s.next_sync_at,
  case when s.coverage_scope='digital' then 'excluded'
   when s.last_sync_at is null then 'to_import'
   when s.last_error is not null or s.coverage_scope<>'physical' or s.coverage_checked_at is null
    or s.coverage_checked_at<now()-interval '8 days' or s.manifest_count is null or s.manifest_count=0
    or s.manifest_count is distinct from s.resolved_count or s.manifest_digest is null or s.manifest_digest is distinct from s.resolved_digest
    or (s.reported_count is not null and s.reported_count<>s.manifest_count) then 'to_review'
   else 'aligned' end status,
  case when s.coverage_scope='digital' then 'Pokémon TCG Pocket escluso dal catalogo fisico.'
   when s.last_error is not null then s.last_error
   when s.last_sync_at is null then 'Prima importazione non completata.'
   when s.coverage_checked_at is null then 'Importazione precedente: confronto degli identificativi ancora da registrare.'
   when s.coverage_scope<>'physical' then 'Ambito fisico/digitale da classificare.'
   when s.coverage_checked_at<now()-interval '8 days' then 'Confronto da aggiornare.'
   when s.manifest_count is distinct from s.resolved_count or s.manifest_digest is distinct from s.resolved_digest then 'Identificativi mancanti o discordanti rispetto all’elenco della fonte.'
   when s.reported_count is not null and s.reported_count<>s.manifest_count then 'Quantità dichiarata ed elenco della fonte discordanti.'
   else 'Elenco delle carte confrontato con questa fonte; tutte le varianti non sono certificate.' end reason,
  case s.provider when 'tcgdex' then 'https://api.tcgdex.net/v2/'||s.source_language||'/sets/'||s.set_id else 'https://github.com/type-null/PTCG-database' end source_url,
  'unverified'::text variants_status
 from public.catalog_sync_sets s left join public.catalog_language_sources l using(source_language) where s.set_id<>'__index__'
), language_totals as (
 select source_language,count(*) n,count(*) filter(where status='to_import') pending,count(*) filter(where status='to_review') review
 from sets where provider='tcgdex' and coverage_scope<>'digital' group by source_language
)
select * from sets
union all
select 'language:'||l.source_language,'language','tcgdex',l.source_language,l.label,l.region,null,l.label,'physical',l.listed_sets,coalesce(t.n,0)::integer,l.last_probe_at,null,
 case when l.probe_status in ('unprobed','empty','error') then 'not_covered' when coalesce(t.n,0)=0 or t.pending>0 then 'to_import' else 'to_review' end,
 case when l.probe_status='error' then coalesce(l.last_error,'Fonte non disponibile al controllo.')
 when l.probe_status in ('unprobed','empty') then 'Nessun elenco utilizzabile verificato.'
 when coalesce(t.n,0)=0 then 'Elenco disponibile: espansioni da scoprire nel prossimo worker aggiornato.'
 else 'Percorso linguistico registrato; conteggi in espansioni. La copertura mondiale e le varianti restano da confrontare.' end,l.source_url,'unverified'
from public.catalog_language_sources l left join language_totals t using(source_language)
union all
select 'release:'||r.code,'release','curated','und','Lingue da verificare','Distribuzione promozionale',r.code,r.name,'physical',null,null,null,null,'to_review',
 'Distribuzione registrata: elenco, lingue e varianti da confrontare con fonti indipendenti.',r.source_url,'unverified'
from public.catalog_releases r;
revoke all on public.catalog_coverage_register from public,anon,authenticated;
grant select on public.catalog_coverage_register to anon,authenticated,service_role;
create function public.catalog_coverage_report(wanted_status text default null,wanted_language text default null,wanted_provider text default null,query_text text default '',page_offset integer default 0,page_size integer default 25) returns jsonb
language sql stable security invoker set search_path='' as $$
 with registry as materialized(select * from public.catalog_coverage_register),filtered as materialized(
 select * from registry where (wanted_status is null or status=wanted_status) and (wanted_language is null or source_language=wanted_language)
 and (wanted_provider is null or provider=wanted_provider) and (coalesce(query_text,'')='' or name ilike '%'||query_text||'%' or coalesce(release_code,'') ilike '%'||query_text||'%')
 ) select jsonb_build_object('generated_at',now(),'scope','Carte fisiche; allineamento agli elenchi delle fonti, non certificazione di tutte le varianti.',
 'stats',coalesce((select jsonb_object_agg(status,n) from(select status,count(*) n from registry group by status)x),'{}'::jsonb),
 'total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from filtered order by target_type,source_language,name,target_key limit least(greatest(page_size,1),100) offset greatest(page_offset,0))x),'[]'::jsonb),
 'languages',(select jsonb_agg(to_jsonb(l) order by label) from public.catalog_language_sources l))
$$;
revoke all on function public.catalog_coverage_report(text,text,text,text,integer,integer) from public;
grant execute on function public.catalog_coverage_report(text,text,text,text,integer,integer) to anon,authenticated,service_role;
