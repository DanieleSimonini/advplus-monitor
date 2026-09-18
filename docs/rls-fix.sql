-- ============================================================================
-- GuideUp — correzione delle policy RLS
--
-- LEGGI PRIMA DI ESEGUIRE.
--
-- Non ho accesso al vostro database: questo script è scritto leggendo l'export
-- delle policy, non l'ho provato su dati reali. Va eseguito con attenzione,
-- seguendo l'ordine, e va verificato prima di confermarlo.
--
-- Come si esegue: Supabase → SQL Editor → nuova query. Ogni FASE è separata:
-- esegui una fase per volta e leggi il risultato prima di passare alla
-- successiva. Le fasi 1 e 2 sono dentro una transazione: finché non digiti
-- COMMIT non è cambiato niente, e con ROLLBACK torni indietro.
--
-- Perché queste modifiche sono meno rischiose di quanto sembri: in Postgres le
-- policy PERMISSIVE si sommano in OR. Le policy sbagliate che togliamo qui
-- hanno una gemella corretta che concede già l'accesso legittimo. Rimuovendole
-- sparisce il permesso in eccesso, non quello che serve a lavorare — tranne in
-- un caso, la cancellazione dei lead da parte del Team Lead, che infatti qui
-- viene ricreata correttamente.
-- ============================================================================


-- ============================================================================
-- FASE 0 — ISPEZIONE (sola lettura, non modifica niente)
-- Esegui questi tre blocchi e guarda i risultati prima di andare avanti.
-- ============================================================================

-- 0.1 Che cosa fanno davvero le funzioni usate dalle policy?
--     can_access_lead() è il perno di tutti i permessi su attività,
--     appuntamenti, proposte e contratti: se è scritta bene, i punti 1.2–1.5
--     sono sicuri. Se non lo è, fermati e sistemala prima.
SELECT p.proname,
       pg_get_functiondef(p.oid) AS definizione
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname IN ('can_access_lead', 'is_admin', 'current_user_role')
  AND n.nspname = 'public';

-- 0.2 Quante righe userebbero ancora la vecchia convenzione?
--     Se team_lead_id o reports_to sono valorizzati da qualche parte, prima di
--     eliminarli va capito chi li scrive.
SELECT count(*) FILTER (WHERE team_lead_id IS NOT NULL)      AS con_team_lead_id,
       count(*) FILTER (WHERE reports_to IS NOT NULL)        AS con_reports_to,
       count(*) FILTER (WHERE team_lead_user_id IS NOT NULL) AS con_team_lead_user_id,
       count(*)                                              AS totale
FROM public.advisors;

-- 0.3 I lead sono davvero collegati con user_id (e non con advisors.id)?
--     Atteso: coincidenti = totale, e per_advisor_id = 0.
SELECT count(*) AS totale,
       count(*) FILTER (WHERE owner_id IN (SELECT user_id FROM public.advisors WHERE user_id IS NOT NULL)) AS coincidenti,
       count(*) FILTER (WHERE owner_id IN (SELECT id      FROM public.advisors))                            AS per_advisor_id
FROM public.leads;


-- ============================================================================
-- FASE 1 — PERMESSI IN ECCESSO (il problema più grave)
--
-- Oggi un Team Lead può modificare e cancellare lead, contatti, appuntamenti,
-- proposte e contratti di QUALSIASI team, perché le policy p_*_owner
-- verificano solo il ruolo e non l'appartenenza al team.
-- ============================================================================

BEGIN;

-- 1.1 Lead -----------------------------------------------------------------
-- Rimuove il permesso globale per ruolo.
DROP POLICY IF EXISTS p_leads_update_owner ON public.leads;
DROP POLICY IF EXISTS p_leads_delete_owner ON public.leads;

-- Restano attive per la modifica: "tl can UPDATE own juniors leads"
-- (proprietario o Junior del proprio team) e leads_update (Admin o
-- proprietario). Nessun accesso legittimo viene perso.

