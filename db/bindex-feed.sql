-- Read-only incremental feed with a fixed cutoff and a full composite cursor.
-- Never advance a consumer checkpoint until every page of the window is stored.
create function public.bindex_export_page(kind text default 'cards',after_time timestamptz default '1970-01-01',after_key jsonb default '[]',until_time timestamptz default null,page_size integer default 1000) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare cap integer:=least(greatest(coalesce(page_size,1000),1),1000); cutoff timestamptz:=least(coalesce(until_time,statement_timestamp()-interval '1 minute'),statement_timestamp()-interval '1 minute'); result jsonb;
begin
 if kind not in ('cards','sets','photos') or kind is null then raise exception 'Tipo di esportazione non valido';end if;
 if after_key is null or jsonb_typeof(after_key)<>'array' then raise exception 'Cursore non valido';end if;
 if jsonb_array_length(after_key) not in (0,case kind when 'cards' then 3 when 'sets' then 1 else 4 end) then raise exception 'Chiave del cursore incompleta';end if;
 if after_time is null then raise exception 'Timestamp del cursore mancante';end if;
 if kind='cards' then
  with page as materialized (
   select sigla,numero,variante,nome,rarita,codice,cardmarket_id,cardmarket_url,immagine,immagine_hd,tag,aggiornato_il,eliminata,jsonb_build_array(sigla,numero,variante) __key from public.set_carte
   where (aggiornato_il>after_time or (aggiornato_il=after_time and (sigla,numero,variante)>(coalesce(after_key->>0,''),coalesce((after_key->>1)::integer,0),coalesce(after_key->>2,'')))) and aggiornato_il<=cutoff
   order by aggiornato_il,sigla,numero,variante limit cap
  ) select jsonb_build_object('contract','bindex-v1','kind',kind,'until',cutoff,'items',coalesce((select jsonb_agg(to_jsonb(p)-'__key' order by aggiornato_il,sigla,numero,variante) from page p),'[]'::jsonb),
   'next_cursor',(select jsonb_build_object('time',aggiornato_il,'key',__key) from page order by aggiornato_il desc,sigla desc,numero desc,variante desc limit 1),
   'complete',(select count(*)<cap from page)) into result;
 end if;
 if kind='sets' then
  with page as materialized (
   select sigla,tcgdex_id,nome,carte_base,carte_totali,data_uscita,lingua,aggiornato_il,jsonb_build_array(sigla) __key from public.set_espansioni
   where (aggiornato_il>after_time or (aggiornato_il=after_time and sigla>coalesce(after_key->>0,''))) and aggiornato_il<=cutoff
   order by aggiornato_il,sigla limit cap
  ) select jsonb_build_object('contract','bindex-v1','kind',kind,'until',cutoff,'items',coalesce((select jsonb_agg(to_jsonb(p)-'__key' order by aggiornato_il,sigla) from page p),'[]'::jsonb),
   'next_cursor',(select jsonb_build_object('time',aggiornato_il,'key',__key) from page order by aggiornato_il desc,sigla desc limit 1),
   'complete',(select count(*)<cap from page)) into result;
 end if;
 if kind='photos' then
  with page as materialized (
   select sigla,numero,variante,lingua,immagine,immagine_hd,fonte,aggiornato_il,jsonb_build_array(sigla,numero,variante,lingua) __key from public.set_carte_immagini
   where (aggiornato_il>after_time or (aggiornato_il=after_time and (sigla,numero,variante,lingua)>(coalesce(after_key->>0,''),coalesce((after_key->>1)::integer,0),coalesce(after_key->>2,''),coalesce(after_key->>3,'')))) and aggiornato_il<=cutoff
   order by aggiornato_il,sigla,numero,variante,lingua limit cap
  ) select jsonb_build_object('contract','bindex-v1','kind',kind,'until',cutoff,'items',coalesce((select jsonb_agg(to_jsonb(p)-'__key' order by aggiornato_il,sigla,numero,variante,lingua) from page p),'[]'::jsonb),
   'next_cursor',(select jsonb_build_object('time',aggiornato_il,'key',__key) from page order by aggiornato_il desc,sigla desc,numero desc,variante desc,lingua desc limit 1),
   'complete',(select count(*)<cap from page)) into result;
 end if;
 return result;
end $$;
revoke all on function public.bindex_export_page(text,timestamptz,jsonb,timestamptz,integer) from public;
grant execute on function public.bindex_export_page(text,timestamptz,jsonb,timestamptz,integer) to anon,authenticated,service_role;
