# Bindex Catalogo Foto Pokémon — v7

## Fix principale

Cambiata la rotta di dettaglio da `/carte/[id]` a **`/carta/[id]`**.

Il 404 era quasi certamente causato da problemi con la cartella `[id]` durante il deploy (comune su Windows / certi upload).

### Nuove URL

- Lista: `/carte`
- Dettaglio: `/carta/1`, `/carta/2`, ...
- Home con ricerca rapida per ID o nome

### Cosa fare

1. Sostituisci TUTTI i file con quelli di questa cartella `v7`
2. Commit + push
3. Dopo il deploy prova ad aprire:
   - https://tuo-sito.vercel.app/carta/1
   - oppure usa il campo "Vai a ID" in home

Se funziona, i 404 spariscono.
