# Bindex Catalogo Foto Pokémon — v2

## Novità in v2

- Pulsante **“Cerca automaticamente”** nella pagina dettaglio di ogni carta
- **Batch search** sulla pagina “Senza foto” (processa fino a 10 carte alla volta)
- Quando la ricerca non trova nulla → la carta viene segnata come **placeholder** con nota chiara
- API route `/api/search-image`

## Importante per il deploy

Nella dashboard di Vercel aggiungi anche questa variabile d’ambiente (opzionale ma consigliata per le operazioni di scrittura dal server):

```
SUPABASE_SERVICE_ROLE_KEY = sb_secret_8mdJzKncG5ztGHLy3i_riw_yYRLEPBO
```

(Se non la metti, usa comunque la publishable key, ma alcune operazioni potrebbero essere limitate dalle RLS).

## Come aggiornare

1. Sostituisci i file del progetto con quelli di questa cartella `v2`
2. Fai commit + push su GitHub
3. Vercel farà il redeploy automatico

## Limitazioni attuali della ricerca automatica

Al momento la ricerca è un **framework** pronto.
Le fonti reali di immagini per set JP / CHN / KOR sono limitate e spesso protette.

Quando vuoi possiamo aggiungere:
- Google Custom Search / Bing Image Search (serve API key)
- Fonti specifiche giapponesi/coreane
- Pattern di URL noti per certi set

Per ora il sistema:
1. Prova a cercare
2. Se non trova → mette **placeholder** + messaggio chiaro
3. Tu puoi intervenire manualmente inserendo l’URL
