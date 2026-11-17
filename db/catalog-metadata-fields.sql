-- Additive metadata import, with durable per-language progress.
create or replace function public.catalog_rarity_tags(value text,source_language text default 'en') returns text[]
language sql immutable security invoker set search_path='' as $fn$
 with normalized as(select public.catalog_normalize(normalize(value,NFC)) label), aliases as(select $aliases${"en":{"common":"rarity:common","uncommon":"rarity:uncommon","rare":"rarity:rare","double rare":"rarity:double-rare","ultra rare":"rarity:ultra-rare","illustration rare":"rarity:illustration-rare","special illustration rare":"rarity:special-illustration-rare","hyper rare":"rarity:hyper-rare","mega hyper rare":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rare":"rarity:shiny-rare","shiny ultra rare":"rarity:shiny-ultra-rare","ace spec rare":["rarity:ace-spec-rare","rarity:ace"],"amazing rare":"rarity:amazing-rare","classic collection":"rarity:classic-collection","full art trainer":"rarity:full-art-trainer","holo rare":"rarity:holo-rare","holo rare v":"rarity:holo-rare-v","holo rare vmax":"rarity:holo-rare-vmax","holo rare vstar":"rarity:holo-rare-vstar","legend":"rarity:legend","none":"rarity:none","radiant rare":"rarity:radiant-rare","rare holo":"rarity:rare-holo","rare holo lv x":"rarity:rare-holo-lv-x","rare prime":"rarity:rare-prime","secret rare":"rarity:secret-rare","shiny rare v":"rarity:shiny-rare-v","shiny rare vmax":"rarity:shiny-rare-vmax","one star":"rarity:one-star","two star":"rarity:two-star","three star":"rarity:three-star","crown":"rarity:crown","one diamond":"rarity:one-diamond","two diamond":"rarity:two-diamond","three diamond":"rarity:three-diamond","four diamond":"rarity:four-diamond","one shiny":"rarity:one-shiny","two shiny":"rarity:two-shiny","three shiny":"rarity:three-shiny","black white rare":["rarity:black-white-rare","rarity:bwr"]},"it":{"comune":"rarity:common","non comune":"rarity:uncommon","rara":"rarity:rare","rara doppia":"rarity:double-rare","ultrarara":"rarity:ultra-rare","rara illustrazione":"rarity:illustration-rare","rara illustrazione speciale":"rarity:special-illustration-rare","rara iper":"rarity:hyper-rare","mega iper raro":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rare":"rarity:shiny-rare","ultrarara cromatica":"rarity:shiny-ultra-rare","rara asso tattico":["rarity:ace-spec-rare","rarity:ace"],"policrome":"rarity:amazing-rare","collezione classica":"rarity:classic-collection","allenatore d arte completa":"rarity:full-art-trainer","olografica rara":"rarity:holo-rare","olografica rara v":"rarity:holo-rare-v","olografica rara vmax":"rarity:holo-rare-vmax","olografica rara vstar":"rarity:holo-rare-vstar","leggenda":"rarity:legend","nessuna":"rarity:none","rara lucente":"rarity:radiant-rare","rara olografica":"rarity:rare-holo","rara olografica lv x":"rarity:rare-holo-lv-x","super rara":"rarity:rare-prime","segreto rara":"rarity:secret-rare","shiny rare v":"rarity:shiny-rare-v","shiny rare vmax":"rarity:shiny-rare-vmax","une etoile":"rarity:one-star","deux etoiles":"rarity:two-star","trois etoiles":"rarity:three-star","couronne":"rarity:crown","une diamant":"rarity:one-diamond","deux diamant":"rarity:two-diamond","trois diamant":"rarity:three-diamond","quatre diamant":"rarity:four-diamond","un chromatique":"rarity:one-shiny","deux chromatique":"rarity:two-shiny","rara bianco e nero":["rarity:black-white-rare","rarity:bwr"]},"fr":{"commune":"rarity:common","peu commune":"rarity:uncommon","rare":"rarity:rare","double rare":"rarity:double-rare","ultra rare":"rarity:ultra-rare","illustration rare":"rarity:illustration-rare","illustration speciale rare":"rarity:special-illustration-rare","hyper rare":"rarity:hyper-rare","mega hyper rare":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rare":"rarity:shiny-rare","chromatique ultra rare":"rarity:shiny-ultra-rare","high tech rare":["rarity:ace-spec-rare","rarity:ace"],"magnifique":"rarity:amazing-rare","collection classique":"rarity:classic-collection","dresseur full art":"rarity:full-art-trainer","holo rare":"rarity:holo-rare","holo rare v":"rarity:holo-rare-v","holo rare vmax":"rarity:holo-rare-vmax","holo rare vstar":"rarity:holo-rare-vstar","legende":"rarity:legend","sans rarete":"rarity:none","radieux rare":"rarity:radiant-rare","rare holo":"rarity:rare-holo","rare holo lv x":"rarity:rare-holo-lv-x","rare prime":"rarity:rare-prime","magnifique rare":"rarity:secret-rare","shiny rare v":"rarity:shiny-rare-v","shiny rare vmax":"rarity:shiny-rare-vmax","une etoile":"rarity:one-star","deux etoiles":"rarity:two-star","trois etoiles":"rarity:three-star","couronne":"rarity:crown","un diamant":"rarity:one-diamond","deux diamants":"rarity:two-diamond","trois diamants":"rarity:three-diamond","quatre diamants":"rarity:four-diamond","un chromatique":"rarity:one-shiny","deux chromatiques":"rarity:two-shiny","trois chromatiques":"rarity:three-shiny","rare noir blanc":["rarity:black-white-rare","rarity:bwr"]},"de":{"haufig":"rarity:common","ungewohnlich":"rarity:uncommon","selten":"rarity:rare","doppelselten":"rarity:double-rare","ultra selten":"rarity:ultra-rare","selten illustration":"rarity:illustration-rare","selten besondere illustration":"rarity:special-illustration-rare","hyperselten":"rarity:hyper-rare","mega hyper selten":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rare":"rarity:shiny-rare","ultraselten schillernd":"rarity:shiny-ultra-rare","ass klasse":["rarity:ace-spec-rare","rarity:ace"],"atemberaubend":"rarity:amazing-rare","klassische kollektion":"rarity:classic-collection","vollkunsttrainer":"rarity:full-art-trainer","holografisch selten":"rarity:holo-rare","holografisch selten v":"rarity:holo-rare-v","holografisch selten vmax":"rarity:holo-rare-vmax","holografisch selten vstar":"rarity:holo-rare-vstar","legende":"rarity:legend","keine":"rarity:none","selten strahlend":"rarity:radiant-rare","selten holografisch":"rarity:rare-holo","selten holografisch lv x":"rarity:rare-holo-lv-x","selten primus":"rarity:rare-prime","versteckt selten":"rarity:secret-rare","shiny rare v":"rarity:shiny-rare-v","shiny rare vmax":"rarity:shiny-rare-vmax","une etoile":"rarity:one-star","deux etoiles":"rarity:two-star","trois etoiles":"rarity:three-star","couronne":"rarity:crown","une diamant":"rarity:one-diamond","deux diamant":"rarity:two-diamond","trois diamant":"rarity:three-diamond","quatre diamant":"rarity:four-diamond","un chromatique":"rarity:one-shiny","deux chromatique":"rarity:two-shiny","schwarz weiß selten":["rarity:black-white-rare","rarity:bwr"]},"es":{"comun":"rarity:common","uncommon":"rarity:uncommon","rara":"rarity:rare","rara doble":"rarity:double-rare","ultra rara":"rarity:ultra-rare","rara ilustracion":"rarity:illustration-rare","rara ilustracion especial":"rarity:special-illustration-rare","rara hiper":"rarity:hyper-rare","mega hiper rara":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rare":"rarity:shiny-rare","rara ultra variocolor":"rarity:shiny-ultra-rare","rara as tactico":["rarity:ace-spec-rare","rarity:ace"],"increibles":"rarity:amazing-rare","coleccion clasica":"rarity:classic-collection","entrenador de arte completo":"rarity:full-art-trainer","holo rara":"rarity:holo-rare","holo rara v":"rarity:holo-rare-v","holo rara vmax":"rarity:holo-rare-vmax","holo rara vstar":"rarity:holo-rare-vstar","leyenda":"rarity:legend","ninguno":"rarity:none","rara radiante":"rarity:radiant-rare","rara holo":"rarity:rare-holo","rara holo lv x":"rarity:rare-holo-lv-x","rara primigenia":"rarity:rare-prime","rara secreta":"rarity:secret-rare","shiny rare v":"rarity:shiny-rare-v","shiny rare vmax":"rarity:shiny-rare-vmax","una estrella":"rarity:one-star","dos estrellas":"rarity:two-star","tres estrellas":"rarity:three-star","corona":"rarity:crown","un diamante":"rarity:one-diamond","dos diamantes":"rarity:two-diamond","tres diamantes":"rarity:three-diamond","cuatro diamantes":"rarity:four-diamond","one shiny":"rarity:one-shiny","two shiny":"rarity:two-shiny","three shiny":"rarity:three-shiny","rara blanca y negra":["rarity:black-white-rare","rarity:bwr"]},"pt":{"comum":"rarity:common","incomum":"rarity:uncommon","rara":"rarity:rare","rara dupla":"rarity:double-rare","ultra rara":"rarity:ultra-rare","ilustracao rara":"rarity:illustration-rare","ilustracao rara especial":"rarity:special-illustration-rare","hiper rara":"rarity:hyper-rare","mega hiper raro":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rara":"rarity:shiny-rare","brilhante ultra rara":"rarity:shiny-ultra-rare","ace spec raro":["rarity:ace-spec-rare","rarity:ace"],"raras incriveis":"rarity:amazing-rare","colecao clasica":"rarity:classic-collection","arte completa de treinador":"rarity:full-art-trainer","rara holo":"rarity:holo-rare","rara holo v":"rarity:holo-rare-v","rara holo vmax":"rarity:holo-rare-vmax","rara holo vstar":"rarity:holo-rare-vstar","legend":"rarity:legend","none":"rarity:none","rara radiante":"rarity:radiant-rare","rara holo lv x":"rarity:rare-holo-lv-x","rara prime":"rarity:rare-prime","rare secreta":"rarity:secret-rare","shiny rara v":"rarity:shiny-rare-v","shiny rara vmax":"rarity:shiny-rare-vmax","une etoile":"rarity:one-star","deux etoiles":"rarity:two-star","trois etoiles":"rarity:three-star","couronne":"rarity:crown","un diamant":"rarity:one-diamond","deux diamants":"rarity:two-diamond","trois diamants":"rarity:three-diamond","quatre diamants":"rarity:four-diamond","un chromatique":"rarity:one-shiny","deux chromatique":"rarity:two-shiny","rara preto e branco":["rarity:black-white-rare","rarity:bwr"]},"ja":{"rare c c":["rarity:c","rarity:common"],"c":["rarity:c","rarity:common"],"rare c":["rarity:c","rarity:common"],"rare u c":["rarity:u","rarity:uncommon"],"u":["rarity:u","rarity:uncommon"],"rare u":["rarity:u","rarity:uncommon"],"rare r c":["rarity:r","rarity:rare"],"r":["rarity:r","rarity:rare"],"rare r":["rarity:r","rarity:rare"],"rare rr":["rarity:rr","rarity:double-rare"],"rr":["rarity:rr","rarity:double-rare"],"rare sr c":["rarity:sr","rarity:ultra-rare"],"sr":["rarity:sr","rarity:ultra-rare"],"rare ar":["rarity:ar","rarity:illustration-rare"],"ar":["rarity:ar","rarity:illustration-rare"],"rare sar":["rarity:sar","rarity:special-illustration-rare"],"sar":["rarity:sar","rarity:special-illustration-rare"],"rare ur c":["rarity:ur","rarity:hyper-rare"],"ur":["rarity:ur","rarity:hyper-rare"],"rare s":["rarity:s","rarity:shiny-rare"],"s":["rarity:s","rarity:shiny-rare"],"rare s 2":["rarity:s","rarity:shiny-rare"],"rare ssr":["rarity:ssr","rarity:shiny-ultra-rare"],"ssr":["rarity:ssr","rarity:shiny-ultra-rare"],"rare ma":["rarity:ma","rarity:mega-attack-rare"],"ma":["rarity:ma","rarity:mega-attack-rare"],"rare mur":["rarity:mur","rarity:mega-hyper-rare"],"mur":["rarity:mur","rarity:mega-hyper-rare"],"rare hr":["rarity:hr"],"hr":["rarity:hr"],"rare chr":["rarity:chr"],"chr":["rarity:chr"],"rare csr":["rarity:csr"],"csr":["rarity:csr"],"rare tr":["rarity:tr"],"tr":["rarity:tr"],"rare ss":["rarity:ss"],"ss":["rarity:ss"]},"ko":{"c":["rarity:c","rarity:common"],"u":["rarity:u","rarity:uncommon"],"r":["rarity:r","rarity:rare"],"rr":["rarity:rr","rarity:double-rare"],"sr":["rarity:sr","rarity:ultra-rare"],"ar":["rarity:ar","rarity:illustration-rare"],"sar":["rarity:sar","rarity:special-illustration-rare"],"ur":["rarity:ur","rarity:hyper-rare"],"s":["rarity:s","rarity:shiny-rare"],"ssr":["rarity:ssr","rarity:shiny-ultra-rare"],"ma":["rarity:ma","rarity:mega-attack-rare"],"mur":["rarity:mur","rarity:mega-hyper-rare"]}}$aliases$::jsonb translations), resolved as(
  select label,coalesce(translations->coalesce(source_language,'en')->label,translations->'en'->label) codes from normalized,aliases
 ), expanded as(
  select 'rarity:'||replace(label,' ','-') tag from resolved where label<>''
  union all select codes#>>'{}' from resolved where jsonb_typeof(codes)='string'
  union all select x from resolved,lateral jsonb_array_elements_text(case when jsonb_typeof(codes)='array' then codes else '[]'::jsonb end) x
 )select coalesce(array_agg(distinct tag order by tag) filter(where tag is not null),'{}') from expanded
