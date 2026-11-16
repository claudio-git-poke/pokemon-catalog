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

## Grafica condivisa tra lingue ed espansioni

La galleria usa ora un gruppo per ogni combinazione di SHA-256 immagine, categoria e ambito. La regola vale per l’intero archivio: i 657 riferimenti con regole di collegamento diventano 127 gruppi visivi nei dati iniziali. I riferimenti originali, le lingue, i codici delle espansioni e le decisioni manuali restano conservati. Un simbolo condiviso da più espansioni può quindi cercare in tutte quelle espansioni senza duplicare il disegno nella galleria.

I file identici sono raggruppati automaticamente anche nelle importazioni future. File diversi, seppure simili o con risoluzioni differenti, restano separati fino a verifica dell’equivalenza. Le immagini mancanti non vengono raggruppate tra loro. Categoria e ambito impediscono di fondere automaticamente Pocket, loghi di riferimento e simboli fisici.

API raggruppata: `GET /api/bindex/symbols?grouped=true`. Restituisce il contratto `bindex-visual-groups-v1`, con `group_key`, `languages`, `source_codes`, `member_asset_keys` e `reference_count`. `asset_key` rimane il riferimento rappresentativo, non la chiave del gruppo. Il cursore della lista usa la chiave del gruppo.

Ricerca del gruppo: `GET /api/bindex/symbols/{group_key}/cards?grouped=true`. Consulta le regole dei riferimenti del gruppo e restituisce ogni evidenza della carta una volta sola. `language=it` filtra le carte italiane; omettendolo si cercano tutte le lingue documentate dai riferimenti. Ogni carta mantiene lingua e identità proprie. `review=true` include le corrispondenze con lingua non confermata; il raggruppamento non verifica la grafica esatta o la posizione.

Un rifiuto manuale su un riferimento appartenente al gruppo esclude quell’evidenza dai risultati del gruppo: l’unione non deve riproporre una decisione rifiutata attraverso un duplicato identico. Le API senza `grouped=true` mantengono il comportamento per singolo riferimento. La migrazione additiva è `db/visual-symbol-groups.sql`.

I confronti dei prefissi degli identificativi TCGdex usano collazione binaria `C` e l’indice dedicato `cards_visual_uid_c`. La collazione predefinita del progetto ordinava `~` prima dei suffissi numerici: il precedente limite superiore poteva quindi escludere carte esistenti. Il limite ora usa il separatore successivo `.` e la stessa collazione dell’indice, sia nella ricerca raggruppata sia in quella per singolo riferimento.
