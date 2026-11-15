-- Explicit photo language codes for the additional collection paths.
create or replace function public.bindex_publish_photo(set_code text,card_number integer,printing text,image_language text,image text,image_hd text,image_source text,image_verified boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
declare previous_url text; accepted_url text; accepted_hd text; accepted_verified boolean;
begin
 if image_language not in ('IT','EN','FR','DE','ES','PT','JP','KOR','CHN','CHN-T','TH','ID','NL','PL','RU','ES-LA') or image_language is null then raise exception 'Lingua della foto non documentata';end if;
 if image is null or image !~ '^https://' or nullif(trim(image_source),'') is null then raise exception 'Foto o fonte non valida';end if;
 select p.immagine into previous_url from public.set_carte_immagini p
 where (p.sigla,p.numero,p.variante,p.lingua)=(set_code,card_number,printing,image_language) for update;
 insert into public.set_carte_immagini(sigla,numero,variante,lingua,immagine,immagine_hd,fonte,verificata)
 values(set_code,card_number,printing,image_language,image,image_hd,image_source,coalesce(image_verified,false))
 on conflict(sigla,numero,variante,lingua) do update set immagine=excluded.immagine,immagine_hd=excluded.immagine_hd,fonte=excluded.fonte,verificata=excluded.verificata
 where not public.set_carte_immagini.verificata or excluded.verificata;
 select p.immagine,p.immagine_hd,p.verificata into accepted_url,accepted_hd,accepted_verified from public.set_carte_immagini p
 where (p.sigla,p.numero,p.variante,p.lingua)=(set_code,card_number,printing,image_language);
 update public.set_carte c set immagine=accepted_url,immagine_hd=accepted_hd,immagine_verificata=accepted_verified
 where (c.sigla,c.numero,c.variante)=(set_code,card_number,printing)
 and (nullif(trim(c.immagine),'') is null or c.immagine=previous_url
  or (image_language='IT' and (not c.immagine_verificata or accepted_verified)))
 -- Once an Italian photo is known, a different language cannot take over the main picture.
 and (image_language='IT' or not exists(select 1 from public.set_carte_immagini p where (p.sigla,p.numero,p.variante,p.lingua)=(set_code,card_number,printing,'IT') and p.immagine=c.immagine));
end $$;
revoke all on function public.bindex_publish_photo(text,integer,text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.bindex_publish_photo(text,integer,text,text,text,text,text,boolean) to service_role;

