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

## Identificazione delle stampe — 14 novembre 2026

Il vocabolario `data/catalog-taxonomy.json` comprende tutti i valori di finitura,
pattern, sottotipo e timbro dell'interfaccia TCGdex verificata alla data indicata.
Snapshot: `scripts/sources/tcgdex-variant-types.d.ts`; rigenerazione:
`node scripts/update-variant-taxonomy.mjs`. Non è un elenco esaustivo di tutte le
stampe Pokémon mai prodotte. I nuovi valori osservati dal worker sono salvati nel
registro e diventano ricercabili senza modificare il parser del sito.

- Nessun prodotto cartesiano tra finiture, timbri e formati. I vecchi flag booleani
  documentano disponibilità separate, senza inventare combinazioni.
- Firme dei giocatori e timbri Worlds sono distinti: la famiglia WCD viene
  assegnata soltanto quando sono entrambi documentati sulla stessa variante.
- Le rarità sono metadati separati. Non provano texture, posizione dei simboli o
  copertura esatta della pellicola olografica.
- MFB: i 34 ID della fonte identificano carte di base, non numeri stampati.
  I bordi blu e i timbri di ciascuna variante rimangono separati. Le immagini
  legacy non vengono automaticamente certificate come immagini della variante.
- BA internazionale 2020/2022/2024: `data/catalog-decks.json` conserva le 360
  posizioni dei sei mazzi guidati e 54 righe dei tre mazzi avanzati. Una posizione
  è una stampa distinta anche quando riporta la stessa carta di un'altra posizione.
  Le Energie per cui non è identificata la stampa originale sono conservate nel
  manifest, ma non collegate arbitrariamente a un'Energia di un'altra espansione.
- Il manifest è verificato rispetto alle liste pubbliche Bulbapedia elencate in
  ogni record. I testi descrittivi non sono copiati. Le schede mancanti nel
  catalogo vengono collegate nelle sessioni successive del worker.
- BA asiatiche, Trainer Kit, PPS successive, WCD e altre distribuzioni non sono
  dichiarati completi: il worker conserva ciò che la fonte documenta e la pagina
  `/varianti` espone i conteggi effettivi. Un termine a zero non è una stampa censita.

Installazione additiva dopo l'indice iniziale: `db/catalog-taxonomy-expanded.sql`,
`db/catalog-deck-mappings.sql`, `db/catalog-variant-coverage.sql`.

### World Championships Decks

`data/catalog-world-decks.json` conserva 1.944 collegamenti a carte numerate nelle
liste degli 80 mazzi pubblicati per le edizioni 2004–2019 e 2022–2025. La fonte di
ciascuna lista è riportata nel record; non vengono inventate edizioni per il 2020
e 2021. Le Energie senza un'identità originale precisa non sono incluse nei
collegamenti. Il denominatore delle espansioni ordinarie deriva dal conteggio
ufficiale dichiarato dall'indice TCGdex; le carte promo restano senza denominatore.
L'anno è quello dell'edizione dei campionati, non necessariamente l'anno di messa
in vendita del prodotto. Foto, texture e finitura non sono dedotte dalla lista.
Installazione iniziale: `db/catalog-world-decks.sql`; collegamento incrementale
nelle sessioni del worker tramite `syncDeckMappings`.
