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
