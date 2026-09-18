-- ============================================================================
-- GIÀ APPLICATO IN PRODUZIONE — 18/09/2026
-- migrazione: chiude_accesso_anonimo_reminders_e_viste
--
-- Verificato con la chiave anon (quella pubblica dentro il bundle JavaScript),
-- senza alcun login: uscivano 16 promemoria e tutte le viste v_* con
-- appuntamenti, contratti e produzione per advisor. Su `reminders` il ruolo
-- anon aveva anche INSERT, UPDATE, DELETE e TRUNCATE: chiunque poteva
-- svuotare la tabella.
--
-- Fatto:
--   ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY  (non era mai stata accesa)
--   + 4 policy scritte per esteso, senza dipendere da can_access_lead()/is_admin()
--   REVOKE ALL ON public.reminders FROM anon
--   REVOKE SELECT su tutte e 10 le viste v_* FROM anon
--
-- Dopo: ogni chiamata anonima risponde 401. Controllato che nessun dato sia
-- diventato irraggiungibile: Admin e Team Lead vedono tutti i 16 promemoria,
-- ogni Junior vede quelli dei propri lead.
--
-- RESTA APERTO: le viste girano ancora come `postgres` senza security_invoker,
-- quindi un utente autenticato qualsiasi che le interroghi direttamente vede i
-- numeri di tutta la rete, non solo i propri. Si chiude con
--   ALTER VIEW public.v_progress_monthly SET (security_invoker = on);
-- ma solo DOPO la Fase 1: con is_admin() rotta, un Admin smetterebbe di vedere
-- i dati altrui nei report.
-- ============================================================================


-- ============================================================================
-- GuideUp — correzione delle funzioni e delle policy RLS
--
-- Versione 2. La prima stesura di questo file era incompleta: presupponeva che
-- can_access_lead() controllasse correttamente l'appartenenza al team. Letta la
-- funzione, non è così. Eseguendo la versione precedente un Team Lead avrebbe
-- perso l'accesso in scrittura ai dati dei propri Junior. L'ordine qui sotto
-- ripara prima le funzioni e solo dopo toglie i permessi in eccesso.
--
-- Come si esegue: Supabase → SQL Editor. Una FASE per volta, leggendo il
-- risultato prima di passare alla successiva. La Fase 1 è dentro una
-- transazione: finché non digiti COMMIT non è cambiato niente.
--
-- Prima di iniziare: Supabase → Database → Backups, verifica che ce ne sia uno
-- recente.
-- ============================================================================


-- ============================================================================
-- COSA È EMERSO DALL'ISPEZIONE (Fase 0, eseguita e verificata sui dati)
--
-- 1. can_access_lead() — il ramo del Team Lead non funziona, per due motivi
--    indipendenti. VERIFICATO sui dati: team_lead_id e reports_to sono
--    valorizzate su 0 righe su 7, team_lead_user_id su 5; e 457 lead su 457
--    hanno owner_id = advisors.user_id, 0 con advisors.id.
--       JOIN public.advisors j ON j.id = l.owner_id   -- owner_id contiene lo
--                                                     -- user_id, non advisors.id
--       WHERE j.team_lead_id = auth.uid()             -- colonna che l'app non
--                                                     -- scrive mai
--    Conseguenza: oggi un Team Lead può modificare contatti, appuntamenti,
--    proposte e contratti dei propri Junior SOLO grazie alle policy p_*_owner,
--    quelle troppo larghe. Toglierle senza riparare la funzione gli farebbe
--    perdere il lavoro quotidiano.
--
-- 2. is_admin() legge da public.users, non da public.advisors:
--       select 1 from public.users u where u.id = auth.uid() and lower(u.role) = 'admin'
--    VERIFICATO: public.users ha ZERO righe (e anche team_presences). Quindi
--    is_admin() restituisce SEMPRE false, per chiunque.
--    Conseguenza concreta: goals_insert e goals_update richiedono is_admin()
--    oppure essere Team Lead di quel Junior. Un Admin oggi NON riesce a
--    salvare gli obiettivi di nessuno.
--
-- 3. Esistono tre definizioni diverse di "amministratore":
--       is_admin()            -> public.users.role
--       current_user_role()   -> public.advisors.role, cercato per email
--       *_select_admin_all    -> public.advisors.role, cercato per user_id
--    Vanno ricondotte a una.
--
-- 4. current_user_role() confronta le email senza normalizzarle:
--       where email = auth.jwt() ->> 'email'
--    Una maiuscola di differenza fra la riga in advisors e l'indirizzo con cui
--    si accede e la funzione restituisce NULL: l'utente risulta senza ruolo.
-- ============================================================================


