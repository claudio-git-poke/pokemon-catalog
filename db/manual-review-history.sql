-- Confirm existing values explicitly and retain an append-only history of human decisions.
set local lock_timeout='5s';
create schema if not exists catalog_internal;
create table public.catalog_manual_history(
 id bigint generated always as identity primary key,
 at timestamptz not null default clock_timestamp(),
 table_name text not null,
 record_key jsonb not null check(jsonb_typeof(record_key)='object'),
 changed_fields text[] not null,
 before_values jsonb not null,
 after_values jsonb not null,
 previous_overrides jsonb not null,
 new_overrides jsonb not null,
 actor_role text not null,
 actor_subject text,
 reason text
);
create index catalog_manual_history_record on public.catalog_manual_history(table_name,at desc,id desc);
alter table public.catalog_manual_history enable row level security;
revoke all on public.catalog_manual_history from public,anon,authenticated,service_role;
grant select on public.catalog_manual_history to service_role;
create policy manual_history_worker_read on public.catalog_manual_history for select to service_role using(true);

-- Authorized card edits may update their derived index without granting clients table-wide index writes.
create function catalog_internal.index_authorized_card() returns trigger
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
revoke all on function catalog_internal.index_authorized_card() from public,anon,authenticated,service_role;
drop trigger catalog_index_card on public.cards;
drop trigger catalog_manual_card_changed on public.cards;
create trigger catalog_index_card after insert on public.cards for each row execute function catalog_internal.index_authorized_card();
create trigger catalog_index_card_update after update on public.cards for each row when (
 (old.nome,old.sigla,old.lingua,old.numero,old.source_local_id,old.codice) is distinct from (new.nome,new.sigla,new.lingua,new.numero,new.source_local_id,new.codice)
 or (old.manual_overrides->'sigla',old.manual_overrides->'nome',old.manual_overrides->'lingua') is distinct from (new.manual_overrides->'sigla',new.manual_overrides->'nome',new.manual_overrides->'lingua'))
execute function catalog_internal.index_authorized_card();

-- Elevated privileges are confined to appending audit events from existing authorized table writes.
create function catalog_internal.log_manual_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous jsonb:='{}'; prior_row jsonb:='{}'; current_row jsonb:=to_jsonb(new);
 changed text[]; before_values jsonb; after_values jsonb; identity_value jsonb:='{}'; key_field text;
 claims jsonb:=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}');
 headers jsonb:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
 caller_role text:=coalesce(claims->>'role',nullif(current_setting('role',true),'none'),session_user::text);
begin
 if tg_table_schema<>'public' or tg_table_name<>all(array['cards','catalog_search_entries','set_carte','set_carte_immagini','catalog_export_links','catalog_visual_links','catalog_visual_assets','set_espansioni','catalog_printing_inventory','catalog_code_reviews']) or pg_trigger_depth()<1 then
  raise exception 'Audit consentito solo dai trigger del catalogo';
 end if;
 if caller_role='authenticated' and auth.uid() is null then raise exception 'Identità autenticata mancante';end if;
 if tg_op='UPDATE' then previous:=old.manual_overrides;prior_row:=to_jsonb(old);end if;
 select array_agg(k order by k) into changed from jsonb_object_keys(new.manual_overrides) k
 where not(previous ? k) or previous->k is distinct from new.manual_overrides->k;
 if changed is null then return new;end if;
 foreach key_field in array tg_argv loop identity_value:=identity_value||jsonb_build_object(key_field,current_row->key_field);end loop;
 select coalesce(jsonb_object_agg(k,prior_row->k),'{}'),coalesce(jsonb_object_agg(k,current_row->k),'{}') into before_values,after_values from unnest(changed) k;
 insert into public.catalog_manual_history(table_name,record_key,changed_fields,before_values,after_values,previous_overrides,new_overrides,actor_role,actor_subject,reason)
 values(tg_table_name,identity_value,changed,before_values,after_values,previous,new.manual_overrides,caller_role,claims->>'sub',headers->>'x-catalog-write-reason');
 return new;
end $$;
revoke all on function catalog_internal.log_manual_change() from public,anon,authenticated,service_role;

