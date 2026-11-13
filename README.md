# Bindex — catalogo automatico

Per attivare importazioni e ricerca immagini periodiche, leggere **ATTIVAZIONE.md**. La copertura delle fonti è descritta in **FONTI.md**.

# Bindex Catalogo Foto Pokémon — v8

## Novità principali

1. **TCGdex** come fonte primaria di immagini (API pubblica e affidabile)
2. Selettore lingua in evidenza, **partenza da INT (inglese)**
3. Tutti i link di dettaglio puntano a `/carta/[id]`
4. Log verbosi in console

## Come testare

1. Deploy di v8
2. Vai su **Senza foto**
3. Lascia selezionato **INT (EN)**
4. Clicca **Cerca batch**
5. Apri F12 e guarda i log: dovresti vedere chiamate a `api.tcgdex.net`

Le carte MFB (INT) e molte inglesi dovrebbero iniziare a trovare le immagini.
