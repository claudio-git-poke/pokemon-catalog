# Bindex Catalogo Foto Pokémon — v3

## Novità v3 (ricerca aggressiva)

La ricerca automatica ora prova in cascata:

1. **Estrazione og:image / twitter:image** dalla pagina Cardmarket della carta (quando il link è presente)
2. Pattern di URL noti / CDN (estendibile)
3. Costruzione di multiple query di ricerca
4. Se tutto fallisce → **placeholder** con nota dettagliata dei tentativi fatti

### Comportamento

- Pulsante “🔍 Cerca automaticamente” sulla singola carta
- Batch sulla pagina “Senza foto” (max 10 per volta per non saturare i timeout)
- Le carte già in stato `found` o `manual` vengono saltate
- Tutto viene loggato nelle note della carta

### Variabili d’ambiente su Vercel

```
NEXT_PUBLIC_SUPABASE_URL=https://vjpvbsvpumzrqzoupxee.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_B_ubYuMqes4g7e0q7YWnLQ_SJEyNdAU
SUPABASE_SERVICE_ROLE_KEY=sb_secret_8mdJzKncG5ztGHLy3i_riw_yYRLEPBO
```

### Come aggiornare

Sostituisci i file del progetto con quelli di questa cartella `v3` → commit + push → Vercel ridistribuisce.

### Prossimi miglioramenti possibili

- Integrazione Google Custom Search / Bing (serve API key)
- Fonti giapponesi e coreane specifiche
- Upload automatico dell’immagine trovata su Supabase Storage
- Job notturno che continua a processare le placeholder