do $$
declare target text; args text;
begin
 for target,args in select * from(values
  ('cards','''id'''),('catalog_search_entries','''entry_key'''),('set_carte','''sigla'',''numero'',''variante'''),
  ('set_carte_immagini','''sigla'',''numero'',''variante'',''lingua'''),('catalog_export_links','''entry_key'''),
  ('catalog_visual_links','''asset_key'',''entry_key'''),('catalog_visual_assets','''asset_key'''),('set_espansioni','''sigla'''),
  ('catalog_printing_inventory','''record_key'''),('catalog_code_reviews','''sigla'',''numero'',''variante''')) as t(target,args)
 loop
  execute format('create trigger zzzz_catalog_manual_history_insert after insert on public.%I for each row when(new.manual_overrides<>''{}''::jsonb) execute function catalog_internal.log_manual_change(%s)',target,args);
  execute format('create trigger zzzz_catalog_manual_history_update after update on public.%I for each row when(old.manual_overrides is distinct from new.manual_overrides) execute function catalog_internal.log_manual_change(%s)',target,args);
 end loop;
end $$;

create function public.catalog_protect_card_fields(target_card_id bigint,field_names text[],expected_values jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.cards; field text; selected text[]; patch jsonb:='{}'; current_values jsonb; headers text;
 allowed text[]:=array['file_name','nome','sigla','lingua','numero','variante','codice','link_cardmarket','image_url','image_status','image_source','notes'];
begin
 if field_names is null or cardinality(field_names)=0 or jsonb_typeof(expected_values) is distinct from 'object' then raise exception 'Seleziona i campi da proteggere';end if;
 if exists(select 1 from unnest(field_names) f where f is null or not(f=any(allowed))) then raise exception 'Campo non modificabile da questa funzione';end if;
 selected:=field_names;
 if selected && array['image_url','image_status','image_source'] then selected:=selected||array['image_url','image_status','image_source'];end if;
 select array_agg(distinct f order by f) into selected from unnest(selected) f;
 select * into c from public.cards where id=target_card_id for update;
 if not found then raise exception 'Carta non trovata o non accessibile';end if;
 current_values:=to_jsonb(c);
 foreach field in array selected loop
  if not(expected_values ? field) or expected_values->field is distinct from current_values->field then
   raise exception 'Il campo % è cambiato: ricarica la carta prima di proteggerlo',field;
  end if;
  patch:=patch||jsonb_build_object(field,current_values->field);
 end loop;
 headers:=current_setting('request.headers',true);
 perform set_config('request.headers',(coalesce(nullif(headers,'')::jsonb,'{}')||jsonb_build_object('x-catalog-write-mode','manual','x-catalog-write-reason','confirm_existing_card_fields'))::text,true);
 update public.cards set manual_overrides=manual_overrides||patch where id=target_card_id returning * into c;
 if not found then raise exception 'Carta non modificabile';end if;
 perform set_config('request.headers',coalesce(headers,''),true);
 return jsonb_build_object('id',c.id,'protected_fields',selected,'manual_overrides',c.manual_overrides);
end $$;
revoke all on function public.catalog_protect_card_fields(bigint,text[],jsonb) from public;
grant execute on function public.catalog_protect_card_fields(bigint,text[],jsonb) to anon,authenticated,service_role;

-- These are confirmed source reviews, not inferred human edits. Existing manual choices win.
select set_config('request.headers','{"x-catalog-write-mode":"manual","x-catalog-write-reason":"existing_verified_code_review"}',true);
update public.catalog_code_reviews r set manual_overrides=(to_jsonb(r)-array['manual_overrides','aggiornato_il'])||r.manual_overrides
where r.status='verified' and r.proposed_code is not null and cardinality(r.source_urls)>0 and r.manual_overrides='{}';
update public.set_carte c set manual_overrides=c.manual_overrides||jsonb_build_object('codice',c.codice)
from public.catalog_code_reviews r where(c.sigla,c.numero,c.variante)=(r.sigla,r.numero,r.variante)
and r.status='verified' and cardinality(r.source_urls)>0 and c.codice=r.proposed_code
and c.cardmarket_id is not distinct from r.cardmarket_id and not(c.manual_overrides ? 'codice');
select set_config('request.headers','',true);
