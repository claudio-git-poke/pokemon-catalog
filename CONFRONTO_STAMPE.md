# Scheda delle stampe e provenienza

Nella scheda di una carta, la sezione “Stampe, differenze e fonti” distingue i dati generali (ad esempio Card Atlas) dalle voci che documentano una variante. La selezione non unisce tag di righe diverse e non aggiorna il database.

Per ogni voce mostra fonte HTTPS senza credenziali, tipo di documentazione e data di indicizzazione. Finitura, motivo olografico, stampino/firma, famiglia, rarità, meccanica, regolamento e mazzo sono espliciti; l'assenza di un tag diventa “Non documentato”, mai “Normale” o “Senza stampino”. Tutti gli indizi visivi restano consultabili, inclusi quelli sconosciuti.

Il confronto è facoltativo e riguarda due voci della stessa carta. Un campo coincide o differisce solo se presente in entrambe; altrimenti resta “Da verificare”. Le voci possono documentare la stessa stampa da fonti diverse. Il confronto non è una deduplicazione o una certificazione automatica.

“Copia link a questa stampa” conserva la chiave esatta della voce e porta alla sezione `#stampe`. Se un link indica una voce non disponibile per quella carta, l'interfaccia avvisa e richiede di selezionarne una, senza sostituirla silenziosamente.

La foto generale della scheda non certifica tutte le sue varianti. La sezione distingue una foto associata alla voce da un riferimento generico o da una foto esatta assente. Non modifica immagini, codici, identità o stato di verifica.

Test: `tests/printing-evidence.test.mjs`, con casi su dati generali, informazioni mancanti, finiture diverse, caratteristiche condivise e link alla voce corretta.