$fn$;
revoke all on function public.catalog_rarity_tags(text,text) from public;
grant execute on function public.catalog_rarity_tags(text,text) to anon,authenticated,service_role;

-- Reindexing a parent must retain previously verified card-level rarity metadata.

create table if not exists public.catalog_metadata_backfill_state(
 source_language text primary key,next_page integer not null default 1 check(next_page>0),
 mapping_version text not null default '',after_card_id bigint not null default 0,completed_at timestamptz,updated_at timestamptz not null default now()
);
alter table public.catalog_metadata_backfill_state enable row level security;
revoke all on public.catalog_metadata_backfill_state from public,anon,authenticated;
grant select on public.catalog_metadata_backfill_state to anon,authenticated;
grant all on public.catalog_metadata_backfill_state to service_role;
drop policy if exists metadata_state_read on public.catalog_metadata_backfill_state;
create policy metadata_state_read on public.catalog_metadata_backfill_state for select to anon,authenticated using(true);
drop policy if exists metadata_state_worker on public.catalog_metadata_backfill_state;
create policy metadata_state_worker on public.catalog_metadata_backfill_state for all to service_role using(true) with check(true);
create or replace function public.catalog_card_metadata_languages() returns table(source_language text,card_count bigint)
language sql stable security invoker set search_path='' as $$
 select c.source_language,count(*) from public.cards c where c.source_uid collate "C" like 'tcgdex:%' and c.source_language is not null group by c.source_language
