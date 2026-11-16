# Misurare carte, versioni e foto mancanti

La pagina `/copertura` apre il riepilogo **Cosa manca nel catalogo**. Distingue gli elenchi non confrontati dagli identificativi effettivamente mancanti, le versioni da identificare dalle versioni descritte e le foto generiche dalle foto esatte.

## Significato dei numeri

- Un elenco di fonte non controllato ha identificativi mancanti **non rilevati**, mai zero per convenzione. I conteggi dichiarati dalla fonte e quelli degli identificativi elencati restano distinti.
- `sourceManifest` confronta gli insiemi completi degli identificativi, registra mancanti, inattesi e duplicati e conserva fino a 30 esempi per categoria. Conteggi uguali con identificativi diversi non risultano completi.
- Per i vecchi confronti senza dettaglio, un'impronta coincidente documenta zero identificativi mancanti/inattesi; un'impronta discordante lascia il numero ignoto fino a un nuovo confronto. Non si sottraggono i contatori delle importazioni per inventare assenze.
- Le voci di varianti sono documentazioni delle fonti e possono sovrapporsi. Non sono tutte le carte fisiche uniche e non stabiliscono quante varianti ancora sconosciute esistano.
- Le foto esatte vengono contate soltanto nell'inventario già elaborato, per voci di stampa. Una foto generica non certifica una versione o una lingua. Le foto candidate e verificate restano separate.
- La tabella delle lingue usa la lingua documentata della stampa, compresa la categoria sconosciuta. Gli elenchi di fonte usano invece la lingua del percorso della fonte.
- Il raggruppamento degli elenchi usa l'origine documentata dagli identificativi della fonte. Una classificazione manuale BOO non viene cancellata o reinterpretata per far coincidere i conteggi.

## Aggiornamento senza scansioni dalle pagine

Il workflow `coverage-audit.yml` è dedicato al controllo, con pianificazione ogni mezz'ora e avvio anche alle modifiche del relativo codice. Gli orari GitHub possono subire ritardi.

Le query leggono al massimo 500 carte o 2.000 voci di inventario per lotto, usando cursori sulle chiavi indicizzate. Il controllo delle carte visita le voci indicizzate della singola carta. Non viene materializzato tutto il catalogo per ogni richiesta del browser.

Il worker conserva un limite superiore delle chiavi all'avvio: nuove importazioni non rendono infinita la rilevazione. I dati letti durante la scansione possono cambiare, quindi vengono mostrate sia la data iniziale sia quella finale: non è una fotografia transazionale istantanea.

Un checkpoint periodico permette la ripresa dopo timeout o termine del budget, senza ricontare i lotti già salvati. Alla fine viene marcato come completato e conservato, senza cancellarlo, per le verifiche amministrative. Le scansioni troppo vecchie ripartono; una rilevazione recente evita lavoro ripetuto. Le due copie pubbliche (nuovo riepilogo e statistiche dettagliate precedenti) vengono pubblicate insieme, solo alla fine. Un errore mantiene l'ultima rilevazione completata.

I processi di importazione chiamano ancora `catalog_refresh_quality_cache`, ma questa funzione ora registra una richiesta leggera; il calcolo avviene nel workflow dedicato. Il vecchio aggregato monolitico non viene più eseguito a fine ciclo di importazione.

Il pubblico può leggere solo la rilevazione completata. Checkpoint e richieste restano riservati ai worker. Le funzioni di scansione e pubblicazione non sono eseguibili dai client pubblici. Tutte le funzioni sono invoker e le nuove tabelle hanno RLS.

## Installazione e verifiche

Applicare `db/coverage-audit.sql` e `db/coverage-audit-report.sql` prima del worker aggiornato. Nelle installazioni nuove il campo `coverage_detail` è già presente in `db/catalog-coverage-register.sql`.

`tests/coverage-audit.test.mjs` verifica le query su PostgreSQL, la ripresa dopo timeout, l'assenza di duplicazione dei contatori, il mantenimento del riepilogo precedente, i permessi pubblici, le lingue sconosciute, le immagini generiche, le impronte discordanti e le cancellazioni dell'inventario.

Questo controllo misura il catalogo importato rispetto agli elenchi registrati. Non certifica la copertura mondiale: fonti assenti, espansioni non ancora scoperte e varianti non documentate restano un lavoro esplicito da completare.
