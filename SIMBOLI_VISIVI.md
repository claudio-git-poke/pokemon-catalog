# Simboli e collegamenti visivi per Bindex

Archivio fornito: Pokémon TCG Archivio v8, inventario generato il 15 novembre 2026. Contiene 5.630 riferimenti, 3.117 file immagine e 2.321 hash distinti. I soli timbri isolati disponibili dichiarati nell’archivio sono Prima Edizione EN e Trick or Trade. Il programma originale non è stato eseguito; lo ZIP è stato letto come dati e i file sono stati confrontati con gli hash del suo inventario.

`/simboli` offre la selezione visiva e le carte collegate. La ricerca da foto caricata non è implementata: richiederà un successivo motore di confronto e un insieme di esempi verificati.

## Dati e qualità

- `catalog_visual_assets`: un riferimento per fonte, categoria, identificativo, lingua e percorso originale; hash immagine per riconoscere i contenuti condivisi. Conserva anche riferimenti senza file o senza URL utilizzabile, con stato esplicito. I due timbri originali sono serviti dal sito; gli altri riferimenti utilizzano URL della fonte quando disponibili. Nessun file immagine viene inserito nel database Postgres.
- `catalog_visual_links`: relazioni molti-a-molti a una specifica `catalog_search_entries.entry_key`, con fonte, stato, conferma della grafica esatta e posizione opzionale. Scrittura soltanto dal server; lettura pubblica con RLS. I collegamenti rifiutati prevalgono sulle regole automatiche.
- `catalog_visual_cards`: legge i tag documentati o l’identità originale TCGdex di una carta. Le 657 regole iniziali comprendono due timbri e 655 riferimenti ai simboli di espansione TCGdex disponibili con URL universale. Per i timbri la fonte documenta il simbolo; per le espansioni resta una corrispondenza candidata. L’automatismo non certifica mai la grafica esatta né la posizione.

Pocket è riconosciuto anche negli URL TCGdex contenenti `/tcgp/`, non soltanto dalle cartelle del pacchetto. Loghi di negozi, loghi commerciali delle espansioni e materiale giapponese non sufficientemente classificato restano riferimenti. Il fallback “base1_symbol” non viene collegato come prova di simbolo stampato. Non viene inventata una lingua a partire da un dato INT; le emissioni con lingua non documentata richiedono l’opzione di revisione.

I collegamenti automatici sono calcolati al momento della lettura: valgono anche per carte e versioni importate successivamente, senza un backfill che aggiorni tutte le righe delle carte. L’importatore evita riscritture invariate. Se cambia l’hash di un’immagine, la conferma della grafica sui collegamenti manuali viene riportata a candidata.

## API pubblica

- `GET /api/bindex/symbols?kind=promo_stamp&language=en&limit=48`: riferimenti con regole di collegamento. `all=true` include anche immagini mancanti, loghi e riferimenti non collegati. La paginazione usa `after=next_key`.
- `GET /api/bindex/symbols/{asset_key}/cards?limit=24`: evidenze della carta/versione collegate. `review=true` include lingue non confermate rispetto al riferimento. Paginazione con `after=next_key`.

Contratto `bindex-visual-v1`. Nei risultati `entry_key` identifica l’evidenza precisa; `canonical_sigla`, `canonical_numero`, `canonical_variante` e `canonical_mapping_status`, quando disponibili, permettono il collegamento al contratto Bindex senza sostituirne la chiave immutabile. `actual_language=und` significa non documentata; `position=null` significa sconosciuta, non assente. `reference_image_url` è la foto di riferimento della carta.

Migrazione: `db/visual-symbols.sql`. Popolamento: workflow `Registro simboli visivi`, con i secrets Supabase già esistenti. I file JSON derivati sono in `data/visual-archive`; `scripts/prepare-visual-archive.py` prepara un nuovo inventario da un archivio locale, verificando hash e percorsi. Lo ZIP originale rimane intatto.
