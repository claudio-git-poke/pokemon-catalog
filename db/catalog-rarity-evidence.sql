-- Additive, repeatable metadata repair. No identity, photo or manual-link changes.
create or replace function public.catalog_rarity_tags(value text,source_language text default 'en') returns text[]
language sql immutable security invoker set search_path='' as $fn$
 with normalized as(select public.catalog_normalize(normalize(value,NFC)) label), aliases as(select $aliases${"en":{"common":"rarity:common","uncommon":"rarity:uncommon","rare":"rarity:rare","double rare":"rarity:double-rare","ultra rare":"rarity:ultra-rare","illustration rare":"rarity:illustration-rare","special illustration rare":"rarity:special-illustration-rare","hyper rare":"rarity:hyper-rare","mega hyper rare":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rare":"rarity:shiny-rare","shiny ultra rare":"rarity:shiny-ultra-rare"},"it":{"comune":"rarity:common","non comune":"rarity:uncommon","rara":"rarity:rare","rara doppia":"rarity:double-rare","ultrarara":"rarity:ultra-rare","rara illustrazione":"rarity:illustration-rare","rara illustrazione speciale":"rarity:special-illustration-rare","rara iper":"rarity:hyper-rare","mega iper raro":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rare":"rarity:shiny-rare","ultrarara cromatica":"rarity:shiny-ultra-rare"},"fr":{"commune":"rarity:common","peu commune":"rarity:uncommon","rare":"rarity:rare","double rare":"rarity:double-rare","ultra rare":"rarity:ultra-rare","illustration rare":"rarity:illustration-rare","illustration speciale rare":"rarity:special-illustration-rare","hyper rare":"rarity:hyper-rare","mega hyper rare":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rare":"rarity:shiny-rare","chromatique ultra rare":"rarity:shiny-ultra-rare"},"de":{"haufig":"rarity:common","ungewohnlich":"rarity:uncommon","selten":"rarity:rare","doppelselten":"rarity:double-rare","ultra selten":"rarity:ultra-rare","selten illustration":"rarity:illustration-rare","selten besondere illustration":"rarity:special-illustration-rare","hyperselten":"rarity:hyper-rare","mega hyper selten":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rare":"rarity:shiny-rare","ultraselten schillernd":"rarity:shiny-ultra-rare"},"es":{"comun":"rarity:common","uncommon":"rarity:uncommon","rara":"rarity:rare","rara doble":"rarity:double-rare","ultra rara":"rarity:ultra-rare","rara ilustracion":"rarity:illustration-rare","rara ilustracion especial":"rarity:special-illustration-rare","rara hiper":"rarity:hyper-rare","mega hiper rara":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rare":"rarity:shiny-rare","rara ultra variocolor":"rarity:shiny-ultra-rare"},"pt":{"comum":"rarity:common","incomum":"rarity:uncommon","rara":"rarity:rare","rara dupla":"rarity:double-rare","ultra rara":"rarity:ultra-rare","ilustracao rara":"rarity:illustration-rare","ilustracao rara especial":"rarity:special-illustration-rare","hiper rara":"rarity:hyper-rare","mega hiper raro":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rara":"rarity:shiny-rare","brilhante ultra rara":"rarity:shiny-ultra-rare"},"ja":{"rare c c":["rarity:c","rarity:common"],"c":["rarity:c","rarity:common"],"rare c":["rarity:c","rarity:common"],"rare u c":["rarity:u","rarity:uncommon"],"u":["rarity:u","rarity:uncommon"],"rare u":["rarity:u","rarity:uncommon"],"rare r c":["rarity:r","rarity:rare"],"r":["rarity:r","rarity:rare"],"rare r":["rarity:r","rarity:rare"],"rare rr":["rarity:rr","rarity:double-rare"],"rr":["rarity:rr","rarity:double-rare"],"rare sr c":["rarity:sr","rarity:ultra-rare"],"sr":["rarity:sr","rarity:ultra-rare"],"rare ar":["rarity:ar","rarity:illustration-rare"],"ar":["rarity:ar","rarity:illustration-rare"],"rare sar":["rarity:sar","rarity:special-illustration-rare"],"sar":["rarity:sar","rarity:special-illustration-rare"],"rare ur c":["rarity:ur","rarity:hyper-rare"],"ur":["rarity:ur","rarity:hyper-rare"],"rare s":["rarity:s","rarity:shiny-rare"],"s":["rarity:s","rarity:shiny-rare"],"rare s 2":["rarity:s","rarity:shiny-rare"],"rare ssr":["rarity:ssr","rarity:shiny-ultra-rare"],"ssr":["rarity:ssr","rarity:shiny-ultra-rare"],"rare ma":["rarity:ma","rarity:mega-attack-rare"],"ma":["rarity:ma","rarity:mega-attack-rare"],"rare mur":["rarity:mur","rarity:mega-hyper-rare"],"mur":["rarity:mur","rarity:mega-hyper-rare"],"rare hr":["rarity:hr"],"hr":["rarity:hr"],"rare chr":["rarity:chr"],"chr":["rarity:chr"],"rare csr":["rarity:csr"],"csr":["rarity:csr"],"rare tr":["rarity:tr"],"tr":["rarity:tr"],"rare ss":["rarity:ss"],"ss":["rarity:ss"]},"ko":{"c":["rarity:c","rarity:common"],"u":["rarity:u","rarity:uncommon"],"r":["rarity:r","rarity:rare"],"rr":["rarity:rr","rarity:double-rare"],"sr":["rarity:sr","rarity:ultra-rare"],"ar":["rarity:ar","rarity:illustration-rare"],"sar":["rarity:sar","rarity:special-illustration-rare"],"ur":["rarity:ur","rarity:hyper-rare"],"s":["rarity:s","rarity:shiny-rare"],"ssr":["rarity:ssr","rarity:shiny-ultra-rare"],"ma":["rarity:ma","rarity:mega-attack-rare"],"mur":["rarity:mur","rarity:mega-hyper-rare"]}}$aliases$::jsonb translations), resolved as(
  select label,coalesce(translations->coalesce(source_language,'en')->label,translations->'en'->label) codes from normalized,aliases
 ), expanded as(
  select 'rarity:'||replace(label,' ','-') tag from resolved where label<>''
  union all select codes#>>'{}' from resolved where jsonb_typeof(codes)='string'
  union all select x from resolved,lateral jsonb_array_elements_text(case when jsonb_typeof(codes)='array' then codes else '[]'::jsonb end) x
 )select coalesce(array_agg(distinct tag order by tag) filter(where tag is not null),'{}') from expanded
