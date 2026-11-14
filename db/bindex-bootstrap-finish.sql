-- Run only after all pages from the verified 2026-11-14 bootstrap have succeeded.
-- This transaction refuses to mark a partial or renumbered snapshot as ready.
do $$
declare digest text;
begin
 if (select count(*) from public.set_espansioni)<>294 or (select count(*) from public.set_carte)<>47373 then raise exception 'Bootstrap incompleto';end if;
 select md5(string_agg(sigla||'|'||numero||'|'||variante,E'\n' order by sigla collate "C",numero,variante collate "C")) into digest from public.set_carte;
 if digest<>'56d0c0e6d35476aaca2778b14b0394e0' then raise exception 'Le identità non coincidono con il riferimento Bindex';end if;
end $$;
insert into public.set_carte_immagini(sigla,numero,variante,lingua,immagine,immagine_hd,fonte,verificata)
select c.sigla,c.numero,c.variante,
 case when c.immagine like '%tcgdex.net/it/%' then 'IT' when c.immagine like '%tcgdex.net/fr/%' then 'FR' when c.immagine like '%tcgdex.net/de/%' then 'DE' when c.immagine like '%tcgdex.net/es/%' then 'ES' else s.lingua end,
 c.immagine,c.immagine_hd,'Bindex: riferimento iniziale, immagine non ricontrollata',false
from public.set_carte c join public.set_espansioni s using(sigla) where c.immagine is not null
on conflict(sigla,numero,variante,lingua) do nothing;
insert into public.catalog_export_links(entry_key,sigla,numero,variante,method,evidence)
select 'card:'||c.id,r.sigla,r.numero,r.variante,'bootstrap_verified_page',jsonb_build_object('page',r.cardmarket_url)
from public.cards c join public.set_carte r on r.cardmarket_url=c.link_cardmarket
where not exists(select 1 from public.set_carte other where other.cardmarket_url=r.cardmarket_url and (other.sigla,other.numero,other.variante)<>(r.sigla,r.numero,r.variante))
 and exists(select 1 from public.catalog_search_entries e where e.entry_key='card:'||c.id)
on conflict(entry_key) do nothing;
-- Mark known product-ID reuse in the existing MFB metadata before the new publisher examines it.
with product_counts as(
 select source_payload->>'id' source_id,source_payload->'variant'->'thirdParty'->>'cardmarket' cm,
 count(distinct coalesce(source_payload->'variant'->>'variantId',(source_payload->'variant')::text)) n
 from public.catalog_search_entries where 'family:my-first-battle'=any(tags) and source_payload ? 'variant'
 group by 1,2
)
update public.catalog_search_entries e set source_payload=e.source_payload||jsonb_build_object('product_variant_count',p.n,'has_normal_variant',true)
from product_counts p where 'family:my-first-battle'=any(e.tags) and e.source_payload->>'id'=p.source_id
 and e.source_payload->'variant'->'thirdParty'->>'cardmarket'=p.cm;
update public.catalog_export_state set ready=true,bootstrapped_at=clock_timestamp(),statistics=jsonb_build_object(
 'reference_source','https://bindexxx.github.io/bindex/','reference_date','2026-11-14','canonical_key_md5','56d0c0e6d35476aaca2778b14b0394e0',
 'codes_missing',(select count(*) from public.set_carte where codice is null),'legacy_photos',(select count(*) from public.set_carte_immagini),
 'linked_entries',(select count(*) from public.catalog_export_links)
) where id='bindex';
