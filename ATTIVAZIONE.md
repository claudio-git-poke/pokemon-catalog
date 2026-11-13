# Bindex: catalogo automatico

Questa versione aggiunge un processo indipendente dal browser. Non è ancora attivo sul sito pubblico: occorre configurarlo una volta nel repository e nel database Bindex.

## Che cosa succede da solo

1. Ogni sei ore GitHub Actions avvia il worker.
2. Una volta al giorno aggiorna gli elenchi delle espansioni nelle undici lingue TCGdex configurate. Nuovi set e set il cui conteggio cambia entrano in coda. I set già importati vengono comunque ricontrollati ogni settimana.
3. Importa le carte assenti senza assegnare immagini di espansioni o lingue diverse. Ogni carta importata riceve un identificativo stabile composto da fonte, lingua e ID della carta.
4. Cerca le immagini mancanti e riprova in futuro quelle non disponibili. I tentativi sono registrati nel database: chiudere il sito o riavviare il worker non li perde.
5. Il pannello /automazione mostra gli avvii, le importazioni, le immagini trovate e le fonti incomplete.

Non serve premere Cerca batch per il normale aggiornamento. Il comando manuale resta disponibile.

## Attivazione iniziale

### 1. Database Supabase

Nel SQL Editor del progetto Bindex eseguire il contenuto di `db/automazione.sql`. Prima del primo avvio automatico è necessario eseguire questo file. La ricerca manuale continua a usare TCGdex e l’archivio inglese anche se l’indice delle alternative non è ancora installato; il pannello mostra che il setup è incompleto.

Il file aggiunge colonne, indici, due tabelle di stato e un indice delle fonti alternative, preservando le carte originali. Se è stata installata la versione precedente, rieseguirlo: è ripetibile e aggiunge anche catalog_external_cards, source_local_id e provider. È stato verificato su PostgreSQL locale tramite PGlite, non sul database di produzione al quale questa sessione non ha accesso amministrativo. Presuppone la tabella cards del progetto e un ID generato automaticamente; eventuali vincoli extra del database reale vanno verificati.

### 2. Repository GitHub

Caricare tutto il contenuto della cartella progetto, compresi `package-lock.json`, `scripts/`, `db/` e `.github/workflows/catalog-sync.yml`, nella radice del repository collegato a Vercel. La cartella `.github` può risultare nascosta nei file manager: va inclusa. Il workflow deve trovarsi sul branch predefinito di GitHub.

In GitHub → repository → Settings → Secrets and variables → Actions creare:

- `SUPABASE_URL`: URL del progetto Supabase Bindex.
- `SUPABASE_SERVICE_ROLE_KEY`: chiave segreta server del medesimo progetto. Non usare una chiave pubblica e non inserirla in file o variabili NEXT_PUBLIC.

La chiave segreta compariva nello ZIP originale: revocare quella vecchia e usare quella nuova sia qui sia in Vercel.

GitHub → Actions → Aggiornamento catalogo Pokémon → Run workflow avvia il primo controllo. Dopo questo passaggio gli avvii sono programmati. Se una delle due chiavi non è ancora configurata, il workflow termina senza avviare il worker né modificare il database e mostra “Automazione in attesa delle chiavi”. Dopo aver salvato entrambe le chiavi, il successivo avvio programmato può procedere normalmente. La configurazione impedisce esecuzioni sovrapposte dello stesso workflow; non avviare contemporaneamente copie del worker da altri sistemi.

Il workflow scarica inoltre, in `.catalog-data/`, i soli JSON delle cartelle data_jp, data_ko e data_tc del repository pubblico type-null/PTCG-database. Non esegue codice di quel repository. ATLAS_DATA_DIR è già impostata nel workflow e non serve su Vercel. Se il download dell'archivio fallisce, il worker segnala il problema e prosegue con TCGdex.

### 3. Sito Vercel

Pubblicare il repository aggiornato conservando le normali variabili Vercel: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. Non occorre impostare Cron Vercel o CRON_SECRET: il worker accede direttamente a Supabase da GitHub Actions e non espone nuovi endpoint di scrittura.

Aprire /automazione. Dopo una prima esecuzione devono apparire la data di avvio e il riepilogo. Uno stato `partial` segnala fonti con errori; le altre continuano. Se non ci sono esecuzioni l'automazione non è ancora attiva. Se l'ultimo avvio è più vecchio di 14 ore compare un avviso.

## Tempi, quantità e risorse