-- Per la cancellazione invece mancava una policy con lo scope di team:
-- senza questa, un Team Lead non potrebbe più cancellare i lead dei propri
-- Junior. Qui viene ricreata con il vincolo corretto.
DROP POLICY IF EXISTS tl_delete_own_team_leads ON public.leads;
CREATE POLICY tl_delete_own_team_leads
  ON public.leads FOR DELETE TO authenticated
  USING (
    owner_id = auth.uid()
    OR owner_id IN (
      SELECT a.user_id FROM public.advisors a
      WHERE a.team_lead_user_id = auth.uid() AND a.user_id IS NOT NULL
    )
  );

-- 1.2 Attività --------------------------------------------------------------
-- p_act_update_owner aveva anche WITH CHECK (true): permetteva di spostare
-- un'attività su un lead qualsiasi, anche di un altro team.
DROP POLICY IF EXISTS p_act_update_owner ON public.activities;
DROP POLICY IF EXISTS p_act_delete_owner ON public.activities;
-- Restano activities_update / activities_delete su can_access_lead(lead_id).

-- 1.3 Appuntamenti ----------------------------------------------------------
DROP POLICY IF EXISTS p_app_update_owner ON public.appointments;
DROP POLICY IF EXISTS p_app_delete_owner ON public.appointments;

-- 1.4 Proposte --------------------------------------------------------------
DROP POLICY IF EXISTS p_prop_update_owner ON public.proposals;
DROP POLICY IF EXISTS p_prop_delete_owner ON public.proposals;

-- 1.5 Contratti -------------------------------------------------------------
DROP POLICY IF EXISTS p_contr_update_owner ON public.contracts;
DROP POLICY IF EXISTS p_contr_delete_owner ON public.contracts;

-- 1.6 Policy che non ha mai funzionato --------------------------------------
-- Confronta il ruolo con 'TeamLead', ma il valore memorizzato è 'Team Lead'
-- con lo spazio: non ha mai concesso niente a nessuno.
DROP POLICY IF EXISTS p_advisors_teamlead_over_juniors ON public.advisors;

-- --- VERIFICA prima di confermare ------------------------------------------
-- Elenca le policy rimaste sulle tabelle toccate. Controlla che per ogni
-- tabella esista ancora almeno una policy di UPDATE e una di DELETE.
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('leads', 'activities', 'appointments', 'proposals', 'contracts', 'advisors')
ORDER BY tablename, cmd, policyname;

-- Se il risultato ti convince:
--   COMMIT;
-- altrimenti:
--   ROLLBACK;


-- ============================================================================
-- FASE 2 — LOG DI IMPORTAZIONE
--
-- Oggi p_import_logs_rw è ALL / USING true / WITH CHECK true: ogni utente
-- autenticato legge, modifica e cancella i log di importazione di tutti.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS p_import_logs_rw ON public.import_logs;

-- Ognuno scrive i propri log.
CREATE POLICY import_logs_insert_own
  ON public.import_logs FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid());

-- Ognuno rilegge i propri; l'Admin li vede tutti.
CREATE POLICY import_logs_select_own_or_admin
  ON public.import_logs FOR SELECT TO authenticated
  USING (
    actor_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.advisors a
      WHERE a.user_id = auth.uid()
        AND a.role = 'Admin'
        AND COALESCE(a.disabled, false) = false
    )
  );

-- Nessuna policy di UPDATE o DELETE: un registro non si riscrive.

SELECT policyname, cmd, roles FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'import_logs';

--   COMMIT;  oppure  ROLLBACK;


-- ============================================================================
-- FASE 3 — VINCOLI DI UNICITÀ PER GLI OBIETTIVI
--
-- Il salvataggio degli obiettivi usa ON CONFLICT su queste colonne. Se gli
-- indici non esistono, l'applicazione ripiega su un aggiorna-oppure-inserisci
-- (funziona, ma niente impedisce righe duplicate per lo stesso mese).
--
-- Attenzione: se ci sono GIÀ duplicati, la creazione dell'indice fallisce.
-- Il primo blocco li cerca: se restituisce righe, vanno ripuliti prima.
-- ============================================================================