$fn$;
revoke all on function public.catalog_rarity_tags(text,text) from public;
grant execute on function public.catalog_rarity_tags(text,text) to anon,authenticated,service_role;

-- Only source-confirmed card IDs in their own language may receive list-level rarity evidence.
create or replace function public.catalog_apply_rarity_evidence(items jsonb) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='20s' as $fn$
declare answer jsonb;
begin
 if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items)>250 then raise exception 'Lotto non valido';end if;
 with supplied as materialized(
  select * from jsonb_to_recordset(items) as x(source_uid text,source_card_id text,source_language text,rarity text,evidence_url text)
 ), facts as materialized(
  select distinct on(c.id) c.id,x.*,public.catalog_rarity_tags(x.rarity,x.source_language) rarity_tags
  from supplied x join public.cards c on c.source_uid=x.source_uid and c.source_card_id=x.source_card_id and c.source_language=x.source_language
  where x.source_uid='tcgdex:'||x.source_language||':'||x.source_card_id and nullif(x.rarity,'') is not null
   and starts_with(x.evidence_url,'https://api.tcgdex.net/v2/'||x.source_language||'/rarities/')
   and not exists(select 1 from supplied other where other.source_uid=x.source_uid and public.catalog_normalize(other.rarity)<>public.catalog_normalize(x.rarity))
  order by c.id,x.rarity
 ), wanted as materialized(
  select e.entry_key,f.* from facts f join public.catalog_search_entries e on e.card_id=f.id
  where not(e.manual_overrides ? 'source_payload')
   and((e.entry_key='card:'||f.id and e.verification='catalog') or
    (e.source_payload->>'id'=f.source_card_id and e.source_payload->>'source_language'=f.source_language and e.source_payload ? 'variant'
     and not coalesce((e.source_payload->>'identity_review_required')::boolean,false)))
   and(nullif(e.source_payload->>'rarity','') is null or public.catalog_normalize(e.source_payload->>'rarity')=public.catalog_normalize(f.rarity))
   and(e.source_payload->>'rarity' is distinct from f.rarity or
    not(e.manual_overrides ? 'tags') and not(e.tags @> f.rarity_tags))
 ), locked as materialized(
  select w.*,e.tags,e.source_payload,e.source_url,e.name,e.set_code,e.collector_number,e.label,e.language
  from wanted w join public.catalog_search_entries e using(entry_key) order by e.entry_key for update of e skip locked
 ), changed as(
  update public.catalog_search_entries e set
   tags=array(select distinct t from unnest(l.tags||l.rarity_tags)t order by t),
   source_payload=l.source_payload||jsonb_build_object('id',l.source_card_id,'source_language',l.source_language,'rarity',l.rarity,
    'rarity_evidence',jsonb_build_object('method','tcgdex-rarity-list','url',l.evidence_url))||
    case when e.verification='catalog' then jsonb_build_object('metadata_scope','card-metadata-only','reference_image_only',true) else '{}'::jsonb end,
   source_url=coalesce(l.source_url,l.evidence_url),updated_at=clock_timestamp()
  from locked l where e.entry_key=l.entry_key returning e.entry_key
 ), terms as(
  insert into public.catalog_terms(code,label,kind,aliases,parents)
  select distinct t,replace(split_part(t,':',2),'-',' '),'rarity',array[replace(split_part(t,':',2),'-',' ')],'{}'::text[]
  from facts,lateral unnest(rarity_tags)t on conflict(code) do nothing returning code
 )select jsonb_build_object('matched',(select count(*) from facts),'updated',(select count(*) from changed),
  'deferred',(select count(*) from wanted)-(select count(*) from locked)) into answer;
 return answer;
