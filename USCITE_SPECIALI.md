# Controllo delle uscite speciali

Il workflow `special-release-audit.yml` rilegge gli elenchi BOO/Trick or Trade, Prize Pack, Battle Academy, Mondiali e le identità My First Battle. Pubblica il risultato completato in `catalog_special_release_audit`; la sezione **Uscite speciali** in `/copertura` lo legge con la chiave anonima. Un errore mantiene il precedente risultato. Scrittura riservata ai worker, RLS abilitata, nessuna funzione privilegiata.

## Collegamenti alle carte

Il risolutore cerca prima gli identificativi originali TCGdex inglesi, con varianti documentali della formattazione numerica. Una correzione manuale di nome, sigla o lingua non rende irriconoscibile l’identità originale. Se più identificativi corrispondono, il caso rimane sospeso. Soltanto in assenza di un identificativo esatto è consentito il ripiego su una riga legacy senza fonte, con espansione, numero e nome coerenti e un solo candidato. Non si sceglie mai arbitrariamente la prima riga e non si riscrivono le carte per farle coincidere con la fonte.

Le identità MFB già collegate tramite `source_card_id` possono recuperare i metadati anche quando non hanno `source_uid`. La risposta deve confermare lo stesso identificativo. L’ordinale interno del masterset non viene usato come numero stampato. Il recupero aggiorna le evidenze e i checkpoint, lasciando nome, classificazioni e immagini manuali alle protezioni esistenti.

## Conteggi e casi sconosciuti

- **Voci documentate:** righe negli elenchi sorgente; possono contenere copie ripetute nello stesso mazzo.
- **Copie ripetute:** voci con la stessa uscita, mazzo, posizione, origine, nome e finitura; non sono stampe mancanti. Le posizioni numerate diverse di Battle Academy restano separate.
- **Stampa da identificare:** mancano espansione o numero della stampa originale, ad esempio alcune energie. Il nome “Fire Energy” non basta ad associare un’immagine o una ristampa.
- **Identità fonte non collegate:** la stampa ha un identificativo documentato ma non trova una carta univoca.
- **Stampe indicizzate:** evidenze della fonte presenti nella ricerca.
- **Collegamenti canonici:** evidenze associate alle chiavi immutabili del catalogo pubblicato.

Le uscite canoniche che non hanno ancora un elenco documentato, comprese le serie PPS successive ai manifest disponibili, restano **non rilevate**. Le righe già presenti nel masterset non diventano una certificazione di copertura. Il controllo riguarda gli elenchi inglesi registrati e non deduce altre lingue, finiture o nuove uscite. Le foto generiche delle carte non sono foto esatte delle uscite.

## Pubblicazione e precedenza manuale

Una coda dedicata porta in pubblicazione solo corrispondenze determinate dal risolutore canonico esistente e prive di un collegamento già pubblicato. Il controllo non sostituisce le identità presenti, non forza casi ambigui e non avanza il cursore generale del catalogo: la coda mondiale può continuare dal suo punto. Le righe con correzioni manuali richiedono una mappatura esplicita quando l’identità non è determinabile. Tutte le scritture usano le protezioni già installate; tag, nomi, foto e scelte manuali prevalgono.

La sessione esegue prima il recupero delle evidenze, poi i collegamenti certi, quindi salva insieme il rapporto finale. Il workflow parte quando cambia il relativo codice, manualmente e ogni sei ore. I ritardi GitHub sono possibili; una singola esecuzione attiva evita sovrapposizioni dello stesso controllo. Non attende la sessione lunga dell’importatore generale.

Installazione additiva e ripetibile: `db/special-release-audit.sql`. Il workflow riusa i secrets Supabase del catalogo.
