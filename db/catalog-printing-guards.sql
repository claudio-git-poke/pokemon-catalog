-- Physical MFB cards do not carry collector numbers; upstream local IDs are catalog identities.
create or replace function public.catalog_guard_printing() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if lower(split_part(new.set_code,'@',1))='mfb' or 'family:my-first-battle'=any(new.tags) then
  new.collector_number:=null;new.denominator:=null;
 end if;
 return new;
end $$;
drop trigger if exists catalog_guard_printing on public.catalog_search_entries;
create trigger catalog_guard_printing before insert or update on public.catalog_search_entries for each row execute function public.catalog_guard_printing();
