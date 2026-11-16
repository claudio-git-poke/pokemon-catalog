# Copertura dei simboli e metadati generici

La riga `card:<id>` rimane un ripiego quando nessuna stampa della stessa carta corrisponde ai riferimenti richiesti e alla lingua selezionata. Quando una stampa corrisponde, il ripiego viene escluso prima della paginazione. Le stampe distinte rimangono distinte. Un rifiuto manuale non fa riapparire la carta attraverso il ripiego generico; i gruppi rispettano i rifiuti di ogni membro.

Le risposte TCGdex con identità confermata aggiornano anche la rarità della riga generica, indipendentemente dalla presenza di varianti. La riga conserva `verification='catalog'` e documenta che i dati sono metadati della carta: non dichiara una finitura o un’immagine esatta della stampa. La rarità originale e il relativo tag rimangono disponibili; i nomi tradotti ricevono anche il codice inglese equivalente documentato nei dizionari TCGdex. Le sigle e le rarità mancanti non vengono dedotte da altre lingue.

`catalog_backfill_generic_rarity` riusa soltanto evidenze della stessa carta, dello stesso identificativo TCGdex e della stessa lingua. Procede in lotti limitati, salta i payload protetti manualmente e conserva la precedenza dei tag manuali, compresi gli array vuoti. Il trigger di reindicizzazione mantiene la rarità già documentata. Il workflow `card-metadata-repair.yml` recupera le evidenze esistenti e dà precedenza alle carte SV02 inglesi e italiane della segnalazione; il worker generale continua il resto del catalogo.

L’indice `catalog_entry_set_lookup` supporta sia `set_code = ...` sia il prefisso `set_code LIKE ...`. L’ordinamento sulle immagini del join rimane disponibile senza cambiare colonne o richieste dei client.

SQL Editor, nell’ordine: `db/visual-symbol-links-repair.sql`, poi `db/visual-card-fallback.sql`. Entrambi sono additivi e ripetibili. I permessi anon restano di sola lettura; il recupero in scrittura richiede il ruolo del worker.