- Ogni esecuzione lavora per circa otto minuti al massimo (più installazione dipendenze), esamina fino a 30 set (normalmente 15 Atlas + 15 TCGdex) e tenta fino a 40 immagini. Il tempo disponibile può ridurre questi numeri. Riprende dal database la volta dopo.
- Il primo popolamento completo è graduale e può richiedere molte esecuzioni, soprattutto considerando più lingue e fonti. Non viene completato in una sola chiamata. Con il limite di 40 immagini e quattro avvii al giorno, il massimo teorico è 160 tentativi giornalieri, non 160 immagini garantite.
- Le nuove carte appaiono quando le fonti le pubblicano e il worker raggiunge il relativo set: non immediatamente quando Pokémon Company le annuncia. Gli elenchi si aggiornano giornalmente; il carico iniziale può causare ulteriore ritardo.
- Tentativi senza immagini: dopo 1, 2, 4, 8, 16 e poi ogni 30 giorni. Errori temporanei: intervallo crescente da 1 a 24 ore; l'esecuzione effettiva avviene al primo avvio programmato successivo.
- GitHub Actions può avviarsi in ritardo. Nei repository pubblici GitHub può disabilitare i workflow programmati dopo 60 giorni senza attività: per un servizio continuativo preferire un repository privato con Actions abilitato e quota adeguata. Verificare i minuti inclusi nel proprio piano e i limiti di spesa; l'esecuzione programmata consuma risorse.
- Per aumentare il ritmo si può modificare il cron, il budget e i limiti del worker dopo avere verificato quote e limiti delle fonti. Non è necessario un abbonamento Vercel Pro per questa soluzione.

## Copertura reale

Fonti configurate: TCGdex (en, it, fr, de, es, pt, ja, ko, zh-tw, id, th), immagini TCGPlayer collegate alle carte inglesi, archivio storico PokemonTCG inglese e Card Atlas per i dati/URL dei cataloghi ufficiali giapponese, coreano e di Taiwan. Vedere **FONTI.md** per ciò che è integrato e ciò che richiede ancora credenziali.

Il worker indicizza nel database i dati Atlas durante l'elaborazione dei set; la ricerca manuale può usare queste immagini dopo tale indicizzazione. La prima indicizzazione asiatica è quindi graduale. Per le immagini coreane con URL non più valido si consulta la scheda ufficiale esatta e si recupera la sua immagine principale aggiornata. I set già noti vengono rivisitati settimanalmente; un nuovo file dentro un vecchio set può essere visto con questo ritardo. L'archivio inglese storico è solo un recupero alternativo di immagini: non alimenta le nuove uscite.

**Non significa tutte le carte mai esistite.** Il cinese semplificato non ha ancora un connettore attivo. Le promozionali, ristampe, varianti/stampi e alcuni set asiatici possono essere incompleti. Pocket è escluso. Non si inventano carte che non sono nelle fonti. Non vengono create righe separate per ogni finitura o stampo se non hanno un ID distinto nella fonte.

Le righe originali vengono collegate quando il set/numero è riconoscibile; per MFB serve un nome univoco nella stessa espansione perché il numero del file originale non è il numero della fonte. Gli abbinamenti ambigui restano segnalati: non possono essere risolti con affidabilità senza ulteriori dati. Sigle originali che non corrispondono agli ID della fonte richiedono una tabella di corrispondenza dedicata; l'identificativo fonte impedisce duplicati tra successive importazioni automatiche, ma non garantisce l'assenza di duplicati semantici con tutti i vecchi dati non collegati.

Le carte segnate found ma prive di URL vengono riportate in coda automaticamente. Le foto manuali non vengono sovrascritte. Le immagini sono URL remoti, non copie nel bucket Storage; il controllo è eseguito durante il recupero, non periodicamente su ogni immagine già segnata found/manual. Se un URL trovato viene rimosso in futuro bisogna riportare la carta allo stato missing per farla rientrare nella coda.

## Verifiche incluse

`npm ci --ignore-scripts`

`node --experimental-strip-types --test tests/*.test.mjs` (Node 24)

Test del recupero immagini, identità per lingua, MFB, tentativi distanziati, setup SQL ripetibile, vincoli univoci, permessi in sola lettura per lo stato, importazione senza duplicati, nuova carta in un set esistente, esclusione Pocket e conservazione di una foto manuale salvata mentre il worker lavora.

Build: `npm run build` con le variabili Vercel del proprio progetto.

Next.js ed eslint-config-next sono aggiornati alla patch 14.2.35, mantenendo React 18 e la struttura del progetto.
