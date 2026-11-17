-- Additive and repeatable. Imported claims and candidate links never alter cards or printings.
set local lock_timeout='5s';
create table if not exists public.catalog_packaging_documents(
 document_key text primary key,title text not null,document_date date not null,
 sha256 text not null unique check(sha256 ~ '^[0-9a-f]{64}$'),archive_path text not null,
 source_manifest jsonb not null check(jsonb_typeof(source_manifest)='array'),limitations text[] not null default '{}',
 manual_overrides jsonb not null default '{}' check(jsonb_typeof(manual_overrides)='object'),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.catalog_packaging_candidates(
 candidate_key text primary key,document_key text not null references public.catalog_packaging_documents(document_key),
 source_row_number integer not null check(source_row_number>0),source_row text not null,
 group_name text not null,raw_language text not null,language text not null,
 language_status text not null check(language_status in('documented','unknown')),
 check((language='und' and language_status='unknown') or(language in('INT','IT','FR','DE','ES','PT','JP','KOR','CHN','CHN-T','ID','TH') and language_status='documented')),
 name text not null,card_number text not null,origin text not null,
 packaging_types text[] not null check(cardinality(packaging_types)>0 and packaging_types<@array['S1','S2','S3','S4'] and array_position(packaging_types,null) is null),
 packaging_description text not null,claimed_evidence_level text not null check(claimed_evidence_level in('A','B','C')),
 source_refs jsonb not null check(jsonb_typeof(source_refs)='array' and jsonb_array_length(source_refs)>0),uncertainties text[] not null default '{}',
 review_status text not null default 'pending' check(review_status in('pending','confirmed','rejected')),
 review_note text,reviewed_at timestamptz,review_source_url text check(review_source_url is null or review_source_url like 'https://%'),
 check(review_status<>'confirmed' or(reviewed_at is not null and review_source_url is not null and cardinality(packaging_types)=1)),
 wrapper_front_url text check(wrapper_front_url is null or wrapper_front_url like 'https://%'),
 wrapper_back_url text check(wrapper_back_url is null or wrapper_back_url like 'https://%'),
 search_text text not null default '',search_vector tsvector generated always as(to_tsvector('simple',search_text)) stored,
 manual_overrides jsonb not null default '{}' check(jsonb_typeof(manual_overrides)='object'),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(document_key,source_row_number)
);
create index if not exists catalog_packaging_search on public.catalog_packaging_candidates using gin(search_vector);
create index if not exists catalog_packaging_filter on public.catalog_packaging_candidates(language,review_status,candidate_key);
create index if not exists catalog_packaging_types on public.catalog_packaging_candidates using gin(packaging_types);
create table if not exists public.catalog_packaging_links(
 candidate_key text not null references public.catalog_packaging_candidates(candidate_key),card_id bigint not null references public.cards(id),
 entry_key text references public.catalog_search_entries(entry_key),source_uid_snapshot text,
 method text not null check(method in('exact-set-number-language','manual')),
 status text not null default 'candidate' check(status in('candidate','confirmed','rejected')),
 evidence_url text check(evidence_url is null or evidence_url like 'https://%'),note text,
 check(status<>'confirmed' or(entry_key is not null and evidence_url is not null)),
 manual_overrides jsonb not null default '{}' check(jsonb_typeof(manual_overrides)='object'),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),primary key(candidate_key,card_id)
);
create index if not exists catalog_packaging_link_card on public.catalog_packaging_links(card_id,candidate_key);
create index if not exists catalog_packaging_link_printing on public.catalog_packaging_links(entry_key) where entry_key is not null;

create or replace function public.catalog_packaging_prepare() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='catalog_packaging_candidates' then
  new.search_text:=public.catalog_normalize(normalize(concat_ws(' ',new.name,new.card_number,new.group_name,new.origin,new.raw_language),NFC));
 end if;
 if tg_op='UPDATE' and(to_jsonb(new)-'updated_at')=(to_jsonb(old)-'updated_at') then return null;end if;
 new.updated_at:=clock_timestamp();return new;
end $$;
create or replace function public.catalog_packaging_link_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
declare e public.catalog_search_entries;
begin
 if new.entry_key is not null then
  select * into e from public.catalog_search_entries where entry_key=new.entry_key;
  if not found or e.card_id<>new.card_id then raise exception 'La stampa non appartiene alla carta collegata';end if;
 end if;
 if new.status='confirmed' then
  if not exists(select 1 from public.catalog_packaging_candidates where candidate_key=new.candidate_key and review_status='confirmed') then raise exception 'Verificare prima la confezione';end if;
  if e.entry_key is null or e.verification='catalog' or e.source_payload->>'metadata_scope'='card-metadata-only'
    or coalesce((e.source_payload->>'identity_review_required')::boolean,false)
    or(e.verification<>'reviewed' and not(e.source_payload ? 'variant') and nullif(to_jsonb(e)->>'release_code','') is null) then raise exception 'Serve una stampa identificata, non una scheda generica';end if;
 end if;
 return new;
