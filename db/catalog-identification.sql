-- Additive identification index. Existing cards, images and identities are preserved.
create table if not exists public.catalog_terms (
 code text primary key,label text not null,kind text not null,aliases text[] not null default '{}',parents text[] not null default '{}'
);
create table if not exists public.catalog_releases (
 code text primary key,family_code text not null references public.catalog_terms(code),name text not null,release_year integer,source_url text not null
);
create table if not exists public.catalog_search_entries (
 entry_key text primary key,card_id bigint not null references public.cards(id) on delete cascade,
 release_code text references public.catalog_releases(code),release_year integer,
 collector_number text,denominator text,name text not null,set_code text not null,language text not null,
 tags text[] not null default '{}',facts jsonb not null default '{}',
 source_url text,source_payload jsonb not null default '{}',verification text not null default 'catalog' check(verification in ('catalog','source','reviewed')),
 image_url text,label text not null default 'Variante non ancora identificata',updated_at timestamptz not null default now(),
 search_text text not null default '',search_vector tsvector generated always as(to_tsvector('simple'::regconfig,search_text)) stored,
 check(jsonb_typeof(facts)='object')
);
create index if not exists catalog_entry_card on public.catalog_search_entries(card_id);
create index if not exists catalog_entry_tags on public.catalog_search_entries using gin(tags);
create index if not exists catalog_entry_text on public.catalog_search_entries using gin(search_vector);
create index if not exists catalog_entry_number on public.catalog_search_entries(collector_number,release_year);
create index if not exists catalog_entry_release on public.catalog_search_entries(release_code);
alter table public.cards add column if not exists traits_checked_at timestamptz;
alter table public.cards add column if not exists traits_next_attempt_at timestamptz not null default now();
alter table public.cards add column if not exists traits_last_error text;
create index if not exists cards_traits_queue on public.cards(traits_next_attempt_at,id) where source_card_id is not null;
create or replace function public.catalog_normalize(value text) returns text language sql immutable set search_path='' as $$
 select trim(regexp_replace(lower(translate(coalesce(value,''),'àáâäãåèéêëìíîïòóôöõùúûüçñ','aaaaaaeeeeiiiiooooouuuucn')),'[^[:alnum:]]+',' ','g'))
$$;
create or replace function public.catalog_number(value text) returns text language sql immutable set search_path='' as $$
 select lower(regexp_replace(split_part(coalesce(value,''),'/',1),'^0+(?=[0-9])',''))
$$;
create or replace function public.catalog_base_facts(c public.cards) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object(
  'asian_script',case when c.lingua in ('JP','KOR','CHN','CHN-T','TH') then true when c.lingua in ('INT','EN','IT','FR','DE','ES','PT','ID') then false else null end,
  'name_has_lv',case when c.nome is not null then c.nome ~* '(^|[[:space:]])LV[.]?' else null end,
  'name_has_ex',case when c.nome is not null then c.nome ~* '(^|[[:space:]])ex($|[[:space:]])' else null end,
  'name_has_gx',case when c.nome is not null then c.nome ~* '(^|[[:space:]-])GX($|[[:space:]])' else null end,
  'name_has_vmax',case when c.nome is not null then c.nome ~* '(^|[[:space:]])VMAX($|[[:space:]])' else null end,
  'name_has_vstar',case when c.nome is not null then c.nome ~* '(^|[[:space:]])VSTAR($|[[:space:]])' else null end
 ))
$$;
create or replace function public.catalog_index_card() returns trigger language plpgsql set search_path='' as $$
declare n text; base_tags text[]='{}';
begin
 n:=case when nullif(new.source_local_id,'') is not null then public.catalog_number(new.source_local_id)
   when lower(split_part(new.sigla,'@',1))<>'mfb' and new.numero>0 then new.numero::text else null end;
 if lower(split_part(new.sigla,'@',1))='mfb' then base_tags:=array['family:my-first-battle'];end if;
 insert into public.catalog_search_entries(entry_key,card_id,collector_number,name,set_code,language,tags,facts,search_text)
 values('card:'||new.id,new.id,n,coalesce(new.nome,''),coalesce(new.sigla,''),coalesce(new.lingua,''),base_tags,public.catalog_base_facts(new),public.catalog_normalize(concat_ws(' ',new.nome,new.sigla,new.codice)))
 on conflict(entry_key) do update set collector_number=excluded.collector_number,name=excluded.name,set_code=excluded.set_code,language=excluded.language,tags=excluded.tags,facts=excluded.facts,search_text=excluded.search_text,updated_at=now();
 return new;
