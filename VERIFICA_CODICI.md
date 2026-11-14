# Verifica dei 135 codici promozionali — 14 novembre 2026

Esito sul catalogo di esportazione: **73 codici compilati**, **44 casi senza
codice nelle liste consultate**, **18 casi ancora da identificare sulla stampa
esatta**. Tutte le 47.373 chiavi originali sono rimaste identiche.

## Metodo e limiti

I codici compilati sono stati incrociati tra gli identificativi presenti negli
indirizzi dei prodotti Cardmarket già registrati in Bindex e le liste dei mazzi
2020, 2022 e 2019 conservate nei manifest del progetto. Quando l'indirizzo non
riportava un codice, è stata accettata soltanto un'identità unica nella lista
completa del prodotto. I nomi tradotti non sono stati usati da soli per associare
una carta; V1/V2/V3 non sono stati trasformati in numeri stampati.

Sono stati consultati risultati indicizzati di Cardmarket, ma l'apertura diretta
delle pagine prodotto in questa sessione è stata bloccata da Cloudflare. Non è
quindi una certificazione visiva delle scansioni Cardmarket e non tutte le pagine
sono state lette live. Nessun tentativo è stato fatto per aggirare il blocco.

Per le Energie PPS3 la checklist ufficiale Pokémon omette il codice. Le liste
pubblicate di PPS1/PPS2 e BA20/BA22 hanno lo stesso limite per le 28 Energie
rimanenti. Per PPS1/PPS2 il PDF ufficiale collegato ha richiesto un controllo di
sicurezza: il riscontro disponibile è la lista pubblicata su Bulbapedia. Lo stato
`no_code_in_source` significa esattamente questo; **non certifica che su qualsiasi
stampa della carta non esista mai un numero**.

Dettagli macchina e fonti: `data/bindex-code-reviews.json`. Nel database si leggono
in sola lettura da `catalog_code_reviews`. Lo stato `verified` riguarda il codice
originale, non la finitura, il timbro o la foto di tutte le versioni.

## Casi ancora incerti

| Chiave Bindex | Carta | Motivo |
|---|---|---|
| WCD11 · 1 · normale | Energia Fuoco | Serve distinguere la stampa/variante esatta. |
| WCD11 · 2 · normale | Energia Fuoco | Serve distinguere la stampa/variante esatta. |
| WCD11 · 3 · normale | Energia Fuoco | Serve distinguere la stampa/variante esatta. |
| WCD11 · 4 · normale | Energia Lampo | Serve distinguere la stampa/variante esatta. |
| WCD11 · 5 · normale | Energia Lampo | Serve distinguere la stampa/variante esatta. |
| WCD11 · 6 · normale | Energia Lotta | Serve distinguere la stampa/variante esatta. |
| WCD24 · 1 · normale | Ricerca Accademica - Professor Turum | Serve distinguere la stampa/variante esatta. |
| WCD24 · 2 · normale | Ricerca Accademica - Professor Turum | Serve distinguere la stampa/variante esatta. |
| WCD25 · 98 · normale | Energia base Erba | Serve distinguere la stampa/variante esatta. |
| WCD25 · 99 · normale | Energia base Erba | Serve distinguere la stampa/variante esatta. |
| WCD25 · 100 · normale | Energia base Fuoco | Serve distinguere la stampa/variante esatta. |
| WCD25 · 101 · normale | Energia base Lampo | Serve distinguere la stampa/variante esatta. |
| WCD25 · 102 · normale | Energia base Lampo | Serve distinguere la stampa/variante esatta. |
| WCD25 · 103 · normale | Energia base Lotta | Serve distinguere la stampa/variante esatta. |
| WCD25 · 104 · normale | Energia base Metallo | Serve distinguere la stampa/variante esatta. |
| WCD25 · 105 · normale | Energia base Psico | Serve distinguere la stampa/variante esatta. |
| WCD25 · 106 · normale | Munkidori | Serve distinguere la stampa/variante esatta. |
| WCD25 · 107 · normale | Ricerca Accademica - Professoressa Olim | Serve distinguere la stampa/variante esatta. |

## Applicazione e protezioni

Schema: `db/catalog-code-reviews.sql`, dopo `db/bindex-export.sql`.
Generazione della sola correzione dati verificata:

```
node scripts/prepare-code-review.mjs /tmp/apply-code-reviews.sql
```

Lo script controlla le identità e gli ID prodotto prima di scrivere e aggiorna
solo `codice` sulle righe approvate. Il trigger dei timestamp registra i cambiamenti.
I codici verificati sono protetti da scritture con cache precedenti. Anche i
worker già in esecuzione conservano le statistiche della verifica.
