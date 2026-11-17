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

## Passaggio del sito

Una copia verificata non equivale ancora al passaggio delle API. Il rapporto riporta esplicitamente `cutover: false`. Prima di cambiare il sito occorrono il livello di compatibilità per le richieste di ricercaDB, la protezione delle scritture manuali e l'adattamento degli importatori. La copia originale Supabase va conservata finché questi controlli non sono completati.

Il piano gratuito Turso ha limiti di spazio e operazioni. I successivi aggiornamenti devono modificare soltanto righe effettivamente cambiate e conservare un registro tecnico limitato, evitando di riscrivere continuamente l'intero catalogo.