end $$;
drop trigger if exists catalog_index_card on public.cards;
create trigger catalog_index_card after insert or update of nome,sigla,lingua,numero,source_local_id,codice on public.cards for each row execute function public.catalog_index_card();
insert into public.catalog_search_entries(entry_key,card_id,collector_number,name,set_code,language,tags,facts,search_text)
select 'card:'||c.id,c.id,case when nullif(c.source_local_id,'') is not null then public.catalog_number(c.source_local_id) when lower(split_part(c.sigla,'@',1))<>'mfb' and c.numero>0 then c.numero::text else null end,
 coalesce(c.nome,''),coalesce(c.sigla,''),coalesce(c.lingua,''),case when lower(split_part(c.sigla,'@',1))='mfb' then array['family:my-first-battle'] else '{}'::text[] end,
 public.catalog_base_facts(c),public.catalog_normalize(concat_ws(' ',c.nome,c.sigla,c.codice)) from public.cards c
on conflict(entry_key) do nothing;
-- Public catalogue only. No anonymous writes and no privileged search function.
alter table public.catalog_terms enable row level security;
alter table public.catalog_releases enable row level security;
alter table public.catalog_search_entries enable row level security;
revoke all on public.catalog_terms,public.catalog_releases,public.catalog_search_entries from anon,authenticated;
grant select on public.catalog_terms,public.catalog_releases,public.catalog_search_entries to anon,authenticated;
grant all on public.catalog_terms,public.catalog_releases,public.catalog_search_entries to service_role;
drop policy if exists catalog_terms_read on public.catalog_terms;
create policy catalog_terms_read on public.catalog_terms for select to anon,authenticated using(true);
drop policy if exists catalog_releases_read on public.catalog_releases;
create policy catalog_releases_read on public.catalog_releases for select to anon,authenticated using(true);
drop policy if exists catalog_entries_read on public.catalog_search_entries;
create policy catalog_entries_read on public.catalog_search_entries for select to anon,authenticated using(true);
create or replace function public.identify_catalog_cards(
 tokens text[] default '{}',required_tags text[] default '{}',card_number text default null,card_denominator text default null,
 wanted_year integer default null,wanted_language text default null,observations jsonb default '{}',page_offset integer default 0,page_size integer default 24
) returns jsonb language sql stable security invoker set search_path='' set statement_timeout='8s' as $$
 with query as(select case when cardinality(tokens)>0 then to_tsquery('simple',array_to_string(array(select quote_literal(public.catalog_normalize(t))||':*' from unnest(tokens) t where public.catalog_normalize(t)<>''),' & ')) else null end q),
 candidates as materialized(
  select e.*,c.image_url as reference_image_url,c.image_status,
   e.facts as known_facts
  from public.catalog_search_entries e join public.cards c on c.id=e.card_id cross join query q
  where (q.q is null or e.search_vector@@q.q) and e.tags@>required_tags
   and(card_number is null or e.collector_number=public.catalog_number(card_number))
   and(card_denominator is null or e.denominator=card_denominator)
   and(wanted_year is null or e.release_year=wanted_year)
   and(wanted_language is null or e.language=wanted_language)
 ),
 ranked as(
  select c.*,s.matched,s.contradicted,s.unknown,s.matched*3-s.contradicted*4 as score
  from candidates c cross join lateral(
   select count(*) filter(where c.known_facts->o.key=o.value)::integer matched,
    count(*) filter(where c.known_facts ? o.key and c.known_facts->o.key<>o.value)::integer contradicted,
    count(*) filter(where not(c.known_facts ? o.key))::integer unknown
   from jsonb_each(observations) o where o.value in ('true'::jsonb,'false'::jsonb)
  ) s
 ),
 deduplicated as(
  -- A base record is only a fallback when no precise variant of that card matched.
  select * from ranked r where r.verification<>'catalog' or not exists(select 1 from ranked p where p.card_id=r.card_id and p.verification<>'catalog')
 ),
 page as(select * from deduplicated order by score desc,case verification when 'reviewed' then 2 when 'source' then 1 else 0 end desc,card_id,entry_key limit least(greatest(page_size,1),48) offset least(greatest(page_offset,0),10000))
 select jsonb_build_object('total',(select count(*) from deduplicated),'results',coalesce((select jsonb_agg(to_jsonb(page)-'search_vector'-'search_text'-'source_payload') from page),'[]'::jsonb))
$$;
grant execute on function public.identify_catalog_cards(text[],text[],text,text,integer,text,jsonb,integer,integer) to anon,authenticated,service_role;
