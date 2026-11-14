# Contatori in tempo reale

Le pagine Catalogo e Copertura ricevono gli aggiornamenti attraverso Supabase Realtime (Postgres Changes), senza ricaricarsi. Il browser ascolta solo `catalog_live_updates`: una riga con scope, revisione e timestamp. I dati completi delle carte e i payload dei metadati non vengono replicati per questa funzione.

Trigger per istruzione su `cards`, `catalog_search_entries`, `set_carte` e `set_carte_immagini` aggiornano il segnale nella stessa transazione. Una modifica confermata al database diventa quindi un'invalidazione dei contatori. La funzione di trigger ha un compito fisso e limitato, vive in uno schema privato e non è richiamabile direttamente da anon o authenticated. Questi ruoli possono leggere il segnale, ma non scriverlo. I normali permessi delle carte non vengono modificati.

Gli eventi arrivati entro circa 1,5 secondi sono raggruppati. Una richiesta non si sovrappone alla precedente; se arrivano modifiche mentre è in corso, si esegue un aggiornamento successivo. I tempi effettivi includono la latenza del database e della connessione: non è una garanzia di aggiornamento istantaneo al millisecondo.

Copertura rilegge il report completo mantenendo filtri e pagina. Catalogo aggiorna solo contatori, percentuale e totale dei risultati: elenco, ordinamento, posizione di scorrimento e testo in corso di scrittura restano invariati. Gli aggiornamenti di sfondo non mostrano scheletri di caricamento.

Quando la pagina è nascosta non avvia ricalcoli. Al ritorno o alla riconnessione rilegge i contatori. Se il WebSocket non è collegato, l'interfaccia lo indica e usa un aggiornamento di riserva ogni 30 secondi. Una connessione normale aggiorna i contatori su evento. Ogni 10 secondi controlla soltanto la piccola riga di revisione, per recuperare notifiche perse da browser sospesi: senza una nuova revisione non ricalcola i contatori.

Migrazione: `db/catalog-live.sql`. Test: `tests/catalog-live.test.mjs` (eventi ravvicinati, modifiche durante una richiesta, schede nascoste, pulizia, trigger per istruzione e permessi di sola lettura). Anche la ricezione di un segnale reale è stata verificata con un client anonimo.
