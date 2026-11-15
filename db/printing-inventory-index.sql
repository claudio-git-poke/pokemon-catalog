-- Avoid scanning every generic card: only source evidence participates in this seed.
create index if not exists catalog_entry_inventory_seed on public.catalog_search_entries(entry_key) where verification<>'catalog';