end $fn$;

-- Recanonicalize existing printings from their own stored evidence; preserve their keys and physical facts.
create or replace function public.catalog_repair_rarity_tags(after_key text default '',batch_size integer default 250) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='20s' as $fn$
declare answer jsonb;
begin
 if batch_size is null or batch_size<1 or batch_size>500 then raise exception 'Limite non valido';end if;
 with page as materialized(
  select entry_key from public.catalog_search_entries where verification<>'catalog' and entry_key>after_key order by entry_key limit batch_size
 ), facts as materialized(
  select e.entry_key,e.tags,e.source_payload,e.source_url,e.search_text,e.name,e.set_code,e.collector_number,e.label,
   c.source_language lang,coalesce(e.source_payload->>'rarity',e.source_payload->'metadata'->>'rarity') rarity,
   case when e.source_payload->>'provider'='card-atlas' then e.source_payload->'metadata'->>'card_type' end card_type
  from page p join public.catalog_search_entries e using(entry_key) join public.cards c on c.id=e.card_id
  where e.source_payload->>'id'=c.source_card_id and not(e.manual_overrides ? 'source_payload') and
   ((e.source_payload->>'provider'='card-atlas' and c.source_uid='atlas:'||c.source_language||':'||c.source_card_id) or
    (e.source_payload->>'source_language'=c.source_language and c.source_uid='tcgdex:'||c.source_language||':'||c.source_card_id))
 ), desired as materialized(
  select f.*,
   array(select distinct t from unnest(
    array_remove(f.tags,case when nullif(card_type,'') is not null then 'card-type:'||trim(both '-' from regexp_replace(lower(regexp_replace(normalize(card_type,NFD),U&'[\0300-\036f]','','g')),'[^[:alnum:]]+','-','g')) end)
    ||public.catalog_rarity_tags(rarity,lang)||case when nullif(card_type,'') is not null then array['card-type:'||replace(public.catalog_normalize(normalize(card_type,NFC)),' ','-')] else '{}'::text[] end)t order by t) new_tags,
   case when source_payload->>'provider'='card-atlas' then source_payload||jsonb_build_object('source_language',lang)||
    case when rarity is not null then jsonb_build_object('rarity',rarity) else '{}'::jsonb end else source_payload end new_payload,
   case when lang='ja' then public.catalog_normalize(normalize(concat_ws(' ',name,set_code,collector_number,label),NFC)) else search_text end new_search
  from facts f
 ), locked as materialized(
  select d.* from desired d join public.catalog_search_entries e using(entry_key)
  where d.new_tags is distinct from e.tags or d.new_payload is distinct from e.source_payload or d.new_search is distinct from e.search_text
  order by e.entry_key for update of e skip locked
 ), changed as(
  update public.catalog_search_entries e set tags=l.new_tags,source_payload=l.new_payload,search_text=l.new_search,updated_at=clock_timestamp()
  from locked l where e.entry_key=l.entry_key returning e.entry_key
 ), terms as(
  insert into public.catalog_terms(code,label,kind,aliases,parents)
  select distinct t,replace(split_part(t,':',2),'-',' '),split_part(t,':',1),'{}'::text[],'{}'::text[]
  from desired,lateral unnest(new_tags)t where t like 'rarity:%' or t like 'card-type:%' on conflict(code) do nothing returning code
 )select jsonb_build_object('scanned',(select count(*) from page),'updated',(select count(*) from changed),
   'next_key',(select max(entry_key) from page)) into answer;
 return answer;
