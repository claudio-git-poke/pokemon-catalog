-- Merges cards documented twice by different sources (same set, language,
-- number and name). Run with psql -v apply=true|false: false rolls back.
-- Only copies created by the evidence sources (Limitless, official Asian
-- sites, PkmnCards, Bulbapedia, Pokumon) with an unidentified variant and no
-- manual edits are removed; main-catalogue cards are never removed. The kept
-- card receives the copy's sources (search entries, inventory, packaging
-- links) and its photo when it had none. Groups where one provider appears
-- twice may be distinct printings and are left untouched.
\set ON_ERROR_STOP on
begin;
create temp table m_cards on commit drop as
 select id,sigla,lingua,numero,lower(btrim(nome)) nome,variante,split_part(coalesce(source_uid,''),':',1) prov,
  image_url,image_status,image_source,coalesce(manual_overrides::text,'{}') in ('{}','null') no_manual
 from public.cards where numero>0;
create index on m_cards(sigla,lingua,numero,nome);
create temp table m_groups on commit drop as
 select sigla,lingua,numero,nome from m_cards group by 1,2,3,4
 having count(distinct prov)>1 and count(*)=count(distinct prov);
create temp table m_cand on commit drop as
 select c.* from m_cards c join m_groups using(sigla,lingua,numero,nome)
 where c.prov in ('limitless','asia-official','pkmncards','bulbapedia','pokumon') and c.variante='da-identificare' and c.no_manual;
create temp table m_keep on commit drop as
 select sigla,lingua,numero,nome,coalesce(min(c.id) filter (where c.id not in (select id from m_cand)),min(c.id)) keep
 from m_groups join m_cards c using(sigla,lingua,numero,nome) group by 1,2,3,4;
create temp table m_map on commit drop as
 select c.id dup,k.keep,c.image_url,c.image_status,c.image_source from m_cand c join m_keep k using(sigla,lingua,numero,nome) where c.id<>k.keep;
create unique index on m_map(dup);

select (select count(*) from public.cards) carte_prima,(select count(*) from m_groups) gruppi,(select count(*) from m_map) copie_da_unire;
select m.prov,count(*) copie from m_map join m_cards m on m.id=m_map.dup group by 1 order by 2 desc;

-- Any other table pointing at a copy must be handled explicitly.
do $$
declare r record; n bigint;
begin
 for r in select c.conrelid::regclass tbl,a.attname col from pg_constraint c
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and c.confrelid='public.cards'::regclass
 loop
  if r.tbl::text in ('catalog_search_entries','public.catalog_search_entries','catalog_printing_inventory','public.catalog_printing_inventory','catalog_packaging_links','public.catalog_packaging_links') then continue; end if;
  execute format('select count(*) from %s where %I in (select dup from m_map)',r.tbl,r.col) into n;
  if n>0 then raise exception 'Tabella non prevista % (%) punta a % copie: unione annullata',r.tbl,r.col,n; end if;
 end loop;
end $$;

-- Photo from the copy when the kept card has none.
with best as (select distinct on (keep) keep,image_url,image_source from m_map where image_status='found' and image_url is not null order by keep,dup)
update public.cards k set image_url=b.image_url,image_status='found',image_source=b.image_source,image_last_error=null
 from best b where k.id=b.keep and k.image_status is distinct from 'found';
select count(*) foto_aggiunte from public.cards k join m_map m on m.keep=k.id where k.image_url=m.image_url and m.image_status='found';

update public.catalog_search_entries e set card_id=m.keep from m_map m where e.card_id=m.dup and e.entry_key<>'card:'||m.dup;
update public.catalog_printing_inventory i set card_id=m.keep from m_map m where i.card_id=m.dup;
delete from public.catalog_packaging_links l using m_map m where l.card_id=m.dup
 and exists(select 1 from public.catalog_packaging_links x where x.card_id=m.keep and x.candidate_key=l.candidate_key);
update public.catalog_packaging_links l set card_id=m.keep from m_map m where l.card_id=m.dup;

delete from public.cards where id in (select dup from m_map);

-- Checks: nothing points to removed cards, kept cards still exist, no group left.
do $$
declare n bigint;
begin
 select count(*) into n from public.catalog_search_entries e where e.card_id in (select dup from m_map); if n>0 then raise exception 'Righe di ricerca ancora sulle copie: %',n; end if;
 select count(*) into n from m_map where keep not in (select id from public.cards); if n>0 then raise exception 'Carte tenute mancanti: %',n; end if;
 select count(*) into n from public.cards where id in (select dup from m_map); if n>0 then raise exception 'Copie non eliminate: %',n; end if;
 select count(*) into n from public.catalog_search_entries e left join public.cards c on c.id=e.card_id where e.card_id is not null and c.id is null; if n>0 then raise exception 'Righe di ricerca orfane: %',n; end if;
end $$;
select (select count(*) from public.cards) carte_dopo,(select count(*) from public.cards where image_status='found') carte_con_foto;

\if :apply
commit;
\echo 'Unione APPLICATA'
\else
rollback;
\echo 'Prova a vuoto: nessuna modifica salvata'
\endif
