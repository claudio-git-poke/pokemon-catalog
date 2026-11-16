# Priorità delle correzioni manuali

Le correzioni umane hanno precedenza sulle fonti esterne. La protezione è applicata da PostgreSQL, anche ai processi già avviati e alle scritture dirette dei worker.

## Comportamento

- Una modifica dal Table Editor/SQL di Supabase viene registrata automaticamente nel campo `manual_overrides` della riga. Nell'editor del catalogo il pulsante Salva protegge solo i campi toccati (foto con stato/fonte, oppure note), compresi quelli intenzionalmente lasciati vuoti. Modificare una nota non blocca la ricerca della foto.
- Vengono bloccati i singoli campi corretti: gli altri possono continuare ad aggiornarsi. Array di tag e oggetti di fatti vengono conservati esattamente come salvati; un tag rimosso, `false`, `null` e una stringa vuota non vengono riaggiunti o sostituiti dalla fonte.
- Una nuova correzione manuale sostituisce la precedente. Un worker non può svuotare `manual_overrides`, neppure tramite upsert. Non esiste una scadenza del blocco.
- Correzioni di nome, espansione e lingua in `cards` si riflettono nell'indice delle sue stampe, senza sostituire eventuali correzioni più specifiche sulla singola stampa. Le immagini generiche non vengono propagate a tutte le varianti come se fossero foto esatte.
- Una classificazione manuale BOO (o qualsiasi altro codice) non viene ricalcolata a partire dalla fonte. Se non c'è una corrispondenza canonica esplicita, la pubblicazione rimane in attesa di mappatura. Un collegamento canonico corretto manualmente in `catalog_export_links` prevale sul resolver automatico.
- La ricerca automatica delle foto rispetta una scelta manuale anche se l'utente ha scelto di lasciare la foto vuota. La protezione opera anche quando il salvataggio manuale avviene durante una ricerca già in corso.
- Le cancellazioni automatiche di righe protette vengono ignorate. Per rimuovere una carta già pubblicata usare la modifica manuale `eliminata=true`; per l'inventario usare `deleted=true`. La cancellazione fisica manuale di una riga elimina anche la sua protezione: una fonte può riscoprirla. Non usare DELETE per escludere permanentemente una carta.

## Ambito

Tabelle protette: `cards`, `catalog_search_entries`, `set_carte`, `set_carte_immagini`, `catalog_export_links`, `catalog_visual_links`, `catalog_visual_assets`, `set_espansioni`, `catalog_printing_inventory`, `catalog_code_reviews`.

Restano operativi i metadati tecnici: timestamp, contatori e code dei tentativi, indice di ricerca calcolato. Restano validi vincoli, tipi e chiavi immutabili del contratto Bindex: un valore non valido viene rifiutato, non corretto silenziosamente. Le correzioni sui dati di partenza possono aggiornare le viste derivate; le correzioni dirette su una vista materializzata non correggono automaticamente tutte le tabelle sorgenti.

La migrazione riconosce i vecchi marcatori espliciti (`image_status=manual`, `verification=reviewed`, foto e associazioni verificate/rifiutate). Le modifiche storiche senza marcatore non sono distinguibili dai dati importati: non è possibile prometterne il riconoscimento retroattivo. Per proteggere un valore già presente si può risalvare dall'editor oppure aggiungerlo esplicitamente a `manual_overrides` dal pannello amministrativo.

## Integrazioni

I worker usano `service_role` e sono automatici per impostazione predefinita. I backend che fanno operazioni automatiche con un client pubblico devono inviare l'header `x-catalog-write-mode: automatic` (già applicato all'API di ricerca immagini). Le operazioni amministrative intenzionalmente manuali con service role devono inviare `x-catalog-write-mode: manual`.

Gli script SQL di manutenzione non umana devono usare una transazione con `set local request.headers='{"x-catalog-write-mode":"automatic"}';` prima delle scritture. Le scritture derivate eseguite dai trigger non creano nuove correzioni umane.

I permessi delle tabelle rimangono invariati: la protezione non aggiunge accesso pubblico in scrittura. Un amministratore capace di cambiare lo schema può deliberatamente disabilitare i trigger; la garanzia riguarda i normali processi di importazione e aggiornamento.

Applicare `db/manual-precedence.sql` al database catalogo prima del codice aggiornato. La migrazione non è stata applicata a un eventuale progetto Bindex separato non accessibile: quel database richiede la stessa politica nei propri processi di importazione se vi si fanno correzioni manuali.

## Verifiche

`tests/manual-precedence.test.mjs` esegue SQL reale con i trigger di pubblicazione, Cardmarket e revisione codici. Copre aggiornamenti ripetuti, upsert, campi vuoti, tag rimossi, booleani falsi, modifiche successive, editor anonimo, API automatica, foto pubblicate via RPC, collegamenti manuali, marcatori storici e classificazioni BOO con mappatura ambigua.

## Confermare dati precedenti e consultare lo storico

Nella scheda carta, **Correzioni manuali → Controlla e proteggi i valori attuali** permette di scegliere i campi da mantenere. Il pulsante protegge i valori visualizzati senza riscriverli. Foto, stato e fonte costituiscono una scelta unica. Se nel frattempo una fonte cambia uno dei valori selezionati, il salvataggio viene rifiutato e occorre ricaricare: non vengono protetti dati diversi da quelli controllati.

La funzione `catalog_protect_card_fields` mantiene i permessi già previsti sulle carte e non concede ai client la scrittura diretta sull'indice delle stampe. Il relativo aggiornamento derivato avviene tramite un trigger privato limitato alla carta effettivamente modificata. Una correzione manuale specifica sulla stampa continua a prevalere sulla correzione generale della carta.

Da `db/manual-review-history.sql`, le nuove decisioni vengono conservate in `catalog_manual_history`: chiave della riga, campi coinvolti, valori prima/dopo, protezioni prima/dopo, ora, ruolo del chiamante ed eventuale identità autenticata. Gli utenti anonimi vengono registrati come anonimi: non viene attribuito loro il nome del proprietario. Lo storico è amministrativo, non leggibile o modificabile dai client pubblici; il worker ha accesso in sola lettura. Gli aggiornamenti automatici senza cambiamento delle protezioni non aggiungono eventi.

Le revisioni storiche con stato `verified`, codice esplicito e fonte registrata vengono protette; il codice pubblicato viene protetto solo se codice e prodotto coincidono con la revisione. Eventuali precedenti correzioni manuali del codice hanno priorità. Questi eventi hanno motivo `existing_verified_code_review`: sono verifiche documentate, non una ricostruzione dell'autore delle vecchie modifiche. I casi `pending` e `no_code_in_source` non vengono promossi a verificati.

La migrazione non ricostruisce uno storico precedente alla sua installazione. Per altre vecchie correzioni prive di marcatori, l'azione esplicita sulla scheda è il percorso sicuro.
