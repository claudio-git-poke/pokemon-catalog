# Bindex Catalogo Foto Pokémon

Applicazione per gestire le foto mancanti delle carte Pokémon (set asiatici + MFB).

## Setup

1. Copia `.env.example` in `.env.local` e verifica le chiavi.
2. `npm install`
3. `npm run dev`

## Deploy su Vercel

1. Crea un repo GitHub e pusha questo codice.
2. Su Vercel importa il repo.
3. Aggiungi le Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (la publishable key)
4. Deploy.

## Funzionalità attuali

- Dashboard con statistiche
- Elenco filtrabile di tutte le 7210 carte
- Pagina "Senza foto"
- Dettaglio carta con possibilità di:
  - Inserire URL foto
  - Segnare come placeholder
  - Aggiungere note
  - Cambiare stato

## Prossimi passi (da implementare)

- Ricerca automatica aggressiva delle immagini
- Upload diretto su Supabase Storage
- Job batch per processare le mancanti