-- 3.1 Ci sono duplicati?
SELECT advisor_user_id, year, count(*)
FROM public.goals
GROUP BY advisor_user_id, year HAVING count(*) > 1;

SELECT advisor_user_id, year, month, count(*)
FROM public.goals_monthly
GROUP BY advisor_user_id, year, month HAVING count(*) > 1;

-- 3.2 Se i due blocchi sopra non restituiscono niente, crea gli indici.
CREATE UNIQUE INDEX IF NOT EXISTS goals_advisor_year_uidx
  ON public.goals (advisor_user_id, year);

CREATE UNIQUE INDEX IF NOT EXISTS goals_monthly_advisor_year_month_uidx
  ON public.goals_monthly (advisor_user_id, year, month);


-- ============================================================================
-- FASE 4 — SOLO QUANDO LE PRIME TRE SONO IN PRODUZIONE DA QUALCHE GIORNO
--
-- Pulizia delle policy morte e delle colonne duplicate. Non è urgente e non
-- risolve nessun problema di sicurezza: serve a non lasciare in giro controlli
-- che sembrano attivi e non lo sono. Da fare con calma, una alla volta.
-- ============================================================================

-- 4.1 La famiglia leads_select/insert/update/delete confronta
--     j.id = leads.owner_id, ma owner_id contiene lo user_id: quella parte
--     non corrisponde mai. Prima di toccarla, riscrivi la condizione di team
--     usando team_lead_user_id (come fa "tl can UPDATE own juniors leads"),
--     poi elimina la versione vecchia. Verifica con la query 0.3.

-- 4.2 Colonne duplicate da eliminare, una migrazione per volta, dopo esserti
--     assicurato che nessuna vista le usi:
--       activities.note, appointments.note, proposals.note, contracts.note
--         (l'applicazione scrive notes)
--       appointments.method, appointments.place, contracts.kind
--       leads.status, leads.stop_working  (si usa is_working)
--       advisors.reports_to, advisors.team_lead_id  (si usa team_lead_user_id)
--       goals/goals_monthly: le colonne senza prefisso target_
--       goals_monthly.ym, goals_monthly.appuntamenti
--     Query utile per sapere quali viste dipendono da una colonna:
--       SELECT DISTINCT dependent_ns.nspname, dependent_view.relname
--       FROM pg_depend
--       JOIN pg_rewrite ON pg_depend.objid = pg_rewrite.oid
--       JOIN pg_class AS dependent_view ON pg_rewrite.ev_class = dependent_view.oid
--       JOIN pg_class AS source_table ON pg_depend.refobjid = source_table.oid
--       JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent_view.relnamespace
--       WHERE source_table.relname = 'contracts';

-- 4.3 goals_annual ha solo policy di SELECT e usa advisor_id invece di
--     advisor_user_id: l'applicazione non la scrive. Verifica che sia
--     abbandonata e falla sparire.

-- 4.4 users e team_presences non c'entrano con GuideUp. Se il database è
--     condiviso con la gestione presenze va scritto da qualche parte,
--     altrimenti sono residui.


-- ============================================================================
-- COME TORNARE INDIETRO
--
-- Se dopo il COMMIT qualcosa non va, le policy eliminate si ricreano così
-- (sono quelle di partenza, permessi larghi compresi: usale solo per sbloccare
-- una situazione, non come stato definitivo).
--
--   CREATE POLICY p_leads_update_owner ON public.leads FOR UPDATE TO authenticated
--     USING      ((owner_id = auth.uid()) OR (current_user_role() = ANY (ARRAY['Admin','Team Lead'])))
--     WITH CHECK ((owner_id = auth.uid()) OR (current_user_role() = ANY (ARRAY['Admin','Team Lead'])));
--
--   CREATE POLICY p_leads_delete_owner ON public.leads FOR DELETE TO authenticated
--     USING ((owner_id = auth.uid()) OR (current_user_role() = ANY (ARRAY['Admin','Team Lead'])));
--
-- Le altre p_*_owner seguono lo stesso schema, con EXISTS sulla tabella leads.
-- Prima di tutto questo, in ogni caso: Supabase → Database → Backups.
-- ============================================================================