-- ============================================================================
-- FASE 1 — FUNZIONI E POLICY, IN UNA SOLA TRANSAZIONE
--
-- Riparare le funzioni e togliere i permessi in eccesso sono due facce della
-- stessa modifica: separarle lascerebbe l'applicazione rotta nel mezzo.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1.1 can_access_lead(): il ramo del Team Lead usa la convenzione vera
-- ---------------------------------------------------------------------------
-- Resta SECURITY INVOKER: la SELECT interna su `leads` continua a passare per
-- le policy di lettura, che è una protezione in più, non un problema.
CREATE OR REPLACE FUNCTION public.can_access_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  WITH l AS (
    SELECT owner_id
    FROM public.leads
    WHERE id = p_lead_id
  )
  SELECT
    -- Admin vede tutto
    public.is_admin()
    OR
    -- Proprietario del lead
    EXISTS (SELECT 1 FROM l WHERE owner_id = auth.uid())
    OR
    -- Team Lead: il lead appartiene a un advisor che riporta a lui.
    -- leads.owner_id contiene advisors.user_id, e il responsabile sta in
    -- team_lead_user_id: era questo il punto rotto.
    EXISTS (
      SELECT 1
      FROM l
      JOIN public.advisors j ON j.user_id = l.owner_id
      WHERE j.team_lead_user_id = auth.uid()
        AND COALESCE(j.is_active, true) = true
        AND COALESCE(j.disabled, false) = false
    );
$function$;

-- ---------------------------------------------------------------------------
-- 1.2 is_admin(): riconosce gli Admin di GuideUp
-- ---------------------------------------------------------------------------
-- La vecchia condizione su public.users viene MANTENUTA in OR, non sostituita:
-- is_admin() è usata anche da team_presences, che appartiene all'altro
-- applicativo. Toglierla rischierebbe di rompere qualcosa fuori da GuideUp.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.advisors a
      WHERE a.user_id = auth.uid()
        AND a.role = 'Admin'
        AND COALESCE(a.disabled, false) = false
        AND COALESCE(a.is_active, true) = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND lower(u.role) = 'admin'
    );
$function$;

-- ---------------------------------------------------------------------------
-- 1.3 current_user_role(): niente più ruoli persi per una maiuscola
-- ---------------------------------------------------------------------------
-- Cerca prima per user_id, che è il collegamento affidabile, e ricade
-- sull'email solo per chi non ha ancora completato il primo accesso.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
AS $function$
  SELECT a.role
  FROM public.advisors a
  WHERE a.user_id = auth.uid()
     OR lower(a.email) = lower(auth.jwt() ->> 'email')
  ORDER BY (a.user_id = auth.uid()) DESC NULLS LAST
  LIMIT 1;
$function$;

-- ---------------------------------------------------------------------------
-- 1.4 Ora si possono togliere i permessi in eccesso
-- ---------------------------------------------------------------------------
-- Queste policy concedono a chiunque abbia ruolo Team Lead di modificare e
-- cancellare i dati di QUALSIASI team, perché non verificano l'appartenenza.
-- Dopo i punti 1.1 e 1.2, l'accesso legittimo è coperto dalle policy corrette.

