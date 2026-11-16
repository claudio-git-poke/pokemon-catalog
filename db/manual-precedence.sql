-- Manual values are authoritative. Workers may update only fields without an override.
-- Direct dashboard/SQL and existing editor writes are manual; service_role workers are automatic.
set local lock_timeout='5s';
create or replace function public.catalog_write_is_manual() returns boolean
language sql stable security invoker set search_path='' as $$
 select case coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-catalog-write-mode','')
   when 'automatic' then false when 'manual' then true
   else coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',nullif(current_setting('role',true),'none'),session_user::text)<>'service_role' end
$$;
revoke all on function public.catalog_write_is_manual() from public;
grant execute on function public.catalog_write_is_manual() to anon,authenticated,service_role;

create or replace function public.catalog_manual_capture() returns trigger
language plpgsql security invoker set search_path='' as $$
declare proposed jsonb; previous jsonb; saved jsonb; field text; value jsonb;
 excluded text[]:=array['manual_overrides','created_at','updated_at','aggiornato_il','linked_at','search_text','search_vector',
 'image_attempts','image_next_attempt_at','image_last_error','traits_checked_at','traits_next_attempt_at','traits_last_error','source_updated_at'];
begin
 if tg_op='DELETE' then
  if not public.catalog_write_is_manual() and old.manual_overrides<>'{}'::jsonb then return null;end if;
  if not public.catalog_write_is_manual() and tg_table_name='cards' then
   if exists(select 1 from public.catalog_search_entries e where e.card_id=old.id and e.manual_overrides<>'{}'::jsonb) then return null;end if;
  end if;
  return old;
 end if;
 proposed:=to_jsonb(new)-excluded;
 if tg_op='UPDATE' then previous:=to_jsonb(old);saved:=old.manual_overrides;else previous:='{}';saved:='{}';end if;
 -- Nested indexing/queue updates are derived work, not new human corrections.
 if public.catalog_write_is_manual() and pg_trigger_depth()=1 then
  saved:=saved||coalesce(new.manual_overrides,'{}');
  for field,value in select * from jsonb_each(proposed) loop
   if tg_op='INSERT' or value is distinct from previous->field then
    saved:=saved||jsonb_build_object(field,value);
   end if;
  end loop;
  -- Photo state/source must agree with the manually chosen URL, including an empty URL.
  if tg_table_name='cards' and (tg_op='INSERT' or (proposed->'image_url',proposed->'image_status',proposed->'image_source') is distinct from (previous->'image_url',previous->'image_status',previous->'image_source')) then
   saved:=saved||jsonb_build_object('image_url',new.image_url,'image_status',new.image_status,'image_source',new.image_source);
  end if;
 end if;
 -- Workers cannot erase locks by sending defaults, stale metadata or an empty object.
 new.manual_overrides:=saved;
 new:=jsonb_populate_record(new,saved-excluded);
 return new;
end $$;

create or replace function public.catalog_manual_enforce() returns trigger
language plpgsql security invoker set search_path='' as $$
declare parent_values jsonb; projected jsonb:='{}';
begin
 if tg_table_name='catalog_search_entries' then
  select c.manual_overrides into parent_values from public.cards c where c.id=new.card_id;
  if parent_values ? 'sigla' then projected:=projected||jsonb_build_object('set_code',parent_values->'sigla');end if;
  if parent_values ? 'nome' then projected:=projected||jsonb_build_object('name',parent_values->'nome');end if;
  if parent_values ? 'lingua' then projected:=projected||jsonb_build_object('language',parent_values->'lingua');end if;
  -- Printing-specific corrections are more specific than the parent card.
  new:=jsonb_populate_record(new,projected);
 end if;
 -- Runs after normalizers and source-derived Cardmarket/code triggers.
 new:=jsonb_populate_record(new,new.manual_overrides-array['manual_overrides','created_at','updated_at','aggiornato_il','linked_at','search_text','search_vector','image_attempts','image_next_attempt_at','image_last_error','traits_checked_at','traits_next_attempt_at','traits_last_error','source_updated_at']);
 if tg_table_name='catalog_search_entries' and (new.manual_overrides<>'{}'::jsonb or projected<>'{}'::jsonb) then
  new.search_text:=public.catalog_normalize(concat_ws(' ',new.name,new.set_code,new.collector_number,new.label,array_to_string(new.tags,' ')));
 end if;
 return new;
end $$;
revoke all on function public.catalog_manual_capture(),public.catalog_manual_enforce() from public,anon,authenticated;
grant execute on function public.catalog_manual_capture(),public.catalog_manual_enforce() to service_role;

create or replace function public.catalog_manual_card_changed() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (old.manual_overrides->'sigla',old.manual_overrides->'nome',old.manual_overrides->'lingua') is distinct from
    (new.manual_overrides->'sigla',new.manual_overrides->'nome',new.manual_overrides->'lingua') then
  update public.catalog_search_entries set updated_at=clock_timestamp() where card_id=new.id;
 end if;
 return new;
end $$;
revoke all on function public.catalog_manual_card_changed() from public,anon,authenticated;
grant execute on function public.catalog_manual_card_changed() to service_role;

do $$
declare target text;
begin
 foreach target in array array['cards','catalog_search_entries','set_carte','set_carte_immagini','catalog_export_links','catalog_visual_links','catalog_visual_assets','set_espansioni','catalog_printing_inventory','catalog_code_reviews'] loop
  execute format('alter table public.%I add column manual_overrides jsonb not null default ''{}'' check(jsonb_typeof(manual_overrides)=''object'')',target);
 end loop;
end $$;

create trigger catalog_manual_card_changed after update on public.cards
 for each row when (old.manual_overrides is distinct from new.manual_overrides)
 execute function public.catalog_manual_card_changed();

-- Existing explicit manual/reviewed markers are trustworthy; unmarked history cannot be inferred.
update public.cards set manual_overrides=jsonb_build_object('image_url',image_url,'image_status',image_status,'image_source',image_source) where image_status='manual';
update public.catalog_search_entries set manual_overrides=to_jsonb(catalog_search_entries)-array['manual_overrides','updated_at','search_text','search_vector'] where verification='reviewed';
update public.set_carte_immagini set manual_overrides=jsonb_build_object('immagine',immagine,'immagine_hd',immagine_hd,'fonte',fonte,'verificata',verificata) where verificata;
update public.catalog_visual_links set manual_overrides=to_jsonb(catalog_visual_links)-'manual_overrides' where status in ('verified','rejected') or image_match_status='verified';

do $$
declare target text;
begin
 foreach target in array array['cards','catalog_search_entries','set_carte','set_carte_immagini','catalog_export_links','catalog_visual_links','catalog_visual_assets','set_espansioni','catalog_printing_inventory','catalog_code_reviews'] loop
  execute format('create trigger aaa_catalog_manual_capture before insert or update or delete on public.%I for each row execute function public.catalog_manual_capture()',target);
  execute format('create trigger zzzz_catalog_manual_enforce before insert or update on public.%I for each row execute function public.catalog_manual_enforce()',target);
 end loop;
end $$;