end $fn$;
revoke all on function public.catalog_apply_rarity_evidence(jsonb),public.catalog_repair_rarity_tags(text,integer) from public,anon,authenticated;
grant execute on function public.catalog_apply_rarity_evidence(jsonb),public.catalog_repair_rarity_tags(text,integer) to service_role;
create or replace function public.catalog_backfill_generic_rarity(after_id bigint default 0,batch_size integer default 250) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='20s' as $fn$
declare answer jsonb;
begin
 if batch_size is null or batch_size<1 or batch_size>500 then raise exception 'Limite non valido';end if;
 with source_cards as materialized(
  -- Bound the indexed card-id scan BEFORE loading JSON, joining or checking prior repairs.
  select distinct s.card_id from public.catalog_search_entries s
  where s.card_id>after_id and s.verification<>'catalog' and s.source_payload->>'rarity' is not null
  order by s.card_id limit batch_size
 ), evidence as materialized(
  select p.card_id,s.source_payload,s.source_url
  from source_cards p join public.cards c on c.id=p.card_id
  join public.catalog_search_entries g on g.entry_key='card:'||p.card_id
  cross join lateral(
   select e.source_payload,e.source_url from public.catalog_search_entries e
   where e.card_id=p.card_id and e.verification<>'catalog' and e.source_payload->>'rarity' is not null
    and e.source_payload->>'id'=c.source_card_id and e.source_payload->>'source_language'=c.source_language
    and not coalesce((e.source_payload->>'identity_review_required')::boolean,false)
   order by e.updated_at desc,e.entry_key limit 1
  ) s
  where g.verification='catalog' and not(g.manual_overrides ? 'source_payload')
   and(g.source_payload->>'rarity' is distinct from s.source_payload->>'rarity'
    or not(g.manual_overrides ? 'tags') and not(g.tags @> public.catalog_rarity_tags(s.source_payload->>'rarity',c.source_language)))
 ), locked_evidence as materialized(
  select e.* from evidence e join public.catalog_search_entries g on g.entry_key='card:'||e.card_id
  order by g.entry_key for update of g skip locked
 ), updated as(
  update public.catalog_search_entries g set
   tags=array(select distinct t from unnest(g.tags||public.catalog_rarity_tags(e.source_payload->>'rarity',e.source_payload->>'source_language'))t order by t),
   source_payload=g.source_payload||jsonb_build_object('id',e.source_payload->>'id','rarity',e.source_payload->>'rarity','set',e.source_payload->'set',
    'source_language',e.source_payload->>'source_language','metadata_scope','card-metadata-only','reference_image_only',true),
   source_url=e.source_url,updated_at=clock_timestamp()
  from locked_evidence e where g.entry_key='card:'||e.card_id returning g.card_id
 ) select jsonb_build_object('updated',(select count(*) from updated),'scanned',(select count(*) from source_cards),
  'deferred',(select count(*) from evidence)-(select count(*) from locked_evidence),
  'next_id',(select max(card_id) from source_cards)) into answer;
 return answer;
end $fn$;
revoke all on function public.catalog_backfill_generic_rarity(bigint,integer) from public,anon,authenticated;
grant execute on function public.catalog_backfill_generic_rarity(bigint,integer) to service_role;
