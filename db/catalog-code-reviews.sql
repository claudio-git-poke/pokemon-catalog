create table public.catalog_code_reviews(
 sigla text not null,numero integer not null,variante text not null,cardmarket_id bigint,
 status text not null check(status in ('verified','no_code_in_source','pending')),proposed_code text,
 source_urls text[] not null,method text not null,note text not null,cardmarket_access text not null,
 aggiornato_il timestamptz not null default clock_timestamp(),primary key(sigla,numero,variante),
 foreign key(sigla,numero,variante) references public.set_carte(sigla,numero,variante),
 check((status='verified' and proposed_code is not null and proposed_code~'^[A-Z0-9][A-Z0-9.-]*( [A-Z0-9]+)?$') or (status<>'verified' and proposed_code is null))
);
alter table public.catalog_code_reviews enable row level security;
revoke all on public.catalog_code_reviews from public,anon,authenticated;
grant select on public.catalog_code_reviews to anon,authenticated;
grant all on public.catalog_code_reviews to service_role;
create policy code_reviews_read on public.catalog_code_reviews for select to anon,authenticated using(true);
create policy code_reviews_worker on public.catalog_code_reviews for all to service_role using(true) with check(true);
-- A worker may still have a reference cache from before a code was verified.
create function public.bindex_guard_reviewed_code() returns trigger language plpgsql security invoker set search_path='' as $$
declare reviewed text;
begin
 select r.proposed_code into reviewed from public.catalog_code_reviews r where (r.sigla,r.numero,r.variante)=(old.sigla,old.numero,old.variante) and r.status='verified';
 new.codice:=coalesce(reviewed,new.codice,old.codice);
 return new;
end $$;
create trigger bindex_code_review_guard before update on public.set_carte for each row execute function public.bindex_guard_reviewed_code();
revoke all on function public.bindex_guard_reviewed_code() from public,anon,authenticated;
grant execute on function public.bindex_guard_reviewed_code() to service_role;
-- Preserve bootstrap and review statistics when a worker records its incremental cursor.
create function public.catalog_export_progress(cursor_time_new timestamptz,cursor_key_new text,counts jsonb) returns void language sql security invoker set search_path='' as $$
 update public.catalog_export_state s set
 cursor_time=case when s.cursor_time is null or (cursor_time_new,cursor_key_new)>(s.cursor_time,s.cursor_key) then cursor_time_new else s.cursor_time end,
 cursor_key=case when s.cursor_time is null or (cursor_time_new,cursor_key_new)>(s.cursor_time,s.cursor_key) then cursor_key_new else s.cursor_key end,
 refreshed_at=clock_timestamp(),statistics=s.statistics||counts where id='bindex'
$$;
revoke all on function public.catalog_export_progress(timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.catalog_export_progress(timestamptz,text,jsonb) to service_role;
-- Also protect statistics from already-running workers that predate the progress RPC.
create function public.catalog_export_keep_statistics() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 new.statistics:=old.statistics||new.statistics;
 return new;
end $$;
create trigger catalog_export_keep_statistics before update on public.catalog_export_state for each row execute function public.catalog_export_keep_statistics();
revoke all on function public.catalog_export_keep_statistics() from public,anon,authenticated;
grant execute on function public.catalog_export_keep_statistics() to service_role;
