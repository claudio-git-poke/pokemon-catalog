# Pokémon TCG — registro simboli per Bindex

## Ambito e stato reale
Questo modulo è la prima implementazione, **non** un archivio completo di tutti i simboli.
Il comando `node scripts/symbols/sync-tcgdex-symbols.mjs` legge gli elenchi delle espansioni
TCGdex nelle 11 lingue già previste dal catalogo. Scrive
`data/symbols/tcgdex.json` tramite sostituzione atomica; conserva i dati precedenti
se una lingua fallisce. Non modifica Supabase e non scrive nel repository Bindex.

Il file ha ID del set TCGdex, nomi per lingua, URL PNG dei simboli di espansione e
dei loghi (distinti), conteggi delle carte e report di errori. Gli URL sono
**riferimenti**, non file locali scaricati. Un simbolo assente resta assente:
non viene inventato. I loghi possono variare tra lingue; i simboli
normalmente sono condivisi, ma conserviamo comunque la provenienza.

## Tassonomia prevista
`data/symbols/manual-registry.json` è il registro curato per categorie:
`set_symbol`, `set_logo`, `rarity`, `edition_stamp`, `promo_stamp`,
`event_stamp`, `regional_stamp`, `mechanic`, `energy`, `type`,
`regulation_mark`, `other_mark`.
Non confondere queste classi con *finiture* (holo, reverse, texture) o
*varianti di stampa* prive di simbolo grafico, che restano metadati separati.

Formato proposto di un record manuale:
```json
{
  "id": "promo-stamp:provider:stable-id",
  "category": "promo_stamp",
  "names": { "en": "Name" },
  "images": [{ "url": "https://...", "format": "png", "source": "Provider" }],
  "languages": ["en"],
  "sources": [{ "url": "https://...", "checkedAt": "YYYY-MM-DD" }],
  "status": "verified"
}
```
Le associazioni alle carte vanno in `associations` con un identificativo
di stampa **(sigla, numero, variante)** quando validato. Nessun collegamento
automatico tramite il solo nome; niente prodotto cartesiano di timbri e
finiture. Le chiavi Bindex sono distinte dagli ID TCGdex: occorre una
mappatura verificata prima di applicare le associazioni sul sito.

## Esecuzione e verifiche
```sh
node scripts/symbols/sync-tcgdex-symbols.mjs
node --test tests/symbols.test.mjs
```
Il processo richiede internet. Usa le immagini ospitate da TCGdex con le
relative condizioni d'uso; non dichiara diritti di redistribuzione.
Mancano ancora la verifica puntuale della disponibilità di ogni PNG, il
censimento dei timbri e il collegamento alle stampe del database vivo.
Non dichiarare il catalogo completo finché le fonti e ogni variante non
sono state confrontate.
