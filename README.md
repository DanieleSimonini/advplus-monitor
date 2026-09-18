# GuideUp

Monitor commerciale della rete AdvisoryPlus: lead, attività, appuntamenti,
obiettivi e produzione in un'unica applicazione.

> *Turn process into progress.*

## Stack

- **React 18 + TypeScript + Vite** — nessuna dipendenza UI esterna
- **Supabase** — autenticazione, Postgres con RLS, Edge Functions
- **Vercel** — hosting statico + una funzione serverless (`api/set_password`)

## Avvio in locale

```bash
npm install
cp .env.example .env        # e compila le due variabili
npm run dev                 # http://localhost:5173
```

Variabili d'ambiente richieste (anche su Vercel):

| Variabile | Dove si trova |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public |

La funzione `api/set_password` richiede inoltre, **solo lato server su Vercel**:

| Variabile | Note |
|---|---|
| `SUPABASE_URL` | stesso valore di `VITE_SUPABASE_URL` |
| `SUPABASE_ANON_KEY` | stesso valore di `VITE_SUPABASE_ANON_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | **segreto**: non va mai esposto al browser |

Le Edge Function in `supabase/functions/` usano i propri secret su Supabase:
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`.

## Comandi

```bash
npm run dev         # sviluppo
npm run typecheck   # solo controllo dei tipi
npm run build       # typecheck + build di produzione in dist/
npm run preview     # anteprima della build
```

## Struttura

```
src/
├── styles/         Design system: token, reset, componenti, shell
├── ui/             Libreria componenti React (Button, Card, Modal, Toast…)
├── app/            AppShell (sidebar, topbar) e controlli condivisi
├── auth/           AuthProvider: sessione + profilo advisor
├── lib/            datetime, format, domain, db, router, useAdvisors
└── pages/          Una cartella/file per sezione dell'applicazione
api/                Funzione serverless Vercel
supabase/functions/ Edge Function Deno (invito e email appuntamenti)
```

### Design system

Tutti i colori, gli spazi e i caratteri stanno in `src/styles/tokens.css` come
variabili CSS. I componenti non contengono mai un colore scritto a mano: si
cambia il token e cambia l'intera applicazione.

Palette di marca, presa dai loghi ufficiali:

| Token | Valore | Uso |
|---|---|---|
| `--gu-brand-900` | `#011750` | navy, sfondi scuri e titoli |
| `--gu-brand-600` | `#0029AE` | colore d'azione (pulsanti, link) |
| `--gu-accent-500` | `#26C2A9` | teal, esiti positivi e obiettivi raggiunti |
| `--gu-accent-300` | `#3BEEE2` | aqua, accenti su fondo scuro |
| `--gu-red-500` | `#E63A34` | rosso del marchio, errori e azioni distruttive |

## Ruoli

| Ruolo | Vede | Modifica |
|---|---|---|
| **Junior** | i propri lead e obiettivi | i propri lead; obiettivi in sola lettura |
| **Team Lead** | sé stesso e i Junior del proprio team | lead del team, obiettivi dei propri Junior |
| **Admin** | tutta la rete | tutto, più la gestione utenti |

La visibilità reale è imposta dalle policy RLS su Supabase: l'interfaccia si
limita a non proporre azioni che il database rifiuterebbe.

## Note operative

- Le date e le ore passano **sempre** da `src/lib/datetime.ts`: è l'unico punto
  in cui si converte fra il valore di un campo `datetime-local` e il formato
  del database.
- `proposals.ts` e `contracts.ts` sono colonne `date` (senza orario), le altre
  sono `timestamptz`: i filtri di periodo ne tengono conto.
- Le liste lunghe sono impaginate lato server e le query con molti id vengono
  spezzate in blocchi (`src/lib/db.ts`).

## Flusso di lavoro

Non si scrive mai direttamente su `main`:

```bash
git checkout -b feat/...     # oppure fix/...
git commit
git push -u origin <branch>
```
