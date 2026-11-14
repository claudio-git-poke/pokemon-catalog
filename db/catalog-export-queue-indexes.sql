-- Match the worker's ordered cursor before loading the large source payloads.
create index if not exists catalog_entry_export_cursor on public.catalog_search_entries(updated_at,entry_key) where verification<>'catalog';
create index if not exists catalog_pending_due on public.catalog_export_pending(next_attempt_at,entry_key);
