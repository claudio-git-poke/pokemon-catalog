# Catalogo per Bindex: identità, lingua e fotografia

Obiettivo: carte fisiche Pokémon TCG e versioni documentate, con immagini corrispondenti a versione e lingua. Nessun totale di righe importate dimostra da solo la completezza mondiale.

## Le identità hanno compiti diversi

- La terna Bindex `(sigla, numero, variante)` resta immutabile. Le collezioni e le preferenze degli utenti continuano a usare questa chiave. Per gli internazionali le lingue non diventano nuovi set; per gli asiatici e MFB non si sostituisce l’ordinale Cardmarket con il numero stampato.
- Il nuovo `record_key` identifica una dichiarazione di fonte già presente nell’indice. Non identifica automaticamente una carta fisica unica: due fonti possono descrivere la stessa stampa. Non può essere rinominato e una rimozione viene esportata come `deleted=true`.
- Una dichiarazione viene collegata alla terna soltanto attraverso i collegamenti di pubblicazione del processo canonico, controllando anche eventuali sospensioni e conflitti di variante. Un ID Cardmarket condiviso non basta a fondere normale e reverse. `canonical_key=null` segnala che il collegamento è ancora da stabilire o rivedere; non autorizza Bindex a inventare una nuova terna per le collezioni.

## Il modello non moltiplica le combinazioni

`catalog_printing_inventory` contiene `scope`, lingua reale o `und`, numero stampato, set sorgente, anno, prodotto/distribuzione, mazzo, attributi di variante, tag, osservazioni, fonte, chiave canonica eventuale e dati delle immagini.

- `scope=printing`: la fonte dichiara una finitura o un’emissione con finitura documentata. Non significa che tutte le altre differenze della carta siano note.
- `scope=card`: ci sono metadati della carta ma non abbastanza informazioni sulla versione. In particolare Atlas non viene trasformato automaticamente in una stampa normale.
- `language=und`: lingua sconosciuta o dichiarazioni discordanti. INT è un gruppo, non una lingua di stampa; non viene espanso in IT/EN/FR/DE/ES/PT. Una lingua della carta originale non prova quella di una ristampa promozionale.
- L’assenza di un attributo significa sconosciuto, non `false`. Le disponibilità lingua/versione non vengono ottenute dal prodotto cartesiano degli elenchi.

Le versioni asiatiche senza ordinale canonico sono ora leggibili come dichiarazioni di fonte, restando sospese per le operazioni che richiedono la terna. Questo conserva i dati senza aggirare il contratto Bindex.

## Le immagini sono prove separate

| Campo | Significato |
|---|---|
| `image_url`, stato `verified` | Foto con ambito versione+lingua esplicito e revisione della foto distinta dalla revisione dei tag |
| `image_url`, stato `candidate` | La fonte la associa esplicitamente a versione+lingua, ma la foto non è ancora revisionata |
| `image_status=missing` | Nessuna foto specifica accettata per questa dichiarazione |
| `reference_image_url` | Riferimento generico, anche della carta originale; non completa la foto della versione |
| `image_evidence` | Ambito, lingua e fonte del collegamento alla foto |

Una generica immagine di TCGdex non viene riutilizzata come prova per normal, holo, reverse e ristampe. `reference_image_only` prevale sulla disponibilità di un URL. Foto di lingua diversa, placeholder e URL con credenziali non vengono accettati come foto specifiche. Il publisher v1 usa ora lo stesso controllo. Le foto legacy non vengono cancellate, né la loro lingua INT viene reinterpretata come una lingua reale.

Il nuovo flusso registra le foto mancanti; non certifica automaticamente uno stampino da una foto generica e non sostiene di aver già reperito tutte le scansioni. Il reperimento di nuove prove fotografiche e le identità ancora sospese restano lavori effettivi da completare.

## Alimentazione automatica e retroattiva

`Inventario versioni e lingue Bindex` avvia una sessione di massimo otto minuti, ogni mezz’ora e sulle modifiche del worker. Il primo caricamento scorre gli indici esistenti a piccoli lotti. In seguito i trigger accodano soltanto i record cambiati, comprese immagini della carta e collegamenti canonici. La conferma della coda controlla il timestamp richiesto: una modifica arrivata durante l’elaborazione non viene persa. Ripetere un lotto è sicuro; una foto revisionata non viene sostituita da dati più deboli della stessa lingua.

Non vengono eseguiti conteggi globali a ogni lotto o consultazione. Le tabelle interne di lavoro sono accessibili solo al servizio; l’inventario e il feed sono leggibili anonimamente.

## Lettura da Bindex

Il feed v1 esistente per `set_carte`, `set_espansioni` e `set_carte_immagini` resta disponibile. Il nuovo feed aggiuntivo è:

`GET /api/bindex/printings?limit=200`

Contratto `bindex-printings-v1`, `record_type=source_evidence`. La risposta include `until`, `items`, `next_cursor={time,key}` e `complete`. Nelle richieste successive usare lo stesso `until` e passare `after=next_cursor.time`, `key=next_cursor.key`, codificati come parametri URL. Il cursore è composto: mantenere tutti i microsecondi del timestamp. Una pagina piena richiede la pagina successiva; `complete` descrive solamente il completamento della finestra di esportazione, non la completezza del catalogo.

Il consumatore deve:

1. Conservare le dichiarazioni per `record_key`, senza contarle come carte uniche.
2. Raggruppare solo quelle con `canonical_mapping_status=linked` per `canonical_key` e lingua; tenere le non collegate in una sezione di identificazione/attesa.
3. Mostrare separatamente versioni descritte, metadati senza versione e lingue sconosciute.
4. Mostrare le foto generiche come riferimenti, le candidate come da verificare e le revisionate come tali.
5. Confermare il checkpoint soltanto dopo avere salvato tutte le pagine della finestra; applicare anche le rimozioni logiche.

La connessione Supabase disponibile espone solo il progetto catalogo. Il nuovo endpoint sul catalogo non equivale all’attivazione della copia o della nuova interfaccia nel progetto Bindex: questa integrazione lato consumatore deve essere effettuata esplicitamente. `/api/bindex/status` distingue compatibilità del contratto da completezza del catalogo e non dichiara verificata la copia sul destinatario.

## Criteri di completamento

Il lavoro sui dati si misura per espansione/prodotto × versione × lingua documentata: identità risolta, foto specifica reperita, foto verificata, oppure lacuna esplicitamente aperta. Le fonti devono conservare prove e date. Non si può chiamare completo un gruppo perché il suo elenco principale concorda, perché possiede tag o perché ha una miniatura generica.