end $$;
revoke all on function public.catalog_packaging_prepare(),public.catalog_packaging_link_guard() from public,anon,authenticated;
grant execute on function public.catalog_packaging_prepare(),public.catalog_packaging_link_guard() to service_role;

-- Reuse the existing exact-value manual protection. No public write endpoint is introduced.
do $$ declare t text;begin
 foreach t in array array['catalog_packaging_documents','catalog_packaging_candidates','catalog_packaging_links'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('drop policy if exists packaging_read on public.%I',t);
  execute format('create policy packaging_read on public.%I for select to anon,authenticated using(true)',t);
  execute format('drop policy if exists packaging_worker on public.%I',t);
  execute format('create policy packaging_worker on public.%I for all to service_role using(true) with check(true)',t);
  execute format('drop trigger if exists aaa_packaging_manual_capture on public.%I',t);
  execute format('create trigger aaa_packaging_manual_capture before insert or update or delete on public.%I for each row execute function public.catalog_manual_capture()',t);
  execute format('drop trigger if exists zzzz_packaging_manual_enforce on public.%I',t);
  execute format('create trigger zzzz_packaging_manual_enforce before insert or update on public.%I for each row execute function public.catalog_manual_enforce()',t);
  execute format('drop trigger if exists zzzzz_packaging_prepare on public.%I',t);
  execute format('create trigger zzzzz_packaging_prepare before insert or update on public.%I for each row execute function public.catalog_packaging_prepare()',t);
 end loop;
end $$;
drop policy if exists packaging_read on public.catalog_packaging_links;
create policy packaging_read on public.catalog_packaging_links for select to anon,authenticated using(
 status<>'rejected' and exists(select 1 from public.catalog_packaging_candidates p where p.candidate_key=catalog_packaging_links.candidate_key and p.review_status<>'rejected')
);
drop trigger if exists bbb_packaging_link_guard on public.catalog_packaging_links;
create trigger bbb_packaging_link_guard before insert or update on public.catalog_packaging_links for each row execute function public.catalog_packaging_link_guard();

-- Append-only audit, confined to the three newly authorized table triggers.
create or replace function catalog_internal.log_packaging_manual_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous jsonb:='{}';prior_row jsonb:='{}';current_row jsonb:=to_jsonb(new);changed text[];
 identity_value jsonb:='{}';key_field text;before_values jsonb;after_values jsonb;
 claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}');
 headers jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
begin
 if tg_table_schema<>'public' or tg_table_name<>all(array['catalog_packaging_documents','catalog_packaging_candidates','catalog_packaging_links']) or pg_trigger_depth()<1 then raise exception 'Audit consentito solo dai trigger delle confezioni';end if;
 if tg_op='UPDATE' then previous:=old.manual_overrides;prior_row:=to_jsonb(old);end if;
 select array_agg(k order by k) into changed from jsonb_object_keys(new.manual_overrides)k where not(previous ? k) or previous->k is distinct from new.manual_overrides->k;
 if changed is null then return new;end if;
 foreach key_field in array tg_argv loop identity_value:=identity_value||jsonb_build_object(key_field,current_row->key_field);end loop;
 select coalesce(jsonb_object_agg(k,prior_row->k),'{}'),coalesce(jsonb_object_agg(k,current_row->k),'{}') into before_values,after_values from unnest(changed)k;
 insert into public.catalog_manual_history(table_name,record_key,changed_fields,before_values,after_values,previous_overrides,new_overrides,actor_role,actor_subject,reason)
 values(tg_table_name,identity_value,changed,before_values,after_values,previous,new.manual_overrides,
  coalesce(claims->>'role',nullif(current_setting('role',true),'none'),session_user::text),claims->>'sub',headers->>'x-catalog-write-reason');
 return new;
end $$;
revoke all on function catalog_internal.log_packaging_manual_change() from public,anon,authenticated,service_role;
do $$ declare t text;args text;begin
 for t,args in select * from(values('catalog_packaging_documents','''document_key'''),('catalog_packaging_candidates','''candidate_key'''),('catalog_packaging_links','''candidate_key'',''card_id'''))x(t,args) loop
  execute format('drop trigger if exists zzzz_packaging_history_insert on public.%I',t);
  execute format('drop trigger if exists zzzz_packaging_history_update on public.%I',t);
  execute format('create trigger zzzz_packaging_history_insert after insert on public.%I for each row when(new.manual_overrides<>''{}''::jsonb) execute function catalog_internal.log_packaging_manual_change(%s)',t,args);
  execute format('create trigger zzzz_packaging_history_update after update on public.%I for each row when(old.manual_overrides is distinct from new.manual_overrides) execute function catalog_internal.log_packaging_manual_change(%s)',t,args);
 end loop;
end $$;
