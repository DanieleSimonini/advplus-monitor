# Adv+ Monitor

MVP frontend per la rete Junior Insurance Advisor.

## Requisiti
- **Supabase** progetto creato (hai già `admin1@advisoryplus.it` su `public.advisors`).
- Variabili ambiente (le metti su **Vercel**):
  - `VITE_SUPABASE_URL` = Project URL (Supabase → Settings → API)
  - `VITE_SUPABASE_ANON_KEY` = anon public key

## Deploy (senza terminale)
1. Carica questi file nel repo GitHub.
2. Vai su **Vercel → New Project → Import from GitHub** → seleziona il repo.
3. Aggiungi le **Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. **Deploy**.
5. Apri l’URL e fai login con `admin1@advisoryplus.it` (password impostata in Supabase Auth).

## Prossimi passi
- Collegare dati reali (Supabase) nelle pagine Leads, Report, Obiettivi, Import.
- Aggiungere **Admin → Utenti** per creare Team Lead e Junior senza codice.
- Configurare dominio `app.advisoryplus.it` su Vercel.