DROP POLICY IF EXISTS p_leads_update_owner ON public.leads;
DROP POLICY IF EXISTS p_leads_delete_owner ON public.leads;

-- p_act_update_owner aveva anche WITH CHECK (true): permetteva di spostare
-- un'attività su un lead qualsiasi, anche di un altro team.
DROP POLICY IF EXISTS p_act_update_owner   ON public.activities;
DROP POLICY IF EXISTS p_act_delete_owner   ON public.activities;

DROP POLICY IF EXISTS p_app_update_owner   ON public.appointments;
DROP POLICY IF EXISTS p_app_delete_owner   ON public.appointments;

DROP POLICY IF EXISTS p_prop_update_owner  ON public.proposals;
DROP POLICY IF EXISTS p_prop_delete_owner  ON public.proposals;

DROP POLICY IF EXISTS p_contr_update_owner ON public.contracts;
DROP POLICY IF EXISTS p_contr_delete_owner ON public.contracts;

-- Non ha mai concesso niente: confronta il ruolo con 'TeamLead', ma il valore
-- memorizzato è 'Team Lead' con lo spazio.
DROP POLICY IF EXISTS p_advisors_teamlead_over_juniors ON public.advisors;

-- ---------------------------------------------------------------------------
-- 1.5 La cancellazione dei lead da parte del Team Lead va ricreata
-- ---------------------------------------------------------------------------
-- È l'unico permesso legittimo che sparirebbe: non esiste nessun'altra policy
-- di DELETE su `leads` con lo scope di team.
DROP POLICY IF EXISTS tl_delete_own_team_leads ON public.leads;
CREATE POLICY tl_delete_own_team_leads
  ON public.leads FOR DELETE TO authenticated
  USING (
    owner_id = auth.uid()
    OR owner_id IN (
      SELECT a.user_id
      FROM public.advisors a
      WHERE a.team_lead_user_id = auth.uid()
        AND a.user_id IS NOT NULL
    )
  );

-- ---------------------------------------------------------------------------
-- VERIFICA prima di confermare
-- ---------------------------------------------------------------------------

-- a) Le funzioni rispondono come previsto per l'utente collegato?
--    Eseguendo dal SQL Editor auth.uid() è NULL, quindi qui è normale leggere
--    false / NULL: serve solo a controllare che non diano errore.
SELECT public.is_admin() AS sono_admin,
       public.current_user_role() AS mio_ruolo;

-- b) Il ramo Team Lead di can_access_lead adesso trova qualcosa?
--    Sostituisci <USER_ID_DI_UN_TEAM_LEAD> con lo user_id di un Team Lead vero.
--    Atteso: un numero maggiore di zero, se quel TL ha Junior con lead.
SELECT count(*) AS lead_del_suo_team
FROM public.leads l
JOIN public.advisors j ON j.user_id = l.owner_id
WHERE j.team_lead_user_id = '<USER_ID_DI_UN_TEAM_LEAD>';

-- c) Su ogni tabella resta almeno una policy di UPDATE e una di DELETE?
SELECT tablename, cmd, count(*) AS quante,
       string_agg(policyname, ', ' ORDER BY policyname) AS policy
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('leads','activities','appointments','proposals','contracts','advisors')
GROUP BY tablename, cmd
ORDER BY tablename, cmd;

-- Se i tre controlli ti convincono:   COMMIT;
-- altrimenti:                         ROLLBACK;