$$;
revoke all on function public.catalog_card_metadata_languages() from public,anon,authenticated;
grant execute on function public.catalog_card_metadata_languages() to service_role;

create or replace function public.catalog_apply_card_metadata(items jsonb) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='20s' as $$
declare answer jsonb;
begin
 if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items)>250 then raise exception 'Lotto di metadati non valido';end if;
 with supplied as materialized(
  select * from jsonb_to_recordset(items) x(source_uid text,source_card_id text,source_language text,metadata jsonb,tags text[],evidence jsonb)
 ), facts as materialized(
  select distinct on(c.id)c.id card_id,x.source_card_id,x.source_language,x.evidence,
   jsonb_build_object('id',x.source_card_id,'source_language',x.source_language)||
    (select coalesce(jsonb_object_agg(k,v),'{}') from jsonb_each(x.metadata) p(k,v)
     where k=any(array['localId','source_name','rarity','types','regulationMark','stage','hp','illustrator','suffix','trainerType','energyType','set'])) patch,
   array(select distinct t from unnest(x.tags)t where split_part(t,':',1)=any(array['rarity','type','regulation','hp','stage','illustrator','category']) and length(t)<=512 order by t) derived_tags
  from supplied x join public.cards c on c.source_uid=x.source_uid and c.source_card_id=x.source_card_id and c.source_language=x.source_language
  where x.source_uid='tcgdex:'||x.source_language||':'||x.source_card_id
   and x.metadata->>'id'=x.source_card_id and x.metadata->>'source_language'=x.source_language
   and x.evidence->>'method'='tcgdex-graphql' and x.evidence->>'endpoint'='https://api.tcgdex.net/v2/graphql' and x.evidence->>'language'=x.source_language
   and not exists(select 1 from supplied other where other.source_uid=x.source_uid and other.metadata is distinct from x.metadata)
  order by c.id
 ), eligible as materialized(
  select e.entry_key,f.* from facts f join public.catalog_search_entries e on e.card_id=f.card_id
  where not(e.manual_overrides ? 'source_payload') and not coalesce((e.source_payload->>'identity_review_required')::boolean,false)
   and((e.entry_key='card:'||f.card_id and e.verification='catalog') or(e.source_payload->>'id'=f.source_card_id and e.source_payload->>'source_language'=f.source_language))
 ), wanted as materialized(
  select q.* from eligible q join public.catalog_search_entries e using(entry_key)
  where not(e.source_payload @> q.patch) or e.source_payload->'metadata_tags' is distinct from to_jsonb(q.derived_tags)
   or e.source_payload->'metadata_evidence' is distinct from q.evidence
   or not(e.manual_overrides ? 'tags') and not(e.tags @> q.derived_tags)
 ), locked as materialized(
  select w.* from wanted w join public.catalog_search_entries e using(entry_key) order by e.entry_key for update of e skip locked
 ), updated as(
  update public.catalog_search_entries e set
   tags=case when e.manual_overrides ? 'tags' then e.tags else
    array(select distinct t from unnest(array(select t from unnest(e.tags)t where not t=any(array(select jsonb_array_elements_text(case when jsonb_typeof(e.source_payload->'metadata_tags')='array' then e.source_payload->'metadata_tags' else '[]'::jsonb end))))||l.derived_tags)t order by t) end,
   source_payload=e.source_payload||l.patch||jsonb_build_object('set',
    (case when jsonb_typeof(e.source_payload->'set')='object' then e.source_payload->'set' else '{}'::jsonb end)||
    (case when jsonb_typeof(l.patch->'set')='object' then l.patch->'set' else '{}'::jsonb end),
    'metadata_tags',l.derived_tags,'metadata_evidence',l.evidence)||
    case when e.verification='catalog' then jsonb_build_object('metadata_scope','card-metadata-only','reference_image_only',true) else '{}'::jsonb end,
   source_url=coalesce(e.source_url,'https://api.tcgdex.net/v2/'||l.source_language||'/cards/'||l.source_card_id),
   search_text=public.catalog_normalize(normalize(concat_ws(' ',e.name,e.set_code,e.collector_number,e.label,array_to_string(e.tags||l.derived_tags,' ')),NFC)),updated_at=clock_timestamp()
  from locked l where e.entry_key=l.entry_key returning e.entry_key
 ), terms as(
  insert into public.catalog_terms(code,label,kind,aliases,parents)
  select distinct t,replace(split_part(t,':',2),'-',' '),split_part(t,':',1),'{}'::text[],'{}'::text[]
  from facts,lateral unnest(derived_tags)t on conflict(code) do nothing returning code
 )select jsonb_build_object('matched',(select count(*) from facts),'updated',(select count(*) from updated),
  'deferred',(select count(*) from wanted)-(select count(*) from locked)) into answer;
 return answer;
