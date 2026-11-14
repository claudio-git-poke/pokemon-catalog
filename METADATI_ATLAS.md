# Metadati delle carte regionali

Il workflow **Metadati carte asiatiche** legge i JSON regionali di Card Atlas (type-null/PTCG-database), che rimandano ai cataloghi ufficiali giapponese, coreano e di Taiwan. Il recupero riguarda le carte già importate con identità `atlas:*`; include anche quelle importate in futuro. Lavoro massimo di 40 minuti, avvio ogni ora al minuto 43, ripresa dai controlli non completati.

Il worker verifica identificativo originale, fonte primaria Atlas, lingua, set e numero prima di aggiungere una voce `atlas-metadata:<card_id>` a `catalog_search_entries`. Sono indicizzati rarità, tipo, categoria della carta, lettera di regolamento, numero e denominatore quando espliciti. I suffissi ex, EX, GX, V, VMAX, VSTAR e LV.X vengono riconosciuti solo se presenti letteralmente alla fine del nome della fonte.

La rarità non implica una finitura. Nessun tag holo, reverse, Cosmos, Master Ball, rilievo o stampino viene dedotto. Le immagini restano riferimenti non certificati della variante; l'entry non assegna `image_url`. Il payload dichiara `metadata_scope: card-metadata-only` e il risultato di ricerca indica che finiture e stampini restano da verificare.

Le scritture avvengono prima nell'indice, poi si marca la carta come controllata. Gli stessi identificativi producono la stessa chiave, senza duplicati. Errori di identità o file mancanti sono riprovati dopo un giorno. Non si cambiano identità, numeri, codici, fonti primarie o immagini manuali delle carte. Non si pubblicano nuove identità asiatiche in Bindex senza le verifiche già previste.

`db/catalog-atlas-backfill.sql` riattiva soltanto le carte precedentemente rinviate perché il vecchio arricchimento non supportava Atlas. La dashboard include ora Atlas fra le fonti con controllo disponibile; “con tag” può significare soli metadati della carta, non tutte le varianti note.
