-- Applicata al database del catalogo durante l'attivazione.
-- Conserva il comportamento del trigger e fissa il contesto di risoluzione dei nomi.
do $$
begin
  if to_regprocedure('public.update_updated_at()') is not null then
    alter function public.update_updated_at() set search_path = '';
  end if;
end $$;
