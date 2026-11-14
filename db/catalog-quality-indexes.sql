-- Compact partial indexes let live published counters avoid scanning wide card rows.
create index if not exists catalog_published_total on public.set_carte ((1)) where not eliminata;
create index if not exists catalog_published_tagged on public.set_carte ((1)) where not eliminata and cardinality(tag)>0;
create index if not exists catalog_published_missing on public.set_carte ((1)) where not eliminata and nullif(trim(immagine),'') is null;
create index if not exists catalog_published_verified on public.set_carte ((1)) where not eliminata and immagine_verificata and nullif(trim(immagine),'') is not null;
create index if not exists catalog_verified_image_identity on public.set_carte_immagini (immagine,sigla,numero,variante) where verificata and nullif(trim(immagine),'') is not null;