-- ============================================================================
-- DOPO IL COMMIT — PROVA SUL CAMPO (10 minuti, importante)
--
-- Le query qui sopra girano come proprietario del database e non passano per
-- le RLS: dicono che le policy esistono, non che funzionano. La verifica vera
-- si fa dall'applicazione.
--
--   Con un utente TEAM LEAD:
--     [ ] vede i lead dei propri Junior
--     [ ] apre la scheda di uno di quei lead e registra un contatto
--     [ ] modifica e poi elimina quel contatto
--     [ ] fissa e poi elimina un appuntamento
--     [ ] NON vede i lead di un altro team
--
--   Con un utente JUNIOR:
--     [ ] vede e modifica solo i propri lead
--
--   Con un utente ADMIN:
--     [ ] vede tutta la rete
--     [ ] modifica un lead che non è suo
--     [ ] salva un obiettivo di un altro advisor
--
-- Se qualcosa non va, in fondo al file c'è come tornare indietro.
-- ============================================================================


-- ============================================================================
-- FASE 2 — LOG DI IMPORTAZIONE
--
-- p_import_logs_rw è ALL / USING true / WITH CHECK true: ogni utente
-- autenticato legge, modifica e cancella i log di importazione di tutti.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS p_import_logs_rw ON public.import_logs;

CREATE POLICY import_logs_insert_own
  ON public.import_logs FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid());

CREATE POLICY import_logs_select_own_or_admin
  ON public.import_logs FOR SELECT TO authenticated
  USING (actor_user_id = auth.uid() OR public.is_admin());

-- Nessuna policy di UPDATE o DELETE: un registro non si riscrive.

SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'import_logs';

--   COMMIT;  oppure  ROLLBACK;


-- ============================================================================
-- FASE 3 — NON SERVE PIÙ (verificato)
--
-- Gli indici univoci esistono già e sono sulle colonne giuste:
--   idx_goals_unique         su goals (advisor_user_id, year)
--   idx_goals_monthly_unique su goals_monthly (advisor_user_id, year, month)
-- Nessun duplicato presente. Il ripiego previsto nel codice applicativo non
-- entra mai in funzione: resta come rete di sicurezza.
--
-- goals_monthly.ym è character(7) e contiene valori come '202601 ' (sei cifre
-- più uno spazio di riempimento). Il formato scritto dall'applicazione è
-- compatibile con lo storico.
-- ============================================================================


-- ============================================================================
-- FASE 3-bis — ALLINEARE contracts.premium_annual  (facoltativa, consigliata)
--
-- Tutti i 27 contratti storici hanno premium_annual = 0: la colonna ha un
-- default a zero e non è mai stata usata. Il valore vero sta in `amount`, ed è
-- `amount` che legge la vista v_progress_monthly, quindi i report sono
-- corretti.
--
-- Da settembre 2026 l'applicazione scrive entrambe le colonne. Senza questo
-- allineamento la colonna resta con due significati: zero per lo storico,
-- valore reale per i contratti nuovi.
--
--   UPDATE public.contracts
--      SET premium_annual = amount
--    WHERE COALESCE(premium_annual, 0) = 0
--      AND amount IS NOT NULL;
--
-- Per tornare indietro: UPDATE public.contracts SET premium_annual = 0;
-- ============================================================================


-- FASE 4 — CON CALMA, QUANDO LE PRIME TRE SONO ASSESTATE
--
-- Nessuna urgenza e nessun impatto sulla sicurezza: serve a non lasciare in
-- giro controlli che sembrano attivi e non lo sono.
-- ============================================================================

-- 4.1 La famiglia leads_select / leads_insert / leads_update / leads_delete
--     contiene ancora la condizione morta j.id = leads.owner_id con
--     j.team_lead_id. Le parti utili (is_admin, owner_id = auth.uid()) restano
--     valide, quindi non c'è fretta, ma quella condizione va riscritta con
--     team_lead_user_id o eliminata.

