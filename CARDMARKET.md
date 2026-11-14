# Collegamenti Cardmarket

Il campo `set_carte.cardmarket_url` contiene la pagina esistente, oppure il redirect ufficiale `https://www.cardmarket.com/it/Pokemon/Products?idProduct=<ID>`. Non è una ricerca per nome. Gli URL esistenti vengono conservati, anche quando un worker ha una copia precedente del catalogo.

Le singole voci in `catalog_search_entries` espongono `cardmarket_id`, `cardmarket_url`, `cardmarket_method` e `cardmarket_status` (`linked`, `pending`, `conflict`). Gli ID provengono dai metadati espliciti della variante oppure da `catalog_export_links`, che contiene le identità pubblicate già risolte. Due ID discordanti sospendono il collegamento. Un prodotto Cardmarket può raggruppare più finiture: un link non certifica che tutte le caratteristiche fisiche siano distinte sul marketplace.

I trigger completano i link quando arrivano nuovi ID o vengono risolte nuove associazioni. Ogni ciclo di `run-catalog-sync.mjs` richiama anche `catalog_link_cardmarket(1000)`, che recupera dati precedenti in lotti, senza interrompere le importazioni se il recupero fallisce. La funzione è riservata al worker e registra i conteggi nel log. L'esecuzione ripetuta non duplica i collegamenti.

La scheda generale `cards.link_cardmarket` viene completata soltanto quando tutte le sue stampe documentate hanno lo stesso ID prodotto. Negli altri casi i link restano sulle singole stampe, visibili nel selettore “Stampe, differenze e fonti”. I link generali già presenti vengono conservati.

Le voci senza ID o associazione documentata rimangono in attesa. Le normali sincronizzazioni dei metadati possono completarle quando le fonti aggiungono queste informazioni. Non vengono inventati slug dal nome della carta e non è garantito che ogni variante abbia un prodotto Cardmarket dedicato.

Schema: `db/catalog-cardmarket.sql` (applicato dopo `db/bindex-export.sql`). Nessuna nuova chiave richiesta.

Riferimento ufficiale: https://insight.cardmarket.com/en/Articles/scryfall-x-cardmarket
