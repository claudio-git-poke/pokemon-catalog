-- Temporary outages must not postpone a first import for a whole day.
alter table public.catalog_sync_sets add column sync_failures integer not null default 0 check(sync_failures>=0);
-- Existing errors prove at least one failure. Stagger their next attempt; keep earlier work due.
update public.catalog_sync_sets set sync_failures=1,
 next_sync_at=least(next_sync_at,clock_timestamp()+make_interval(mins=>15+mod(length(source_uid),5)))
where provider='tcgdex' and last_error ~* '(HTTP (429|500|502|503|504)|timeout|timed out|fetch failed|ECONN|ENOTFOUND)';
create function public.catalog_schedule_source_retry() returns trigger
language plpgsql security invoker set search_path='' as $$
declare base integer; attempts integer; delay_minutes integer;
begin
 if new.last_error is null then new.sync_failures:=0;return new;end if;
 if new.provider<>'tcgdex' then return new;end if;
 if tg_op='UPDATE' then
  if new.next_sync_at is not distinct from old.next_sync_at then return new;end if;
  attempts:=old.sync_failures+1;
 else attempts:=1;
 end if;
 if new.last_error ~* '(HTTP (429|500|502|503|504)|timeout|timed out|fetch failed|ECONN|ENOTFOUND)' then
  base:=case when new.last_error ~ 'HTTP 429' then 60 else 15 end;
  delay_minutes:=least(360,(base*power(2,least(attempts-1,5)))::integer+mod(length(new.source_uid),5));
  new.sync_failures:=attempts;
  new.next_sync_at:=clock_timestamp()+make_interval(mins=>delay_minutes);
 end if;
 return new;
end $$;
create trigger catalog_schedule_source_retry before insert or update on public.catalog_sync_sets
for each row execute function public.catalog_schedule_source_retry();
revoke all on function public.catalog_schedule_source_retry() from public,anon,authenticated;
grant execute on function public.catalog_schedule_source_retry() to service_role;
