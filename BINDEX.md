# Contratto di lettura Bindex, versione 1

Il database del catalogo contiene ora una pubblicazione canonica separata dalle
sorgenti grezze `cards` e `catalog_search_entries`. La pubblicazione parte dalla
fotografia verificata di Bindex del 14 novembre 2026: 294 set, 47.373 terne uniche.
Bindex non viene modificato dal catalogo. La lettura iniziale è un bootstrap;
il worker successivamente legge solo il proprio database e le fonti delle carte.

## Endpoint REST del catalogo

Base: `https://vjpvbsvpumzrqzoupxee.supabase.co/rest/v1/`
Usare `apikey: <chiave pubblica/anon del catalogo>`. Nessuna service_role al consumer.

- `set_carte`: sigla, numero, variante, nome, rarita, codice, cardmarket_id,
  cardmarket_url, immagine, immagine_hd, tag, aggiornato_il, eliminata.
- `set_espansioni`: sigla, tcgdex_id, nome, carte_base, carte_totali, data_uscita,
  lingua, aggiornato_il.
- `set_carte_immagini`: sigla, numero, variante, lingua, immagine, immagine_hd,
  fonte, aggiornato_il; il campo aggiuntivo `verificata` distingue le foto
  certificate per la stampa dalle immagini preesistenti non ricontrollate.
- `catalog_export_state`: leggere `ready=true` prima di iniziare una copia.
- Stato leggibile anche in `/api/bindex/status` sul sito del catalogo.

Le nuove tabelle di pubblicazione consentono solo SELECT ad anon/authenticated.
Le evidenze `catalog_export_links` e la coda `catalog_export_pending` sono private
al worker. Le tabelle di gestione preesistenti del sito rimangono separate: non
usarle come API di copia e non usarne le terne come identità canoniche.

## Identità e immagini

La terna `(sigla,numero,variante)` è una chiave primaria immutabile. Un cambio
non viene accettato dal database. Le carte pubblicate non vengono cancellate:
`eliminata=true` mantiene la chiave disponibile al consumer. Le foto si rimuovono
mettendo a null i rispettivi URL, conservando la riga e il timestamp.

Per INT si mantiene una sola identità europea. MFB e i set asiatici conservano le
posizioni già usate da Bindex: non si sostituiscono con i numeri della fonte.
I set promo conservano le sigle reali, compreso `BOO` per il 2022. Le vecchie chiavi
`normale` non provano una finitura non olografica: i tag restano un'informazione
separata. Nessun ID Cardmarket viene accettato senza verificarne anche l'identità.

`immagine_verificata=false` sulle foto ereditate dal riferimento iniziale significa
che sono state preservate, non certificate come scansioni esatte. Il worker non
sostituisce una foto con una scansione generica di un'altra finitura. Una nuova
foto viene pubblicata solo da un collegamento a una stampa precisa.

I codici ordinari mancanti sono stati ricavati dalle regole confermate (sigla e
numero stampato). I 135 codici promozionali non ricostruibili con certezza restano
null: le loro identità preesistenti restano valide. Le nuove righe senza una terna
verificabile non vengono pubblicate e finiscono nella coda privata.

## Copia incrementale

Leggere una tabella per volta in ordine stabile:
`order=aggiornato_il.asc,sigla.asc,numero.asc,variante.asc`, con pagine fino a 1000
righe. Per i set usare `order=aggiornato_il.asc,sigla.asc`; per le foto aggiungere
`lingua.asc`. Prima del giro fissare un limite superiore temporale `fino_a` e
leggere `aggiornato_il > cursore` e `aggiornato_il <= fino_a`. Avanzare il cursore
solo dopo aver letto e salvato tutte le pagine; in caso di errore ripetere il giro
con upsert sulla chiave primaria. Per gestire scritture concorrenti e timestamp
uguali usare una piccola sovrapposizione temporale o un cursore composto completo.
Non filtrare `eliminata=false`: il consumer deve ricevere anche le tombstone.

Ogni variazione reale dei campi esportati aggiorna il timestamp mediante trigger.
Un upsert identico è un no-op. Il worker non cancella righe quando una fonte
sparisce o fallisce temporaneamente.

## Installazione e manutenzione

Schema additivo: `db/bindex-export.sql`. Dopo tutte le pagine, eseguire
`db/bindex-bootstrap-finish.sql`: verifica il digest e abilita la pubblicazione
solo se tutte le chiavi coincidono. La finalizzazione iniziale è specifica della
fotografia del 14 novembre 2026; non va riutilizzata dopo che il worker ha
pubblicato nuove carte. Preparazione del bootstrap:

```
node --experimental-strip-types scripts/prepare-bindex-reference.mjs sets.json cards.json directory-sql
```

Lo script valida tutte le chiavi e produce pagine SQL idempotenti e un digest
MD5 delle sole identità ordinate, da confrontare sul database prima di segnare
`ready=true`. Il bootstrap non viene ripetuto automaticamente e non sovrascrive
modifiche già presenti. Il worker chiama `publishBindex` dopo ogni ciclo, usa un
cursore composto e riprova dopo un giorno gli abbinamenti incerti. I nuovi alias
non confermati e le posizioni asiatiche senza pagina verificata restano sospesi.
