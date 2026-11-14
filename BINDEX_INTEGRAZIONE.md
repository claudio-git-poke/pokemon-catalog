# Contratto sorgente Bindex — chiave del 14 novembre 2026

Il catalogo è la fonte dei dati delle carte, esclusi i prezzi. La copia è unidirezionale: catalogo → Bindex. Le tabelle leggibili con la chiave pubblica del catalogo sono `set_espansioni`, `set_carte`, `set_carte_immagini`; le identità pubblicate `(sigla, numero, variante)` non si rinumerano e non si cancellano. Una rimozione usa `eliminata=true`.

## Controlli

`GET /api/bindex/status` espone `validation`: errori bloccanti, codici non documentati, pagine Cardmarket canoniche e ID disponibili. Un codice sconosciuto resta nullo: non si inventa per superare il controllo. `ready` richiede bootstrap completato e zero errori bloccanti.

Il worker valida identità, numero intero positivo, variante, codice, nome, tag e ID prodotto prima di pubblicare. Le nuove voci senza nome italiano/inglese documentato restano in attesa. I set asiatici e MFB non usano il numero stampato come posizione Cardmarket: le associazioni incerte restano interne.

`set_carte.cardmarket_url` contiene soltanto pagine `https://www.cardmarket.com/it/Pokemon/Products/...` senza query o frammenti. Gli ID certi restano in `cardmarket_id`. I redirect con `?idProduct` sono disponibili nell'indice interno, ma non vengono esportati nel campo della pagina canonica. Un worker precedente non può reintrodurli.

Le foto vengono pubblicate con `bindex_publish_photo`: lingua documentata (`EN`, `IT`, ecc.), fonte e foto per variante. Un'immagine di riferimento non diventa la foto esatta della variante. L'assenza di una lingua documentata sospende la foto. Le immagini verificate non vengono sostituite da importazioni non verificate e una lingua diversa non prende il posto della foto principale italiana. Le foto iniziali marcate `INT` restano non riclassificate quando la lingua non è dimostrabile.

## Lettura incrementale facoltativa

È sempre possibile usare le tabelle REST come previsto dal file originale. Il nuovo endpoint è una modalità aggiuntiva con paginazione deterministica:

`GET /api/bindex/changes?kind=cards&limit=1000`

`kind`: `sets`, `cards`, `photos`. La risposta contiene:

- `items`: esclusivamente i campi del contratto, incluse le righe eliminate;
- `until`: limite temporale fisso della lettura (un minuto prima dell'inizio, per lasciare terminare le normali transazioni del worker);
- `next_cursor.time`: timestamp completo, incluse le frazioni di microsecondo;
- `next_cursor.key`: chiave completa dell'ultima riga;
- `complete`: falso finché serve un'altra pagina. Una pagina esattamente piena richiede un'ulteriore richiesta, eventualmente vuota.

Per la pagina successiva inviare `after=<next_cursor.time>`, `key=<JSON next_cursor.key>`, `until=<until della prima pagina>`. Codificare i parametri con URLSearchParams. Non convertire il timestamp in Date JavaScript: conserverebbe solo i millisecondi. Non fare avanzare il checkpoint dopo una singola pagina.

È disponibile anche la RPC anonima `bindex_export_page(kind, after_time, after_key, until_time, page_size)` sul progetto Supabase del catalogo. È SECURITY INVOKER e rispetta RLS; non scrive dati.

## Copia quotidiana da attivare nel progetto Bindex

Il progetto Bindex non era accessibile dalla connessione di lavoro al momento di questo intervento. Il job non è stato attivato né sono stati modificati dati degli utenti o prezzi.

Implementazione prevista, coerente con il file originale:

1. Acquisire un lock per impedire sovrapposizioni; registrare inizio esecuzione e ultimo checkpoint riuscito.
2. Leggere con la sola chiave pubblica della sorgente. Importare set, poi carte, poi foto. Usare un limite `until` fisso per l'intero giro.
3. Rileggere anche una finestra precedente al checkpoint (almeno cinque minuti) e fare UPSERT idempotenti. Una transazione molto lunga può diventare visibile dopo il suo timestamp: per intercettare anche casi eccezionali prevedere una riconciliazione completa periodica.
4. Aggiornare esclusivamente le colonne del contratto. Conservare prezzi, dati utenti e chiavi delle carte già collegate. Le foto usano anche `lingua` nella chiave.
5. Gestire `eliminata=true` senza cancellare carte ancora referenziate dagli utenti. Il comportamento concreto va adattato alle tabelle dei riferimenti presenti in Bindex, prima di attivare cancellazioni fisiche.
6. Dopo tutte le pagine di tutte le tabelle, salvare il checkpoint `until` e segnare l'esecuzione riuscita. In caso di errore mantenerlo invariato: la ripetizione recupera il giro senza duplicati.
7. Pianificare una volta al giorno con pg_cron + pg_net nel progetto Bindex e rendere visibili ultimo successo ed eventuale errore.

Prove automatiche della sorgente: chiavi immutabili, URL compatibili, protezione foto italiane/verificate, timestamp uguali con microsecondi, tombstone e accesso anonimo in sola lettura. L'intero ciclo nel database destinatario va ancora provato quando il suo progetto sarà accessibile.