end $$;
revoke all on function public.catalog_apply_card_metadata(jsonb) from public,anon,authenticated;
grant execute on function public.catalog_apply_card_metadata(jsonb) to service_role;

create or replace function public.catalog_index_card() returns trigger language plpgsql security invoker set search_path='' as $fn$
declare n text; base_tags text[]='{}';
begin
 n:=case when lower(split_part(new.sigla,'@',1))='mfb' then null when nullif(new.source_local_id,'') is not null then public.catalog_number(new.source_local_id)
   when lower(split_part(new.sigla,'@',1))<>'mfb' and new.numero>0 then new.numero::text else null end;
 if lower(split_part(new.sigla,'@',1))='mfb' then base_tags:=array['family:my-first-battle'];end if;
 insert into public.catalog_search_entries(entry_key,card_id,collector_number,name,set_code,language,tags,facts,search_text)
 values('card:'||new.id,new.id,n,coalesce(new.nome,''),coalesce(new.sigla,''),coalesce(new.lingua,''),base_tags,public.catalog_base_facts(new),public.catalog_normalize(concat_ws(' ',new.nome,new.sigla,new.codice)))
 on conflict(entry_key) do update set collector_number=excluded.collector_number,name=excluded.name,set_code=excluded.set_code,language=excluded.language,
 tags=array(select distinct t from unnest(excluded.tags||public.catalog_rarity_tags(catalog_search_entries.source_payload->>'rarity',catalog_search_entries.source_payload->>'source_language')||array(select distinct t from unnest(catalog_search_entries.tags)t where split_part(t,':',1)=any(array['rarity','type','regulation','stage','hp','illustrator','category'])))t order by t),
 facts=excluded.facts,search_text=trim(excluded.search_text||' '||array_to_string(array(select distinct t from unnest(catalog_search_entries.tags)t where split_part(t,':',1)=any(array['rarity','type','regulation','stage','hp','illustrator','category'])),' ')),updated_at=now();
 return new;
