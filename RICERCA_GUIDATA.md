# Spiegazioni dei risultati e domande successive

La pagina `/identifica` confronta le risposte Sì/No con i fatti documentati di ogni singola voce dell'indice. Mostra separatamente indizi compatibili, differenti e sconosciuti. Una risposta No conta come indizio; un dato mancante non viene trasformato in No. Le differenze aiutano il confronto e non eliminano automaticamente una carta.

Una domanda successiva viene proposta solo se, fra i risultati della pagina corrente, esistono sia un Sì sia un No documentati. Sono privilegiate le domande che separano meglio i risultati noti; le incognite non vengono assegnate a uno dei due gruppi. Le domande già risposte o saltate sono escluse. “Non so, altro indizio” non modifica il punteggio di ricerca. I conteggi si riferiscono esplicitamente alle voci visibili della pagina, non a tutte le corrispondenze né alle carte Pokémon uniche.

Ogni risultato indica la provenienza dei dati: dati base, dati di fonte oppure revisione registrata. I collegamenti di prova ammettono HTTPS senza credenziali. La foto generica di una carta è etichettata come riferimento; la foto assegnata a una stampa non viene presentata come certificazione d'identità. Un errore di caricamento non lascia il badge “foto disponibile”.

La modifica non cambia la classificazione nel database, i punteggi della RPC o le identità delle carte. Non vengono mostrate percentuali di certezza non calibrate. I test sono in `tests/identification-evidence.test.mjs`.
