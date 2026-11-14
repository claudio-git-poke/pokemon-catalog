# Copertura e controlli di coerenza

La pagina `/copertura`, nel menu principale, usa `catalog_quality_report()` in sola lettura e con i permessi del chiamante. La migrazione è in `db/catalog-quality.sql`. L'aggiornamento è manuale per non rieseguire continuamente l'aggregazione durante il recupero dei tag.

Le statistiche delle importazioni si possono filtrare per fonte, lingua ed espansione. Una riga importata non equivale a una carta unica nel mondo: fonti e lingue diverse possono rappresentare la stessa carta.

Stati mutuamente esclusivi dei metadati:

- **Con tag di fonte**: almeno una stampa non generica con tag. Non certifica che tutte le sue varianti siano documentate.
- **Controllata, dati insufficienti**: controllo completato ma nessuna stampa con tag disponibile.
- **Fonte senza controllo disponibile**: nessun tag documentato e nessun identificativo utilizzabile dai controlli TCGdex o Atlas.
- **Da riprovare**: identificativo supportato, nessun controllo completato e ultimo tentativo in errore.
- **Da controllare**: altre carte con identificativo TCGdex o Atlas ancora da esaminare. Atlas recupera i metadati della carta; non certifica finiture o stampini.

I contatori “senza URL” e “placeholder” descrivono aspetti diversi e possono sovrapporsi. Nessuno dei due equivale a una verifica visiva dell'immagine. Le statistiche Bindex sono separate e globali: includono esclusivamente le identità canoniche pubblicate.

I controlli automatici confrontano finiture incompatibili nella stessa stampa, identificativi della fonte discordanti e numeri originali non coerenti con l'indice. Contano inoltre gli URL di immagini dichiarate verificate condivisi fra più identità: si tratta di un avviso da approfondire, non di una prova di errore. Le varianti normale e holo in righe distinte sono legittime. Il sistema non modifica automaticamente i dati segnalati. Nessuna segnalazione non significa catalogo integralmente certificato.

Test: `node --experimental-strip-types --test tests/catalog-quality.test.mjs`. Include separazione degli stati, finiture su righe distinte, conflitto sulla stessa stampa e rispetto di RLS per il ruolo anonimo.
