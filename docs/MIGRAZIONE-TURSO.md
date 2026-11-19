# Migrazione gratuita a Turso

La prima fase crea e verifica una copia di tutte le 31 tabelle pubbliche del catalogo. La copia conserva ogni campo, chiave, JSON, URL, decisione manuale e riga di cronologia. Nessuna tabella viene cancellata da Supabase e il sito continua a usare la fonte attuale fino al passaggio successivo.

## Connessione

I segreti GitHub richiesti sono `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN`, oltre ai già presenti `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. I token restano nei segreti e non vengono inclusi nei rapporti. Il workflow **Connessione gratuita Turso** esegue soltanto una SELECT e verifica il supporto JSON.

## Copia verificata

Il workflow **Copia verificata catalogo su Turso**:

1. Controlla la destinazione, poi sospende i 13 workflow che scrivono in Supabase e annulla le loro esecuzioni pendenti. CI e workflow Turso restano attivi. Il rapporto `turso-paused-workflows.json` registra lo stato precedente per il ripristino.
2. Legge Supabase esclusivamente con GET e HEAD. Le tabelle vengono paginate mediante la chiave primaria, anche composta; non si usano offset crescenti.
3. Memorizza le righe originali come JSON nelle tabelle `_copy_<nome>`. Le credenziali del database non vengono copiate.
4. Salva il cursore soltanto nella transazione che completa la pagina. Una pagina interrotta si può ripetere senza duplicazioni.
5. Rilegge la copia e verifica chiavi, posizioni, conteggi, contenuti SHA-256 e una catena separata dei campi protetti da `manual_overrides`. Valori nulli e liste vuote restano distinti.
6. Pubblica `turso-snapshot-report.json` come artifact GitHub, con conteggi e hash ma senza contenuti delle carte o token. Una copia parziale riprende al prossimo avvio.

La prima esecuzione include anche il registro tecnico storico. I nuovi log dell'operazione restano in GitHub Actions e non aumentano il database Supabase. Il processo non abilita funzionalità a pagamento.

I lotti vengono inviati con un solo INSERT parametrizzato attraverso `json_each`, limitando dimensione e numero di righe. Non si rilegge uno stato che la stessa transazione ha appena confermato. Un'esecuzione più recente può sostituire quella in corso: le transazioni completate e i punti di verifica restano salvati e la pagina interrotta viene ripetuta.

## Passaggio del sito

Una copia verificata non equivale ancora al passaggio delle API. Il rapporto riporta esplicitamente `cutover: false`. Prima di cambiare il sito occorrono il livello di compatibilità per le richieste di ricercaDB, la protezione delle scritture manuali e l'adattamento degli importatori. La copia originale Supabase va conservata finché questi controlli non sono completati.

Il piano gratuito Turso ha limiti di spazio e operazioni. I successivi aggiornamenti devono modificare soltanto righe effettivamente cambiate e conservare un registro tecnico limitato, evitando di riscrivere continuamente l'intero catalogo.

## Letture e protezioni dopo la copia

Il workflow **Prepara indici e protezioni Turso** attende che la copia sia interamente verificata. Prepara gli indici di ricerca, le viste con i nomi originali e i gruppi di simboli con gli stessi identificativi PostgreSQL. La lettura pubblica ammette soltanto tabelle e campi del contratto originale; la cronologia privata resta esclusa.

Le modifiche SQL sulle viste del catalogo vengono acquisite come manuali. I worker impostano invece `mode='automatic'` nella propria transazione e lo ripristinano prima del commit. I trigger conservano le protezioni precedenti, anche per valori nulli, array vuoti e JSON vuoti. Le correzioni delle varianti prevalgono su quelle generali della carta; una scelta manuale aggiorna anche la ricerca e viene aggiunta alla cronologia append-only. Una modifica non valida annulla l'intera transazione.

Gli hash `_hash` certificano la copia iniziale. Una modifica successiva viene marcata `pending` finché il writer non aggiorna il digest: quel marcatore non viene presentato come un hash verificato del contenuto corrente. I campi interni non fanno parte dell'API pubblica.

La preparazione degli indici non effettua il cambio del sito e non riattiva gli importatori Supabase.

## API del sito e di ricercaDB

Il percorso `/api/catalog-db/rest/v1/<tabella>` conserva il protocollo di lettura usato dal client Supabase: filtri, campi JSON, relazioni, conteggio, paginazione e risposte singole. Le funzioni di identificazione, copertura, simboli e feed Bindex passano dallo stesso adattatore. Non è un'implementazione completa di PostgREST: operatori e funzioni non supportati restituiscono un errore esplicito. Tabelle private e RPC degli importatori non sono esposte.

La scelta del backend è esplicita e resta disattivata per impostazione predefinita. In Vercel servono `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` come segreti del server. `CATALOG_TURSO_PREVIEW=1` abilita soltanto le letture del nuovo endpoint, utili al confronto prima del passaggio. Per il passaggio effettivo occorrono entrambi `CATALOG_DATABASE=turso` e `NEXT_PUBLIC_CATALOG_DATABASE=turso`, con un nuovo build. Le credenziali Turso non devono mai avere il prefisso `NEXT_PUBLIC_`.

Il client del sito mantiene le sue richieste attuali e usa la nuova base REST. Le route server usano lo stesso adattatore direttamente, senza richieste HTTP del server a se stesso. Gli aggiornamenti della pagina leggono il piccolo contatore di revisione, senza aprire websocket Supabase quando il backend è Turso.

Il salvataggio di una carta legge e aggiorna il documento nella stessa transazione. Le protezioni inviate da un modulo vecchio non sovrascrivono quelle aggiunte nel frattempo. La conferma dei campi esistenti controlla i valori attesi e rifiuta una schermata non aggiornata. L'intestazione pubblica `x-catalog-write-mode` non può autorizzare una modifica automatica: soltanto le route server scelgono quella modalità.

Ogni modifica manuale aggiunge una versione alla coda privata `_catalog_manual_outbox`; gli aggiornamenti automatici non la svuotano. Il worker di pubblicazione dovrà rielaborare queste versioni e confermarle soltanto se non sono cambiate durante il lavoro. La presenza della coda non indica che il worker sia già stato adattato.

Prima dell'attivazione: completare la copia e gli indici, verificare il nuovo endpoint con le richieste reali, configurare i segreti in Vercel e adattare gli importatori. I workflow Supabase restano sospesi. La modifica della base URL di ricercaDB va fatta dopo questo confronto, conservando colonne, tag e chiavi esistenti.

## Preparazione degli importatori

`data/turso-worker-pg-schema.json` contiene soltanto il codice e la struttura del database originale: 31 tabelle, 4 viste, 71 funzioni, 82 trigger, 141 vincoli e relativi permessi. Non contiene righe, token o credenziali. Le impostazioni delle sequenze a 64 bit sono stringhe, per conservarle esattamente.

Un worker temporaneo può ricreare questo schema in PostgreSQL e caricare i dati di Turso, mantenendo le regole di importazione esistenti. La disattivazione dei trigger riguarda soltanto il caricamento nel database temporaneo e viene ripristinata prima del lavoro. I vecchi eventi tecnici restano su Turso; nel worker basta riservare identificativi superiori a quelli esistenti. La cronologia manuale viene invece caricata integralmente.

I trigger privati del worker registrano la prima versione letta e l'ultima scritta di ciascuna chiave. La funzione di confronto applica soltanto campi cambiati dal worker e ancora uguali al valore iniziale: modifiche umane intervenute nel frattempo, valori vuoti protetti e righe cancellate prevalgono. Collisioni fra nuove identità diverse sono errori espliciti.

Gli archivi delle differenze sono compressi e cifrati con AES-256-GCM, con autenticazione e limiti di dimensione. Prima di pubblicare una differenza occorrerà salvarne l'archivio cifrato e la chiave esclusivamente nel registro privato della destinazione, quindi poter riprendere una pubblicazione interrotta. Nessun archivio con dati in chiaro deve essere allegato a un workflow pubblico.

Questi moduli preparano il motore del worker e sono verificati con PostgreSQL reale via PGlite. Non avviano ancora importazioni né pubblicazioni di dati: mancano l'esecutore temporaneo, il ripristino degli archivi pendenti e il publisher transazionale. La pianificazione resta sospesa fino al completamento di questi componenti.

## Pubblicazione ripetibile

`scripts/turso-worker-publish.mjs` prepara un archivio privato cifrato nella destinazione prima di modificare il catalogo. I blocchi incompleti hanno stato `staging` e non possono pubblicare righe. Dopo l'autenticazione dell'archivio, ogni lotto salva dati e cursore nella stessa transazione; un nuovo avvio riprende dalla prima differenza non confermata.

I genitori vengono inseriti prima dei figli e le cancellazioni seguono l'ordine inverso. Nuove stampe tengono conto anche delle correzioni del genitore arrivate dopo l'avvio del worker; ricerca e indici riflettono il valore effettivo. Le modifiche sono raggruppate per tabella e dimensione del messaggio, evitando una richiesta di rete per ogni riga.

Le date dei feed vengono assegnate al momento della pubblicazione. La coda manuale viene confermata soltanto alla fine e soltanto per la versione effettivamente elaborata: una correzione successiva rimane in attesa. La chiave e i blocchi cifrati vengono eliminati dopo la pubblicazione completa; restano il digest e i metadati dell'esecuzione. Un'identità nuova già occupata sospende il lotto conservando l'archivio.

Il registro è privato e non richiede artifact pubblici con dati del catalogo. Restano da collegare questi moduli all'esecutore temporaneo e alla ripartenza dei worker; questo codice da solo non riattiva nessun importatore.

## Limiti gratuiti e freno dei consumi (17 novembre 2026)

La prima copia ha esaurito la quota gratuita mensile di 10 milioni di righe scritte e Turso ha bloccato l'account fino al rinnovo. Turso conta anche ogni voce di indice e ogni riga toccata dai trigger. Le cause:

- il registro tecnico `catalog_sync_events` (1.130.600 righe, più di metà della copia), con circa tre scritture per riga;
- la preparazione degli indici, della ricerca a testo e della tabella dei tag sulle 349.530 stampe.

I workflow **Copia verificata catalogo su Turso** e **Prepara indici e protezioni Turso** sono disattivati. Supabase ha superato il limite gratuito di 500 MB: il catalogo resta fermo fino al passaggio a Turso.

Correzioni:

- Il registro v4 scrive gli eventi solo nell'output del processo (log di GitHub Actions). Nel database resta il riepilogo dell'esecuzione, aggiornato al massimo ogni 30 secondi. La pagina `/automazione` rimanda ai log di GitHub Actions invece di interrogare il database ogni secondo. Le differenze dei worker non includono più `catalog_sync_events`.
- `scripts/turso-budget.mjs` legge i consumi ufficiali dalla Platform API di Turso e divide la quota residua fino all'80% del limite sui giorni e sulle esecuzioni rimanenti. Senza credenziali o con una risposta non valida il freno blocca le scritture.
- `publishWorkerDelta` accetta `writeBudget`: stima il costo di ogni lotto prima di eseguirlo e si ferma conservando il cursore, per riprendere all'esecuzione successiva.

Costi misurati sullo schema reale (`tests/helpers/turso-fixture.mjs`):

| Tabella | Righe modificate per riga pubblicata | Stima in scritture Turso, con margine |
|---|---|---|
| Stampa (`catalog_search_entries`) | circa 27 | 35 |
| Carta (`cards`) | circa 5 | 20 |
| Altre tabelle | — | 8 |

Stime ricalibrate il 18 novembre 2026 sul contatore ufficiale (vedi sotto).

Un aggiornamento di massa delle 349.530 stampe costerebbe quindi più del doppio dell'intera quota mensile gratuita. I recuperi retroattivi devono procedere a rate, entro il budget di ogni esecuzione.

Segreti necessari per il freno:

- `TURSO_API_TOKEN`: token della Platform API, creato dalla dashboard Turso o con `turso auth api-tokens mint`;
- `TURSO_ORGANIZATION`: slug dell'organizzazione o dell'account;
- facoltativo `TURSO_RESET_DAY`: giorno di rinnovo della quota, predefinito 1.

## Migrazione tramite file (account del collaboratore)

La nuova migrazione non scrive righe su Turso con istruzioni SQL. Il workflow **Migrazione Turso tramite file** (solo avvio manuale) procede così:

1. Legge Supabase solo con GET e HEAD.
2. Costruisce in locale, su GitHub Actions, un file SQLite completo: copia verificata con le catene SHA-256, indici, ricerca a testo, tag, gruppi di simboli e protezioni manuali. Il codice di copia e preparazione è lo stesso già verificato, eseguito su `scripts/sqlite-file-client.mjs`.
3. Esegue un controllo di integrità del file e ne unisce il WAL.
4. Con `upload=true` crea un NUOVO database tramite la Platform API (seed `database_upload`) e carica il file. Se il database esiste già, il workflow si ferma.
5. Verifica il database caricato leggendo solo gli stati della copia e `max(_position)` di ogni tabella, cioè poche centinaia di righe.

Il registro tecnico è vuoto all'origine e resta vuoto. Il file temporaneo viene cancellato a fine esecuzione e non viene pubblicato come artifact.

Prova del 18 novembre 2026 (`Prova caricamento file su Turso`): un file di 50.000 righe è stato caricato e letto correttamente. Il contatore ufficiale dei consumi non si era ancora aggiornato dopo sei minuti; il workflow orario **Consumi Turso** stabilisce se il caricamento conta tra le righe scritte. Il catalogo si carica solo dopo questa conferma.

## Worker su Turso

Il workflow **Worker catalogo su Turso** sostituisce i 13 workflow Supabase. Ogni esecuzione segue questi passi:

1. **Budget.** Legge i consumi ufficiali e calcola il budget dell'esecuzione (`check-turso-budget.mjs`). Senza budget non fa nulla.
2. **Pubblicazioni sospese.** Se una pubblicazione precedente è rimasta a metà, riprende solo quella (`resume`).
3. **Ripristino.** Altrimenti ripristina il catalogo da Turso in un PostgreSQL 17 temporaneo, il servizio del job, con lo schema originale. Questo legge circa una riga Turso per riga del catalogo. Poi installa i trigger che registrano le differenze.
4. **Importatori.** Avvia PostgREST in locale con un segreto JWT casuale; il proxy `rest-prefix-proxy.mjs` espone `/rest/v1`. Gli importatori girano senza modifiche, convinti di parlare con Supabase.
   - Gruppo A: importazione principale, fonti aggiuntive, fonti promo, uscite speciali, confezioni.
   - Gruppo B: recuperi retroattivi, inventario, confronti, copertura.
5. **Raccolta.** Raccoglie le righe modificate, escluse le tabelle mai pubblicate (registro tecnico, contatore realtime, cronologia manuale).
6. **Pubblicazione.** Le divide in pacchetti cifrati ordinati (al massimo 10.000 differenze ciascuno) e le pubblica entro il budget. Quello che non entra resta in coda: l'esecuzione successiva lo pubblica prima di fare nuovo lavoro.

Le correzioni manuali fatte su Turso durante l'esecuzione prevalgono campo per campo (`mergeWorkerChange`). La coda `_catalog_manual_outbox` non viene confermata dal worker.

Con `publish=false` il workflow esegue tutto tranne la scrittura su Turso e riporta le differenze con la stima delle scritture.

Prove del 18 novembre 2026:

- **Prova senza scritture (gruppo A, 8 minuti).** Ripristino in 6 minuti; PostgREST e importatori invariati funzionanti; 15.888 differenze raccolte.
- **Prima pubblicazione vera.** 15.969 differenze in 2 pacchetti; 6.592 pubblicate entro il budget, il resto in coda. Il contatore ufficiale ha registrato 115.390 righe scritte, contro una stima di 304.905: il 38%. I fattori di `turso-budget.mjs` sono stati ricalibrati sul costo misurato più un margine del 30%.
- **Letture.** Circa 1 milione per ripristino e circa 1,7 milioni per pubblicare 6.592 differenze, perché i controlli delle protezioni rileggono le righe. Con due esecuzioni al giorno restano sotto un terzo del limite mensile di 500 milioni.

Pianificazione: alle 03:41 UTC gira il gruppo A con 30 minuti di importazione principale, alle 15:41 UTC il gruppo B. Un'esecuzione che trova pacchetti in coda li pubblica senza avviare nuovo lavoro.

## Ricerche di ricercaDB su Turso

Il workflow **Controllo ricerche su Turso** esegue le ricerche tipiche di ricercaDB sul database vero. Usa un token di sola lettura e lo stesso adattatore del sito, e riporta per ogni ricerca le righe lette (dichiarate dal server), il tempo e il piano di esecuzione.

Primo controllo (18 novembre 2026):

| Ricerca | Righe lette | Tempo | Esito |
|---|---|---|---|
| Per nome, anche con lingua o timbro | 2.000–23.000 | 0,2–6,7 s | indice di ricerca a testo |
| Per espansione, anche con numero | 2.700–5.700 | 0,1–0,3 s | indice |
| Per solo numero o solo totale | circa 361.000 | 18–27 s | scansione completa |
| Lingua più finitura | 177.000 | 3 s | lettura dei tag di ogni stampa |

Correzioni:

- Nuovi indici su `collector_number` e `denominator` delle stampe. Su un database già caricato si creano una volta con l'opzione `indexes` del workflow, che richiede almeno un milione di scritture di margine; le costruzioni future li includono già.
- I filtri `cs` e `ov` sui tag delle stampe usano la tabella indicizzata `_catalog_entry_tags` invece di aprire l'elenco dei tag di ogni riga.

Feed incrementali per Bindex (`/api/bindex/changes`, `/api/bindex/printings`): ogni pagina ordinava l'intera tabella per data di modifica, e `printings` superava i 100 secondi sulle 152.000 righe dell'inventario. Correzioni:

- indici su data di modifica più chiave per `set_carte`, `set_espansioni`, `set_carte_immagini` e `catalog_printing_inventory`, creati con lo stesso workflow `indexes`;
- paginazione con confronto per tuple `(tempo, chiave) > (?, ?)`;
- query dirette sulle tabelle `_copy_`, perché SQLite non riconosce un indice di espressione attraverso una vista.

Pagina `/carte` (18 novembre 2026): i conteggi "con foto" e "senza foto" superavano i 30 secondi di Vercel. La prima pagina ordinava tutte le 195.247 carte, e ogni apertura leggeva circa un milione di righe. Correzioni:

- indice `_catalog_idx_cards_catalog_order` (sigla, numero, id) per l'ordine della pagina;
- indice `_catalog_idx_cards_photo` (stato, foto), con cui entrambi i conteggi si risolvono dentro l'indice;
- conteggi esatti memorizzati in `_catalog_count_cache`, condivisa fra le istanze del server, oltre che in memoria. Valgono finché non cambia la revisione del catalogo, che le protezioni incrementano a ogni scrittura, e comunque al massimo 6 ore. Riguarda solo le tabelle protette; senza la tabella di memoria il conteggio viene calcolato.

## Scritture più leggere (protezioni versione 3, 18 novembre 2026)

Le protezioni delle correzioni manuali eseguivano scritture che non cambiavano nulla. Con la versione 3:

- una scrittura automatica senza correzioni manuali, né prima né dopo, non riscrive la riga una seconda volta;
- il worker incrementa la revisione del catalogo una sola volta per lotto, mentre le modifiche manuali dal sito la incrementano a ogni riga come prima;
- per le stampe aggiornate, ricerca a testo e tag si riscrivono solo se cambiano;
- il pubblicatore riscrive l'hash solo delle righe modificate dalle protezioni.

Righe modificate per riga pubblicata, misurate in `tests/turso-write-cost.test.mjs` (gli indici vanno aggiunti a parte):

| Caso | Prima | Dopo |
|---|---|---|
| Stampa aggiornata con tag invariati | 26,6 | 3,3 |
| Stampa aggiornata con tag cambiati | 27,6 | 20,3 |
| Stampa nuova | 16,5 | 13,5 |
| Carta aggiornata o nuova | 6,3 | 3,3 |

Il workflow **Controllo ricerche su Turso** installa la nuova versione con l'opzione `guards`. Usa lo stesso gruppo di concorrenza del worker e segna l'API come non pronta durante la sostituzione dei trigger.

Soglia di arresto: 90% fino al rinnovo del 1° dicembre 2026 (`TURSO_STOP_RATIO`, `TURSO_STOP_RATIO_UNTIL`), poi di nuovo 80%. Il valore massimo ammesso è 90%.

Misura sul contatore ufficiale con le protezioni v3: un'esecuzione del gruppo A (30 minuti) ha raccolto 46.121 differenze, divise in 5 pacchetti. Le prime 14.300, tutte carte, sono costate 145.124 righe scritte contro 286.000 stimate, circa 10,1 per carta. I fattori diventano: carta 13, stampa 30 (riduzione misurata nei test, da ricalibrare sul contatore), inventario 10, altre 8.

Spesa anticipata di novembre 2026: la quota gratuita si azzera il 1° del mese, quindi spenderla prima non toglie nulla.

- Fino al 1° dicembre il freno distribuisce il residuo, fino al 90%, sui giorni che mancano al 25 novembre invece che a fine mese (`TURSO_SPEND_BY`).
- Il tetto per esecuzione sale a 900.000 scritture stimate (`TURSO_MAX_RUN_WRITES`).
- Dopo il 25 resta disponibile solo il residuo; dal 1° dicembre (`TURSO_FRONT_LOAD_UNTIL`) tornano la distribuzione su tutto il mese, il tetto di 400.000 e la soglia dell'80%.

Pianificazione robusta (18 novembre 2026): lo scheduler di GitHub ha ritardato o saltato molti avvii. Quel giorno il turno delle 15:41 UTC non è partito e il controllo orario dei consumi è partito una volta sola.

- Il worker si avvia otto volte al giorno: gruppo A alle 00:41, 06:41, 12:41 e 18:41 UTC; gruppo B alle 03:41, 09:41, 15:41 e 21:41 UTC.
- Il budget di scrittura di ogni esecuzione è proporzionale al tempo trascorso dall'avvio dell'ultima esecuzione riuscita, letto dall'API di GitHub (`actions: read`). Il calcolo è la quota residua moltiplicata per il tempo trascorso dall'esecuzione precedente, diviso il tempo tra quell'esecuzione e la scadenza (il 25 novembre durante la spesa anticipata, altrimenti il rinnovo).
- Un turno saltato rende più grande il successivo, quindi il ritmo complessivo non dipende da quanti avvii partono davvero. Senza il dato sull'esecuzione precedente la quota viene divisa per otto esecuzioni al giorno.

Misura delle stampe con le protezioni v3: la pubblicazione della coda delle 15:48 UTC (31.821 differenze: 10.435 carte, 9.310 stampe, 12.076 righe di code e riepiloghi), insieme a una piccola esecuzione successiva, è costata 333.781 righe scritte contro 528.495 stimate. Al netto delle carte, ogni stampa costa circa 17–20 righe scritte: il fattore passa da 30 a 25.

Copertura su Turso: il ricalcolo del 18 novembre alle 16:57 UTC conta 199.674 carte importate. I riepiloghi di copertura e qualità vengono pubblicati prima delle altre differenze.

Chiusura di novembre 2026: la scadenza della spesa anticipata è anticipata al 23 novembre. Dal 23 al 30 la soglia sale al 95% (`TURSO_ENDGAME_RATIO`, `TURSO_ENDGAME_FROM`) con turni di al massimo 300.000 scritture stimate (`TURSO_ENDGAME_MAX_RUN_WRITES`): anche con il contatore in ritardo di un turno, l'account resta sotto il limite. Il valore massimo ammesso è 95%; dal 1° dicembre tornano 80% e il tetto di 400.000.

Pianificatore a catena (18 novembre 2026): lo scheduler di GitHub non ha avviato il worker nemmeno una volta, e il controllo orario dei consumi è partito due volte in un giorno. Il workflow **Pianificatore worker Turso** aspetta il prossimo turno (ogni 3 ore alle :41 UTC), avvia il worker se non ce n'è già uno in corso e poi riavvia se stesso. Gli avvii manuali funzionano sempre. Un cron ogni 6 ore lo riattiva se la catena si interrompe, e gli orari del worker restano come riserva.

Correzione delle stime (19 novembre 2026): fra le 02:49 e le 18:41 UTC il contatore reale è salito di 708.560 righe scritte, contro 0,96–1,1 milioni stimate (rapporto 0,64–0,74). Con `TURSO_ESTIMATE_RATIO=0.7` il freno divide la quota reale spettante a ogni esecuzione per questo rapporto: ogni turno spende la sua parte effettiva invece di circa il 70%. La soglia resta verificata sul contatore ufficiale prima di ogni esecuzione.

Popolamento rapido (19 novembre 2026, sera): ogni turno pubblica il massimo consentito (900.000 scritture stimate) finché il contatore non raggiunge il 90%. Raggiunto il 90% (`TURSO_ENDGAME_AT`), il margine fino al 95% si distribuisce in proporzione al tempo fino al rinnovo del 1° dicembre, con turni di al massimo 300.000.

Turni ogni 30 minuti (19 novembre 2026, sera): il pianificatore avvia il worker a :11 e :41 di ogni ora.

- Ogni turno pubblica la sua parte della coda, al massimo 250.000 scritture stimate fino al 90% e 100.000 dopo. Turni piccoli e frequenti tengono un ritardo di un'ora del contatore ufficiale lontano dal limite.
- Un nuovo ripristino con giro di lavoro parte solo a coda vuota e almeno 150 minuti dopo il precedente (`WORK_INTERVAL_MINUTES`, tabella `_catalog_worker_state`), per non spendere un milione di letture a ogni turno.
- Il gruppo dei turni di lavoro si alterna ogni 3 ore.