end $fn$;


create or replace function catalog_internal.index_authorized_card() returns trigger
language plpgsql security definer set search_path='' as $$
declare n text; base_tags text[]:='{}';
 caller_role text:=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',nullif(current_setting('role',true),'none'),session_user::text);
begin
 if tg_table_schema<>'public' or tg_table_name<>'cards' or tg_op<>all(array['INSERT','UPDATE']) or pg_trigger_depth()<1 then raise exception 'Indicizzazione consentita solo dai trigger delle carte';end if;
 if caller_role='authenticated' and auth.uid() is null then raise exception 'Identità autenticata mancante';end if;
 n:=case when lower(split_part(new.sigla,'@',1))='mfb' then null when nullif(new.source_local_id,'') is not null then public.catalog_number(new.source_local_id)
   when new.numero>0 then new.numero::text else null end;
 if lower(split_part(new.sigla,'@',1))='mfb' then base_tags:=array['family:my-first-battle'];end if;
 insert into public.catalog_search_entries(entry_key,card_id,collector_number,name,set_code,language,tags,facts,search_text)
 values('card:'||new.id,new.id,n,coalesce(new.nome,''),coalesce(new.sigla,''),coalesce(new.lingua,''),base_tags,public.catalog_base_facts(new),public.catalog_normalize(concat_ws(' ',new.nome,new.sigla,new.codice)))
 on conflict(entry_key) do update set collector_number=excluded.collector_number,name=excluded.name,set_code=excluded.set_code,language=excluded.language,tags=excluded.tags||array(select distinct t from unnest(catalog_search_entries.tags)t where split_part(t,':',1)=any(array['rarity','type','regulation','stage','hp','illustrator','category'])),facts=excluded.facts,search_text=trim(excluded.search_text||' '||array_to_string(array(select distinct t from unnest(catalog_search_entries.tags)t where split_part(t,':',1)=any(array['rarity','type','regulation','stage','hp','illustrator','category'])),' ')),updated_at=clock_timestamp();
 if tg_op='UPDATE' then
  if (old.manual_overrides->'sigla',old.manual_overrides->'nome',old.manual_overrides->'lingua') is distinct from
     (new.manual_overrides->'sigla',new.manual_overrides->'nome',new.manual_overrides->'lingua') then
   update public.catalog_search_entries set updated_at=clock_timestamp() where card_id=new.id and entry_key<>'card:'||new.id;
  end if;
 end if;
 return new;
