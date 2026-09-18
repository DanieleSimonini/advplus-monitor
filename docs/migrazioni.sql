-- ============================================================================
-- GuideUp — migrazioni da applicare
--
-- Da eseguire su Supabase → SQL Editor, una sezione per volta, controllando
-- dopo ognuna che l'applicazione funzioni. Prima di cominciare:
-- Database → Backups.
--
-- L'interfaccia è già pronta per tutte e tre e continua a funzionare anche
-- senza: i campi che dipendono da una colonna non ancora esistente vengono
-- disattivati e ignorati in scrittura, non mostrano errori.
-- ============================================================================


-- ============================================================================
-- 1. ESITO DELL'APPUNTAMENTO
--
-- Perché serve: la tabella `appointments` dice quando un incontro è stato
-- FISSATO, non se è stato fatto. L'imbuto della Dashboard e il "tasso di
-- chiusura" mettevano quindi al denominatore anche gli appuntamenti andati a
-- vuoto, e nessuno poteva sapere quanti fossero.
--
-- Il valore predefinito 'scheduled' descrive correttamente lo storico: di
-- quegli appuntamenti sappiamo solo che erano stati fissati.
-- ============================================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'scheduled';

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_outcome_check;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_outcome_check
  CHECK (outcome = ANY (ARRAY['scheduled', 'done', 'noshow', 'canceled']));


-- ============================================================================
-- 2. ESITO DELLA PROPOSTA
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

-- Facoltativo, da valutare: una proposta su un lead che ha poi firmato è
-- ragionevolmente un'accettata. Da eseguire solo se la lettura convince — sono
-- nove righe in tutto, si possono anche sistemare a mano dall'interfaccia.
--
--   UPDATE public.proposals p
--      SET outcome = 'accepted'
--    WHERE p.outcome = 'pending'
--      AND EXISTS (SELECT 1 FROM public.contracts c
--                   WHERE c.lead_id = p.lead_id AND c.ts >= p.ts);


-- ============================================================================
-- 3. CANALI DI CONTATTO
--
-- Il vincolo su `activities.channel` ammette phone, email, inperson, video.
-- La vecchia interfaccia mostrava anche WhatsApp, SMS e "Altro" ma li salvava
-- tutti e tre come 'phone': una volta scritti non erano più distinguibili,
-- quindi qualsiasi analisi per canale era falsa. Nei dati: 297 phone, 45 email.
--
-- Dopo questa migrazione vanno aggiunte le due voci in src/lib/domain.ts,
-- nell'elenco CHANNELS. Lo storico resta 'phone': non è recuperabile.
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
-- salvataggi ripartono senza quelle colonne.
-- ============================================================================
