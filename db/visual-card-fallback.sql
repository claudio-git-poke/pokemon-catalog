-- Additive/repeatable: public contracts, entry keys and manual overrides stay unchanged.
create index if not exists catalog_entry_set_lookup on public.catalog_search_entries(set_code text_pattern_ops,card_id) include(entry_key);
create index if not exists catalog_entry_rarity_source on public.catalog_search_entries(card_id,updated_at desc)
 where verification<>'catalog' and source_payload->>'rarity' is not null;

create or replace function public.catalog_rarity_tags(value text,source_language text default 'en') returns text[]
language sql immutable security invoker set search_path='' as $fn$
 with normalized as(select public.catalog_normalize(value) label), aliases as(select $aliases${"en":{"common":"rarity:common","uncommon":"rarity:uncommon","rare":"rarity:rare","double rare":"rarity:double-rare","ultra rare":"rarity:ultra-rare","illustration rare":"rarity:illustration-rare","special illustration rare":"rarity:special-illustration-rare","hyper rare":"rarity:hyper-rare","mega hyper rare":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rare":"rarity:shiny-rare","shiny ultra rare":"rarity:shiny-ultra-rare"},"it":{"comune":"rarity:common","non comune":"rarity:uncommon","rara":"rarity:rare","rara doppia":"rarity:double-rare","ultrarara":"rarity:ultra-rare","rara illustrazione":"rarity:illustration-rare","rara illustrazione speciale":"rarity:special-illustration-rare","rara iper":"rarity:hyper-rare","mega iper raro":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rare":"rarity:shiny-rare","ultrarara cromatica":"rarity:shiny-ultra-rare"},"fr":{"commune":"rarity:common","peu commune":"rarity:uncommon","rare":"rarity:rare","double rare":"rarity:double-rare","ultra rare":"rarity:ultra-rare","illustration rare":"rarity:illustration-rare","illustration speciale rare":"rarity:special-illustration-rare","hyper rare":"rarity:hyper-rare","mega hyper rare":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rare":"rarity:shiny-rare","chromatique ultra rare":"rarity:shiny-ultra-rare"},"de":{"haufig":"rarity:common","ungewohnlich":"rarity:uncommon","selten":"rarity:rare","doppelselten":"rarity:double-rare","ultra selten":"rarity:ultra-rare","selten illustration":"rarity:illustration-rare","selten besondere illustration":"rarity:special-illustration-rare","hyperselten":"rarity:hyper-rare","mega hyper selten":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rare":"rarity:shiny-rare","ultraselten schillernd":"rarity:shiny-ultra-rare"},"es":{"comun":"rarity:common","uncommon":"rarity:uncommon","rara":"rarity:rare","rara doble":"rarity:double-rare","ultra rara":"rarity:ultra-rare","rara ilustracion":"rarity:illustration-rare","rara ilustracion especial":"rarity:special-illustration-rare","rara hiper":"rarity:hyper-rare","mega hiper rara":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rare":"rarity:shiny-rare","rara ultra variocolor":"rarity:shiny-ultra-rare"},"pt":{"comum":"rarity:common","incomum":"rarity:uncommon","rara":"rarity:rare","rara dupla":"rarity:double-rare","ultra rara":"rarity:ultra-rare","ilustracao rara":"rarity:illustration-rare","ilustracao rara especial":"rarity:special-illustration-rare","hiper rara":"rarity:hyper-rare","mega hiper raro":"rarity:mega-hyper-rare","mega attack rare":"rarity:mega-attack-rare","promo":"rarity:promo","shiny rara":"rarity:shiny-rare","brilhante ultra rara":"rarity:shiny-ultra-rare"}}$aliases$::jsonb translations)
 select coalesce(array_agg(distinct tag order by tag) filter(where tag is not null),'{}') from normalized,aliases,
 lateral unnest(case when label='' then '{}'::text[] else array['rarity:'||replace(label,' ','-'),
 coalesce(translations->coalesce(source_language,'en')->>label,translations->'en'->>label)] end) tag
$fn$;
revoke all on function public.catalog_rarity_tags(text,text) from public;
grant execute on function public.catalog_rarity_tags(text,text) to anon,authenticated,service_role;

-- Reindexing a parent must retain previously verified card-level rarity metadata.
create or replace function public.catalog_index_card() returns trigger language plpgsql security invoker set search_path='' as $fn$
declare n text; base_tags text[]='{}';
begin
 n:=case when lower(split_part(new.sigla,'@',1))='mfb' then null when nullif(new.source_local_id,'') is not null then public.catalog_number(new.source_local_id)
   when lower(split_part(new.sigla,'@',1))<>'mfb' and new.numero>0 then new.numero::text else null end;
 if lower(split_part(new.sigla,'@',1))='mfb' then base_tags:=array['family:my-first-battle'];end if;
 insert into public.catalog_search_entries(entry_key,card_id,collector_number,name,set_code,language,tags,facts,search_text)
 values('card:'||new.id,new.id,n,coalesce(new.nome,''),coalesce(new.sigla,''),coalesce(new.lingua,''),base_tags,public.catalog_base_facts(new),public.catalog_normalize(concat_ws(' ',new.nome,new.sigla,new.codice)))
 on conflict(entry_key) do update set collector_number=excluded.collector_number,name=excluded.name,set_code=excluded.set_code,language=excluded.language,
 tags=excluded.tags||public.catalog_rarity_tags(catalog_search_entries.source_payload->>'rarity',catalog_search_entries.source_payload->>'source_language'),
 facts=excluded.facts,search_text=excluded.search_text,updated_at=now();
 return new;
end $fn$;

-- Reuse only same-card, same-language source evidence; never borrow a rarity from another printing identity.
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
 ), updated as(
  update public.catalog_search_entries g set
   tags=array(select distinct t from unnest(g.tags||public.catalog_rarity_tags(e.source_payload->>'rarity',e.source_payload->>'source_language'))t order by t),
   source_payload=g.source_payload||jsonb_build_object('id',e.source_payload->>'id','rarity',e.source_payload->>'rarity','set',e.source_payload->'set',
    'source_language',e.source_payload->>'source_language','metadata_scope','card-metadata-only','reference_image_only',true),
   source_url=e.source_url,updated_at=clock_timestamp()
  from evidence e where g.entry_key='card:'||e.card_id returning g.card_id
 ) select jsonb_build_object('updated',(select count(*) from updated),'scanned',(select count(*) from source_cards),
  'next_id',(select max(card_id) from source_cards)) into answer;
 return answer;
end $fn$;
revoke all on function public.catalog_backfill_generic_rarity(bigint,integer) from public,anon,authenticated;
grant execute on function public.catalog_backfill_generic_rarity(bigint,integer) to service_role;
