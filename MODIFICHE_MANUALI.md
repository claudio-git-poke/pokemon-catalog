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