end $$;

-- An older worker may still be running during a rollout. It cannot erase fields
-- it did not know how to publish; new snapshots explicitly include metadata_tags.
create or replace function public.catalog_preserve_metadata_for_legacy_writer() returns trigger
language plpgsql security invoker set search_path='' as $$
declare carried jsonb;codes text[];
begin
 if public.catalog_write_is_manual() or not(old.source_payload ? 'metadata_tags') or new.source_payload ? 'metadata_tags'
  or old.card_id is distinct from new.card_id or old.source_payload->>'id' is distinct from new.source_payload->>'id'
  or old.source_payload->>'source_language' is distinct from new.source_payload->>'source_language' then return new;end if;
 select coalesce(jsonb_object_agg(k,v),'{}') into carried from jsonb_each(old.source_payload)p(k,v)
 where k=any(array['types','regulationMark','stage','hp','illustrator','suffix','trainerType','energyType','metadata_tags','metadata_evidence']);
 new.source_payload:=new.source_payload||carried;
 select coalesce(array_agg(t),'{}') into codes from jsonb_array_elements_text(case when jsonb_typeof(old.source_payload->'metadata_tags')='array' then old.source_payload->'metadata_tags' else '[]'::jsonb end)t
 where split_part(t,':',1)=any(array['rarity','type','regulation','hp','stage','illustrator','category']);
 new.tags:=array(select distinct t from unnest(new.tags||codes)t order by t);
 new.search_text:=public.catalog_normalize(normalize(concat_ws(' ',new.search_text,array_to_string(codes,' ')),NFC));
 return new;
end $$;
revoke all on function public.catalog_preserve_metadata_for_legacy_writer() from public,anon,authenticated;
grant execute on function public.catalog_preserve_metadata_for_legacy_writer() to service_role;
do $$begin
 if not exists(select 1 from pg_trigger where tgrelid='public.catalog_search_entries'::regclass and tgname='aab_catalog_preserve_metadata') then
  create trigger aab_catalog_preserve_metadata before update on public.catalog_search_entries for each row execute function public.catalog_preserve_metadata_for_legacy_writer();
 end if;
end $$;
