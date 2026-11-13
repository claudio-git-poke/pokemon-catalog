# Fonti integrate e copertura — 13 novembre 2026

## Attive nel codice, dopo l'attivazione del progetto

| Fonte / connettore | Lingue e utilizzo | Limiti |
| --- | --- | --- |
| TCGdex | Importazione periodica e immagini in 11 lingue, compreso il coreano | Copertura molto diversa tra set/lingue; un set può avere un conteggio ma nessuna carta o immagine |
| TCGPlayer tramite ID TCGdex | Recupero delle immagini inglesi quando manca la scansione TCGdex | Solo ID prodotto univoci collegati al dettaglio carta; confidenza media sulle varianti |
| PokemonTCG/pokemon-tcg-data | Recupero alternativo di immagini inglesi tramite set e numero | Archivio storico, non una fonte di nuove uscite; il progetto originale dichiara la dismissione della propria API |
| Card Atlas → Pokémon Japan | Indicizzazione dei JSON giapponesi e URL delle immagini ufficiali pokemon-card.com | Dipende dall'aggiornamento dell'archivio esterno; le carte prive di numero sono conservate tramite ID ufficiale |
| Card Atlas → Pokémon Korea | Indicizzazione dei JSON coreani e URL ufficiali coreani; recupero dalla scheda ufficiale quando il vecchio CDN non risponde | Non scambiare i numeri con quelli della stampa giapponese; possibili URL non disponibili |
| Card Atlas → Pokémon Taiwan | Indicizzazione dei JSON in cinese tradizionale e URL ufficiali asia.pokemon-card.com | Cinese tradizionale, NON semplificato |

Card Atlas è l'archivio comunitario type-null/PTCG-database, non un'API ufficiale Pokémon né un servizio gestito da noi. I tre siti ufficiali sono gli originatori delle immagini; non vengono contati come tre ulteriori archivi indipendenti. Si leggono i JSON pubblici dell'archivio: non viene eseguita una scansione completa diretta dei tre siti ufficiali. Per la Corea, se il vecchio URL non funziona, viene riletta la pagina ufficiale esatta della carta e selezionata solo la sua immagine principale (feature_image), escludendo loghi e carte correlate. Solo JP, KO e TC vengono consumati da questo connettore; le copie TCGdex presenti nell'archivio per altre lingue non aggiungono una fonte indipendente.

Verifica live: un campione giapponese e uno di Taiwan hanno restituito immagini valide. Il campione coreano aveva un vecchio URL 404: dalla sua scheda ufficiale è stato recuperato il nuovo URL WebP.

Ogni immagine viene controllata prima di essere segnata trovata. Sono registrati fonte e pagina di provenienza. Se un provider ha un errore temporaneo, la ricerca continua sugli altri. Se nessuno risponde e ci sono errori, l'esito resta un errore da riprovare, non un'assenza definitiva. Gli abbinamenti ambigui rimangono da verificare.

L'indice delle alternative viene riempito dal worker in catalog_external_cards. Dopo averlo indicizzato, sia la ricerca manuale sia quella automatica possono usarlo. Non vengono scaricati o consegnati in questo ZIP interi archivi di scansioni.

## Individuate ma NON integrate né attivate

| Fonte | Potenziale interesse | Perché non è attiva |
| --- | --- | --- |
| PikaQian | Catalogo specifico cinese semplificato, metadati e URL delle immagini | Richiede una chiave API; condizioni di uso e piano da scegliere prima di un'integrazione |
| Master Setter | Coreano, cinese semplificato/tradizionale e varianti in più lingue | Chiave e piani a pagamento per copertura asiatica/immagini; nessun abbonamento creato |
| Scrydex | API mantenuta per carte, espansioni e immagini | Richiede account/credenziali e verifica della copertura utile |
| pokemontcgapi.com | Cataloghi internazionale, giapponese e cinese semplificato | Servizio distinto da pokemontcg.io; richiede chiave, non è stato testato con credenziali |
| tcg.mik.moe | Catalogo cinese semplificato | Accesso non verificabile in questa sessione (risposta 403 alla pagina); nessun connettore dichiarato funzionante |

Non si usano i risultati di Google/Bing o immagini commerciali generiche come prova di corrispondenza: nome uguale non significa stessa carta. Un eventuale motore di ricerca può aggiungere candidati da revisionare, non riempire automaticamente il catalogo con immagini non identificate.

## Riferimenti

- https://tcgdex.dev/status
- https://tcgdex.dev/faq
- https://github.com/type-null/PTCG-database
- https://github.com/PokemonTCG/pokemon-tcg-data
- https://www.pokemon-card.com/card-search/
- https://pokemoncard.co.kr/cards
- https://pikaqian.com/docs/
- https://api.master-setter.com/
- https://scrydex.com/docs
- https://pokemontcgapi.com/docs

I servizi opzionali sono elencati per pianificare la copertura, senza promesse di completezza o di costi nulli. Nessuna chiave è inclusa nel pacchetto.
