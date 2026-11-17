# Confezioni e distribuzioni

Il documento originale contiene 494 **segnalazioni**, con 55 riferimenti bibliografici: A=36, B=371, C=87. Il livello è dichiarato dall’autore del documento e non costituisce una revisione indipendente. Tutte le voci entrano con `review_status='pending'`. Le 172 voci S4 descrivono contenuti di mazzi prerelease, mentre S3 può indicare un insieme di carte ottenibili da mini-pack casuali.

Il TXT è conservato integralmente. La sua impronta SHA-256 identifica la versione del documento; ogni chiave di voce include la versione e il progressivo originale. Le ripetizioni della stessa carta in distribuzioni diverse restano voci distinte. `source_refs` conserva codice Fxx, titolo e URL; `source_row` conserva la riga prima delle normalizzazioni. Lingue miste o “Internazionale” restano `und`; EN diventa INT, KO diventa KOR e ZH-TW/ZH-CN diventano CHN-T/CHN.

## Attivazione

1. Applicare `db/packaging-catalog.sql` dopo le migrazioni del catalogo, delle protezioni manuali e della cronologia.
2. Applicare `db/packaging-catalog-seed.sql` oppure eseguire il workflow **Archivio confezioni delle carte** con le chiavi già configurate. Il workflow importa anche i collegamenti candidati e li aggiorna giornalmente quando arrivano nuove carte.
3. Aprire `/confezioni`. Le schede delle carte mostrano le distribuzioni collegate.

`node --experimental-strip-types scripts/prepare-packaging-catalog.mjs` rigenera il manifest e il seed SQL dal TXT. Le migrazioni e gli import sono ripetibili e non scrivono su `cards`, `catalog_search_entries`, inventario delle stampe o collegamenti dei simboli.

## Collegamenti e revisioni

Il matcher richiede una serie promozionale esplicita, il numero esatto (con eventuale suffisso) e la lingua della carta. Un numero come `025/165` senza identificativo dell’espansione resta da risolvere. Anche una corrispondenza unica produce soltanto `status='candidate'` e `entry_key=null`: prova l’accordo degli identificativi dichiarati, non la finitura, il timbro o l’autenticità dell’involucro. Eventuali corrispondenze multiple sono conservate come candidate.

Per verificare una confezione, aggiornare nel SQL Editor `review_status`, `review_source_url`, `reviewed_at`, `review_note` e il tipo specifico; sono disponibili anche `wrapper_front_url` e `wrapper_back_url`. La conferma richiede una fonte HTTPS e un solo tipo di confezione. Una stampa si collega come confermata solo dopo aver verificato la confezione, scegliendo una `entry_key` della stessa carta e fornendo `evidence_url`. Le schede generiche, le identità in revisione e i record di soli metadati non sono stampe confermabili.

Le modifiche dirette nel SQL Editor sono manuali: i valori corretti, compresi quelli vuoti, sono protetti dai trigger già usati dal catalogo. La cronologia registra le correzioni delle tre nuove tabelle. I rifiuti sui collegamenti e sulle voci sono esclusi dalle relazioni pubbliche; l’import automatico conserva i rifiuti e non sovrascrive revisioni o foto. Le tre tabelle sono leggibili via chiave anon, con scrittura riservata al servizio e al SQL Editor.

Tabelle: `catalog_packaging_documents`, `catalog_packaging_candidates`, `catalog_packaging_links`. Nessun timbro, rarità o tag `sealed` viene dedotto automaticamente sulle stampe esistenti.
