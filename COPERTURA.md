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

## Confronto fra archivi

`db/catalog-cross-source.sql` aggiunge un registro diagnostico separato. Le coppie candidate hanno la stessa lingua e lo stesso codice di espansione in TCGdex e Card Atlas. Questo criterio non certifica l’identità delle distribuzioni né l’indipendenza dei dati originali: il registro espone sempre `independence_status=unestablished` e `variants_status=unverified`.

Il workflow dedicato confronta al massimo 60 coppie per sessione di 12 minuti, una alla volta, leggendo lo snapshot Atlas già importato (entro otto giorni, con conteggio coerente) e l’elenco attuale TCGdex. Confronta numero stampato e nome nella stessa lingua; conserva conteggi, impronte SHA-256 e fino a 20 esempi per categoria. Numeri ripetuti, mancanti, zero o nomi assenti producono ambiguità: non vengono accorpate automaticamente stampe diverse. Due elenchi vuoti non sono concordanza.

Il risultato può essere in attesa, concordante, differente, ambiguo o temporaneamente non disponibile. I tentativi falliti conservano l’ultima evidenza e riprovano dopo sei ore; le differenze dopo un giorno, gli altri confronti dopo sette giorni. Una voce presente solo in una fonte non prova che manchi nel nostro database. Questa diagnostica non modifica chiavi Bindex, immagini o carte: eventuali importazioni restano affidate alle normali code.

La sezione “Confronto fra fonti” in `/copertura` legge solo i risultati salvati, con pagine di 20 coppie e aggiornamento ogni minuto mentre la pagina è visibile. Le scritture e la selezione del lavoro sono riservate al servizio. La migrazione va applicata prima del nuovo worker.

Verifica reale del 15 novembre 2026: per S8a giapponese TCGdex restituisce zero voci; lo snapshot Atlas contiene 34 voci, di cui otto senza numero utilizzabile. Il risultato è ambiguo, senza dichiarare completa l’espansione o trattare le voci senza numero come carte equivalenti.

## Ripresa dei vecchi tag dopo timeout

Il recupero retroattivo usa una sola elaborazione per volta e pubblica i contatori durante il lotto. Un timeout o un errore transitorio del database sospende il lotto senza tentare subito una seconda scrittura sulla carta per annotare lo stesso errore. Il recupero successivo seleziona ancora le carte prive del checkpoint; gli upsert riusano le stesse chiavi delle stampe, anche se queste erano state salvate prima del timeout. Permessi o vincoli errati restano errori da correggere.

I log conservano in memoria i batch non confermati, ritentano una volta dopo 1,5 secondi gli errori transitori e riusano le stesse chiavi evento. Se fallisce anche il tentativo successivo, l’errore resta visibile: non viene dichiarato salvato ciò che il database non ha confermato. Un successivo flush nella stessa sessione può recuperare i batch trattenuti; la memoria non sopravvive alla chiusura del processo. L’output GitHub riceve comunque ogni messaggio prima del salvataggio.


## Sessioni autonome dei confronti

Il workflow `Confronto fonti catalogo` parte su modifica del suo codice, manualmente e ogni ora al minuto 37 (UTC). Ha una propria coda GitHub con una sola esecuzione attiva; non attende che la sessione di importazione di 330 minuti termini. Il processo principale non esegue più i confronti.

La sessione seleziona una coppia dovuta alla volta e si ferma dopo 60 coppie, a esaurimento coda, avvicinandosi al budget di 12 minuti oppure se la fonte risponde HTTP 429/503. Il limite GitHub è 18 minuti, comprendendo installazione e margine per richieste in corso. Ogni risultato viene salvato prima dell’avanzamento del contatore. Gli errori delle fonti restano nel registro con il proprio rinvio; un fallimento nel salvataggio interrompe la sessione con errore. Non vengono ripetuti i confronti non ancora scaduti.

L’automazione scrive il dettaglio di ciascun confronto nel normale registro in `/automazione`, con contatori di concordanze, differenze, ambiguità ed errori. La frequenza del workflow indica quando viene controllata la coda, non forza una nuova scansione oraria di tutte le fonti.


Il conteggio globale dei vecchi tag è una rilevazione facoltativa effettuata solo all’avvio, con data propria (`initial_pending`, `initial_pending_at`). Un suo errore viene segnalato senza interrompere l’elaborazione. Non viene più ricalcolato dopo ogni minuto di lavoro e non viene presentato come totale residuo corrente: le nuove importazioni possono aggiungere altre carte. I contatori `checked` e `indexed` misurano invece i risultati confermati della sessione.

## Differenze fra fonti e presenza nel catalogo

La versione 2 dei confronti conserva tutte le differenze di nome e distingue quelle dovute soltanto a spazi da altre differenze. Non rimuove suffissi o simboli per far concordare i nomi e non certifica automaticamente identità o varianti.

Per i numeri presenti soltanto in TCGdex, il worker cerca gli esatti `source_uid` nello stesso namespace linguistico di importazione, usando l’indice univoco delle carte e letture di massimo 200 identificativi. Mostra quante voci sono già collegate, quante non hanno quel collegamento e quante non sono determinabili. Il controllo riguarda solo questo sottoinsieme della fonte primaria: non misura la completezza dell’intero catalogo né cerca equivalenze con righe precedenti prive di identificativo di fonte. Un collegamento assente non viene chiamato carta mancante. Identificativi ripetuti o numeri duplicati restano indeterminabili; un errore di lettura lascia l’esito sconosciuto, senza inventare zeri.

La pagina conserva la data del controllo e mostra fino a 20 esempi con collegamenti alle carte esistenti. Nessuna identità, immagine o riga canonica viene modificata da questa diagnostica. I vecchi risultati sono arricchiti alle successive verifiche.

Controllo reale del 15 novembre 2026 su SM12a giapponese: 226 voci nell’elenco TCGdex e 210 nello snapshot Atlas; le 16 voci esclusive di TCGdex sono tutte già collegate nel catalogo. Quattro dei 23 nomi discordanti differiscono solo per spazi; i restanti 19 rimangono da verificare.
