# Bindex Catalogo Foto Pokémon — v5

## Fix

- Risolto errore TypeScript: `Type 'Set<string>' can only be iterated through when using the '--downlevelIteration' flag`
- Cambiato `[...new Set(...)]` → `Array.from(new Set(...))`
- Aggiornato `tsconfig.json` con `target: ES2017` e `downlevelIteration: true`

Tutto il resto rimane uguale a v4 (Next.js 14.2.18 + ricerca aggressiva).
