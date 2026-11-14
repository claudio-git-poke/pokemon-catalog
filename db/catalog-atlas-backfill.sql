-- Requeue only rows deferred by the former unsupported-provider branch.
-- Other retries and all completed metadata checks retain their scheduling.
update public.cards set traits_next_attempt_at=now(),traits_last_error=null
where source_uid like 'atlas:%' and traits_checked_at is null
and traits_last_error='Metadati dettagliati non disponibili per questa fonte.';
