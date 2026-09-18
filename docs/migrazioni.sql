-- ============================================================================
-- GuideUp — migrazioni
--
-- Le sezioni 1 e 2 sono state APPLICATE il 18/09/2026 al progetto
-- `advplus-monitor-prod`, con la migrazione `esito_appuntamenti_e_proposte`,
-- e verificate sui dati reali (vedi "Verifica eseguita" in fondo).
-- Restano qui come registro e per il ripristino.
--
-- La sezione 3 non è stata applicata: va eseguita insieme alla modifica di
-- src/lib/domain.ts, altrimenti non produce nessun effetto visibile.
--
-- Per eseguire quel che resta: Supabase → SQL Editor → New query.
-- Prima di cominciare: Database → Backups.
-- ============================================================================


-- ============================================================================
-- 0. CONTROLLO PRELIMINARE — non modifica niente
--
-- Eseguito prima della migrazione: nessuna riga, cioè nessuna delle due
-- colonne esisteva già con valori che avrebbero fatto rifiutare il vincolo.
-- ============================================================================

SELECT table_name, column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('appointments', 'proposals')
   AND column_name = 'outcome';


-- ============================================================================
-- 1. ESITO DELL'APPUNTAMENTO — applicata
--
-- Perché serve: la tabella `appointments` dice quando un incontro è stato
-- FISSATO, non se è stato fatto. L'imbuto della Dashboard e il "tasso di
-- chiusura" mettevano quindi al denominatore anche gli appuntamenti andati a
-- vuoto, e nessuno poteva sapere quanti fossero.
--
-- Il valore predefinito 'scheduled' descrive correttamente lo storico: di
-- quegli appuntamenti sappiamo solo che erano stati fissati. La colonna ha un
-- default, quindi Postgres non riscrive la tabella: su 123 righe è istantaneo.
-- ============================================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'scheduled';

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_outcome_check;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_outcome_check
  CHECK (outcome = ANY (ARRAY['scheduled', 'done', 'noshow', 'canceled']));


-- ============================================================================
-- 2. ESITO DELLA PROPOSTA — applicata
--
-- Perché serve: fra proposta e contratto c'è il salto dell'imbuto dove si
-- perdono i soldi, ed era l'unico di cui non si potesse sapere il perché. La
-- proposta si registrava e poi spariva, accettata o rifiutata che fosse.
-- ============================================================================

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'pending';

ALTER TABLE public.proposals
  DROP CONSTRAINT IF EXISTS proposals_outcome_check;

ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_outcome_check
  CHECK (outcome = ANY (ARRAY['pending', 'accepted', 'rejected']));


-- ============================================================================
-- VERIFICA ESEGUITA — 18/09/2026, sui dati di produzione
--
--   Stato dopo la migrazione   123 appuntamenti tutti 'scheduled'
--                              9 proposte tutte 'pending'
--                              conteggi delle tabelle invariati
--                              (457 lead, 342 contatti, 27 contratti)
--
--   Privilegi                  `authenticated` ha SELECT/INSERT/UPDATE sulla
--                              colonna nuova: l'applicazione può scriverla
--
--   Scrittura sotto RLS        impersonando un Junior, dentro una transazione
--                              poi annullata: inserisce appuntamento con
--                              outcome='done' e proposta con outcome='accepted'
--                              sui propri lead, e li rilegge
--
--   Vincolo                    un valore inventato viene rifiutato da
--                              appointments_outcome_check e da
--                              proposals_outcome_check; zero righe fuori
--                              dai valori ammessi
--
-- Le query qui sotto rieseguono l'ultimo controllo.
-- ============================================================================

SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('appointments', 'proposals')
   AND column_name = 'outcome'
 ORDER BY table_name;

SELECT 'appointments' AS tabella, outcome, count(*) FROM public.appointments GROUP BY outcome
UNION ALL
SELECT 'proposals', outcome, count(*) FROM public.proposals GROUP BY outcome
 ORDER BY 1, 2;


-- ============================================================================
-- FACOLTATIVO — allineare lo storico delle proposte
--
-- Una proposta su un lead che ha poi firmato è ragionevolmente un'accettata.
-- Sono nove proposte in tutto: si possono anche sistemare a mano
-- dall'interfaccia, una per una, che è più affidabile di una supposizione.
-- Da eseguire solo se la lettura convince.
-- ============================================================================

-- UPDATE public.proposals p
--    SET outcome = 'accepted'
--  WHERE p.outcome = 'pending'
--    AND EXISTS (SELECT 1 FROM public.contracts c
--                 WHERE c.lead_id = p.lead_id AND c.ts >= p.ts);


-- ============================================================================
-- 3. CANALI DI CONTATTO — separata, non eseguire insieme alle altre
--
-- Il vincolo su `activities.channel` ammette phone, email, inperson, video.
-- La vecchia interfaccia mostrava anche WhatsApp, SMS e "Altro" ma li salvava
-- tutti e tre come 'phone': una volta scritti non erano più distinguibili,
-- quindi qualsiasi analisi per canale era falsa. Nei dati: 297 phone, 45 email.
--
-- Va eseguita INSIEME alla modifica di src/lib/domain.ts (aggiungere le due
-- voci all'elenco CHANNELS): il vincolo da solo non fa comparire niente
-- nell'interfaccia. Lo storico resta 'phone', non è recuperabile.
-- ============================================================================

-- ALTER TABLE public.activities DROP CONSTRAINT activities_channel_check;
-- ALTER TABLE public.activities ADD CONSTRAINT activities_channel_check
--   CHECK (channel = ANY (ARRAY['phone','email','inperson','video','whatsapp','sms']));


-- ============================================================================
-- COME TORNARE INDIETRO
--
--   ALTER TABLE public.appointments DROP COLUMN outcome;
--   ALTER TABLE public.proposals    DROP COLUMN outcome;
--
-- L'interfaccia torna a funzionare da sola: i due campi si disattivano e i
-- salvataggi ripartono senza quelle colonne, senza bisogno di ridistribuire.
-- ============================================================================