-- 4.2 Colonne duplicate da eliminare, una migrazione per volta, dopo aver
--     verificato che nessuna vista le usi:
--       activities.note, appointments.note, proposals.note, contracts.note
--         (l'applicazione scrive `notes`)
--       appointments.method, appointments.place, contracts.kind
--       leads.status, leads.stop_working  (si usa is_working)
--       advisors.reports_to, advisors.team_lead_id  (si usa team_lead_user_id)
--       goals / goals_monthly: le colonne senza prefisso target_
--       goals_monthly.ym, goals_monthly.appuntamenti
--
--     Per sapere quali viste dipendono da una tabella:
--       SELECT DISTINCT dependent_view.relname
--       FROM pg_depend
--       JOIN pg_rewrite ON pg_depend.objid = pg_rewrite.oid
--       JOIN pg_class AS dependent_view ON pg_rewrite.ev_class = dependent_view.oid
--       JOIN pg_class AS source_table ON pg_depend.refobjid = source_table.oid
--       WHERE source_table.relname = 'contracts';

-- 4.3 goals_annual ha solo policy di SELECT e usa advisor_id invece di
--     advisor_user_id: l'applicazione non la scrive. Verifica che sia
--     abbandonata ed eliminala.

-- 4.4 public.users e public.team_presences appartengono all'applicativo delle
--     presenze. Dopo il punto 1.2 is_admin() non dipende più solo da `users`,
--     ma il legame resta: se i due prodotti condividono il database va scritto
--     da qualche parte, altrimenti vanno separati.


-- ============================================================================
-- COME TORNARE INDIETRO
--
-- Le funzioni, nella versione di partenza:
--
--   CREATE OR REPLACE FUNCTION public.can_access_lead(p_lead_id uuid)
--   RETURNS boolean LANGUAGE sql STABLE AS $function$
--     WITH l AS (SELECT owner_id FROM public.leads WHERE id = p_lead_id)
--     SELECT public.is_admin()
--       OR EXISTS (SELECT 1 FROM l WHERE owner_id = auth.uid())
--       OR EXISTS (SELECT 1 FROM l JOIN public.advisors j ON j.id = l.owner_id
--                  WHERE j.team_lead_id = auth.uid());
--   $function$;
--
--   CREATE OR REPLACE FUNCTION public.is_admin()
--   RETURNS boolean LANGUAGE sql STABLE AS $function$
--     select exists (select 1 from public.users u
--                    where u.id = auth.uid() and lower(u.role) = 'admin');
--   $function$;
--
--   CREATE OR REPLACE FUNCTION public.current_user_role()
--   RETURNS text LANGUAGE sql STABLE AS $function$
--     select role from public.advisors where email = auth.jwt() ->> 'email' limit 1
--   $function$;
--
-- Le policy eliminate (permessi larghi compresi: da usare solo per sbloccare
-- una situazione, non come stato definitivo):
--
--   CREATE POLICY p_leads_update_owner ON public.leads FOR UPDATE TO authenticated
--     USING      ((owner_id = auth.uid()) OR (current_user_role() = ANY (ARRAY['Admin','Team Lead'])))
--     WITH CHECK ((owner_id = auth.uid()) OR (current_user_role() = ANY (ARRAY['Admin','Team Lead'])));
--
--   CREATE POLICY p_leads_delete_owner ON public.leads FOR DELETE TO authenticated
--     USING ((owner_id = auth.uid()) OR (current_user_role() = ANY (ARRAY['Admin','Team Lead'])));
--
--   CREATE POLICY p_act_update_owner ON public.activities FOR UPDATE TO authenticated
--     USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = activities.lead_id
--            AND (l.owner_id = auth.uid() OR current_user_role() = ANY (ARRAY['Admin','Team Lead']))))
--     WITH CHECK (true);
--
--   CREATE POLICY p_act_delete_owner ON public.activities FOR DELETE TO authenticated
--     USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = activities.lead_id
--            AND (l.owner_id = auth.uid() OR current_user_role() = ANY (ARRAY['Admin','Team Lead']))));
--
-- Le p_app_*, p_prop_*, p_contr_* seguono lo stesso schema di p_act_*,
-- cambiando il nome della tabella.
-- ============================================================================
