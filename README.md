# Bindex Catalogo Foto Pokémon — v4

## Cambiamenti principali

- **Next.js aggiornato a 14.2.18** (risolve l’avviso di vulnerabilità di Vercel)
- Tutto il resto di v3 (ricerca aggressiva, batch, placeholder, ecc.) rimane invariato

## Variabili d’ambiente su Vercel

```
NEXT_PUBLIC_SUPABASE_URL=https://vjpvbsvpumzrqzoupxee.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_B_ubYuMqes4g7e0q7YWnLQ_SJEyNdAU
SUPABASE_SERVICE_ROLE_KEY=sb_secret_8mdJzKncG5ztGHLy3i_riw_yYRLEPBO
```

## Come aggiornare

1. Sostituisci i file del progetto con quelli di questa cartella `v4`
2. Fai commit + push
3. Vercel farà il redeploy automatico

Dopo il deploy l’avviso “Vulnerable version of Next.js” dovrebbe sparire.
