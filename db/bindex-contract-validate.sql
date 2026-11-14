-- After bindex-contract.sql, repeat select public.bindex_repair_urls(3000)
-- until it returns zero. Then validate the strict URL constraint.
alter table public.set_carte validate constraint set_carte_cardmarket_url_check;
