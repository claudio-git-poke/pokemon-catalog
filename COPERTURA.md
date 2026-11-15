# Registro della copertura

La pagina `/copertura` contiene un registro filtrabile per stato, lingua/regione, fonte e nome dell'espansione o della distribuzione. Legge `catalog_coverage_report`, basato solo sui metadati delle fonti, senza aggregare l'intera tabella delle carte. Aggiornamento ogni minuto quando visibile, richieste annullate al cambio filtro, pagine di 25 voci.

## Percorsi linguistici

`src/lib/catalog-languages.ts` definisce 16 percorsi linguistici/regionali, condivisi da importatore, ricerca immagini e filtri di identificazione. Sono inclusi cinese semplificato, olandese, polacco, russo e spagnolo latinoamericano. Quest'ultimo usa `ES-LA` e non viene assimilato automaticamente allo spagnolo europeo o alle identità pubblicate di Bindex. La fonte inglese conserva il codice storico `INT`.

I cinque elenchi aggiunti sono stati interrogati il 15 novembre 2026: rispettivamente 57, 3, 2, 9 e 12 espansioni dichiarate, non ancora una prova delle carte o di tutte le varianti contenute. Gli elenchi vengono scoperti nel normale worker aggiornato, con le stesse quote e pause delle altre fonti. Non serve una nuova chiave. Una sessione GitHub già in corso mantiene il proprio checkout; la configurazione nuova entra in uso dalla sessione successiva.

`catalog_language_sources` registra fonte, regione, disponibilità e data del controllo. Il trigger sull'indice delle espansioni aggiorna automaticamente questa disponibilità. Un'assenza di dati o un errore della fonte non diventa una conferma di inesistenza delle carte.

## Stati e prove

- **Non coperto**: il percorso non ha un elenco utilizzabile verificato all'ultimo controllo.
- **Da importare**: prima importazione non completata o elenco disponibile ancora da scoprire.
- **Da verificare**: importazione precedente senza prove del confronto, errore, ambiguità, quantità discordanti o confronto più vecchio di otto giorni.
- **Allineato alla fonte**: elenco fisico verificato recentemente, quantità coerenti e stessi identificativi attesi/risolti nella singola fonte.
- **Fuori ambito**: TCG Pocket identificato esplicitamente come digitale; non confluisce nel catalogo fisico.

Il worker calcola una firma degli identificativi dell'elenco e una firma di quelli effettivamente risolti. La stessa quantità con identificativi differenti non basta. Duplicati nell'elenco fanno divergere il conteggio e richiedono verifica. Non vengono salvati grandi elenchi duplicati nel database: solo conteggi e firme. Le importazioni storiche non vengono retroattivamente certificate; verranno controllate alle successive scansioni.

Le voci delle distribuzioni note in `catalog_releases` compaiono con lingua e quantità da verificare. Il registro distingue il numero di espansioni di un percorso linguistico dal numero di carte di una singola espansione. I totali del registro contano voci, non carte uniche.

**Nessuna voce certifica tutte le varianti fisiche mondiali.** `variants_status` rimane `unverified`. Il confronto di elenchi della stessa fonte è il primo controllo; confronti fra fonti indipendenti, distribuzioni mancanti e prove delle singole varianti richiedono ulteriori verifiche. Le fonti conosciute non sono automaticamente un inventario esaustivo delle uscite esistenti.

## Database e permessi

Applicare `db/catalog-coverage-register.sql` dopo lo schema di automazione e identificazione, quindi `db/catalog-coverage-photo-languages.sql` dopo il contratto Bindex. Tabelle con RLS: lettura anonima, scrittura del worker. Vista e RPC SECURITY INVOKER. Nessuna chiave Bindex `(sigla,numero,variante)` viene modificata. I percorsi regionali senza corrispondenza certa restano fuori dalla pubblicazione canonica.

Il riepilogo generale preesistente legge ora `catalog_quality_cache`, aggiornato dal worker dopo ogni ciclo. La lettura pubblica non riesegue la query generale e conserva l’ultima rilevazione se un aggiornamento fallisce. La data del report indica la sua età. Applicare `db/catalog-quality-cache.sql` dopo la funzione del riepilogo e il segnale Realtime. Questa copia contiene statistiche del catalogo esplicitamente pubblico; non è destinata a dati privati o a statistiche per utente.
