# Note sul database — criticità rilevate

Analisi dello schema e delle policy RLS di produzione (progetto
`advplus-monitor-prod`). L'applicazione è stata adattata a ciò che il database
fa **oggi**; questo documento elenca i problemi che vanno risolti lato
database, perché nessuna modifica al frontend può risolverli.

Dal 18/09/2026 i dati sono stati verificati direttamente sul database, non più
solo dedotti dall'export delle policy. Le voci marcate **VERIFICATO** poggiano
su numeri reali.

Ordine di priorità: dalla più grave alla meno urgente.

---

## 00. Chiunque poteva crearsi un account Admin — RISOLTO il 18/09/2026

La cosa più grave emersa in tutta l'analisi. Tre pezzi che presi singolarmente
sembrano innocui:

1. `disable_signup: false` — la registrazione pubblica era **aperta**. Bastava
   la chiave `anon`, che sta nel JavaScript del sito.
2. Il trigger `on_auth_user_created` chiamava `handle_user_created()`, che è
   `SECURITY DEFINER` e quindi scavalca le RLS:

   ```sql
   v_role := coalesce(new.raw_user_meta_data->>'role', 'Junior');
   insert into public.advisors (user_id, email, role) values (new.id, new.email, v_role);
   ```

   Il ruolo arrivava dai **metadati forniti dal client** al momento della
   registrazione.
3. Un `advisors.role = 'Admin'` apre `p_advisors_all` (lettura e scrittura su
   tutti gli advisor), `leads_select_admin_all` e sorelle, `p_leads_update_owner`
   e `p_leads_delete_owner`.

In fila: una persona qualsiasi, da internet, si registrava dichiarandosi Admin e
otteneva il controllo completo dell'applicazione. Non è stato dimostrato sul
campo perché avrebbe significato creare un account amministratore reale.

**Risolto** con la migrazione `handle_user_created_non_si_fida_del_ruolo_dal_client`:
il trigger ora collega soltanto l'utente auth al profilo advisor già creato
dall'amministratore, non ne crea di nuovi e non legge mai il ruolo dal client.
Revocato `EXECUTE` ad `anon`, `authenticated` e `PUBLIC`.

**Resta da fare, a mano:** Supabase → Authentication → Sign In / Providers →
Email → disattivare *"Allow new users to sign up"*. Il trigger è ormai a prova
di ruolo, ma senza questo chiunque può continuare a creare utenti auth.

---

## 0. Dati leggibili senza autenticarsi — RISOLTO il 18/09/2026

Interrogando le API con la chiave `anon` — quella che sta dentro il bundle
JavaScript del sito, pubblica per definizione — **senza alcun login** uscivano:

```
reminders                  HTTP 206  righe: 16
v_progress_monthly         HTTP 206  righe: 17
v_goals_monthly            HTTP 206  righe: 7
```

Due cause distinte.

**`reminders` aveva le RLS disattivate** (`relrowsecurity = false`) e zero
policy: la protezione non era mai stata accesa. Il ruolo `anon` aveva inoltre
`INSERT`, `UPDATE`, `DELETE` e `TRUNCATE`: chiunque poteva svuotare la tabella.

**Le dieci viste `v_*` appartengono a `postgres` e non hanno
`security_invoker`**, quindi girano con i privilegi del proprietario e
scavalcano le RLS delle tabelle sottostanti. Avevano `SELECT` concesso ad
`anon`.

Le tabelle vere (`leads`, `advisors`, `contracts`) reggevano: rispondevano 500,
nessun dato usciva.

Applicata la migrazione `chiude_accesso_anonimo_reminders_e_viste`: RLS accese
su `reminders` con quattro policy scritte per esteso (non dipendono da
`can_access_lead()` né da `is_admin()`, che oggi non funzionano), `REVOKE ALL`
per `anon` su `reminders` e `REVOKE SELECT` per `anon` sulle dieci viste.
Riverificato: ogni chiamata anonima risponde 401, cancellazione compresa.
Nessun dato è diventato irraggiungibile.

**Resta aperto:** le viste girano ancora come `postgres`. Un utente autenticato
qualsiasi che le interroghi direttamente vede i numeri di tutta la rete. Si
chiude con `ALTER VIEW … SET (security_invoker = on)`, ma solo dopo aver
riparato `is_admin()`: altrimenti gli Admin smetterebbero di vedere i dati
altrui nei report.

---

## 1. Un Team Lead può modificare i dati di qualsiasi team — GRAVE

Le policy `p_leads_update_owner` e `p_leads_delete_owner` consentono l'operazione a
chiunque abbia ruolo `Admin` **o** `Team Lead`, senza verificare che il lead
appartenga al suo team:

```sql
USING ((owner_id = auth.uid()) OR (current_user_role() = ANY (ARRAY['Admin','Team Lead'])))
```

Le policy sono permissive e vengono combinate in **OR**: questa da sola basta a
concedere l'accesso, annullando il controllo di team presente nelle altre.
Stessa forma in `p_act_update_owner`, `p_act_delete_owner`, `p_app_update_owner`,
`p_app_delete_owner`, `p_prop_*`, `p_contr_*`.

Un Team Lead può quindi modificare o cancellare lead, contatti, appuntamenti,
proposte e contratti dei team altrui.

**Da fare:** aggiungere il vincolo di team, come già scritto in
`tl can UPDATE own juniors leads`, ed eliminare le policy `p_*_owner` che non lo
contengono.

## 2. `p_act_update_owner` ha `WITH CHECK true` — GRAVE

```sql
USING  (... l.owner_id = auth.uid() OR ruolo in (Admin, Team Lead))
WITH CHECK (true)
```

`USING` decide quali righe si possono toccare, `WITH CHECK` come possono restare
dopo la modifica. Con `true` una attività può essere spostata su un `lead_id`
qualsiasi, anche di un altro team. Deve ripetere la stessa condizione di `USING`.

## 3. `import_logs` è aperta a chiunque — GRAVE

```sql
p_import_logs_rw  ALL  authenticated  USING true  WITH CHECK true
```

Qualsiasi utente autenticato legge, modifica e cancella i log di importazione di
tutti. Andrebbe ristretta: lettura all'Admin, scrittura al solo autore
(`actor_user_id = auth.uid()`), nessuna cancellazione.

## 3-bis. `can_access_lead()` e `is_admin()` non fanno quello che sembra — GRAVE, VERIFICATO

Letto il corpo delle funzioni (Fase 0 di `rls-fix.sql`), emergono due problemi
che spiegano perché le policy troppo larghe del punto 1 non sono mai state
notate: **sono quelle che tengono in piedi il lavoro quotidiano**.

`can_access_lead()` — il ramo del Team Lead è morto, per due motivi insieme:

```sql
JOIN public.advisors j ON j.id = l.owner_id   -- owner_id contiene lo user_id
WHERE j.team_lead_id = auth.uid()             -- colonna che l'app non scrive
```

Un Team Lead quindi **non** passa questo controllo sui lead dei propri Junior:
può modificare contatti, appuntamenti, proposte e contratti solo attraverso le
`p_*_owner`. Toglierle senza riparare prima la funzione gli fa perdere l'uso
normale dell'applicazione.

`is_admin()` legge da `public.users`, non da `public.advisors`:

```sql
select 1 from public.users u where u.id = auth.uid() and lower(u.role) = 'admin'
```

**VERIFICATO: `public.users` ha zero righe** (e così `team_presences`).
`is_admin()` restituisce quindi **sempre false, per chiunque**.

Conseguenza concreta e verificabile: `goals_insert` e `goals_update` richiedono
`is_admin()` oppure essere Team Lead di quel Junior. **Un Admin oggi non riesce
a salvare gli obiettivi di nessuno.**

Ne segue che esistono **tre definizioni diverse di amministratore**:
`is_admin()` su `users.role`, `current_user_role()` su `advisors.role` cercato
per email, e le `*_select_admin_all` su `advisors.role` cercato per `user_id`.

Infine `current_user_role()` confronta le email senza normalizzarle
(`where email = auth.jwt() ->> 'email'`): una maiuscola di differenza e la
funzione restituisce NULL, cioè utente senza ruolo.

## 4. Due convenzioni incompatibili per la gerarchia

La tabella `advisors` ha **tre** colonne per la stessa relazione:
`reports_to`, `team_lead_id` e `team_lead_user_id`. E le policy ne usano due
diverse, con significati diversi:

| Policy | Confronta | Presuppone che `owner_id` sia |
|---|---|---|
| `leads_select`, `leads_insert`, `leads_update`, `leads_delete` | `j.id = leads.owner_id AND j.team_lead_id = auth.uid()` | `advisors.id` |
| `leads_select_scope`, `tl can INSERT/UPDATE…` | `a.user_id` … `a.team_lead_user_id = auth.uid()` | `auth.uid()` |

**VERIFICATO:** 457 lead su 457 hanno `owner_id` corrispondente ad
`advisors.user_id`, **zero** ad `advisors.id`. E su 7 advisor, `team_lead_id` e
`reports_to` sono valorizzate su **zero** righe, `team_lead_user_id` su cinque.
Tutta la prima famiglia di policy non corrisponde **mai** a nulla: è codice
morto che dà l'illusione di un controllo. Stesso errore in
`team_presences_update_own` (`a.id = team_presences.user_id`).

**Da fare:** scegliere una convenzione — `team_lead_user_id` +
`owner_id = user_id`, che è quella effettivamente in uso — riscrivere le policy
su quella e rimuovere `reports_to` e `team_lead_id`.

## 5. `p_advisors_teamlead_over_juniors` non funziona

```sql
current_user_role() = 'TeamLead'
```

Il ruolo memorizzato è `'Team Lead'`, con lo spazio. La policy non scatta mai.

## 6. La rubrica della rete è leggibile da tutti

`p_advisors_select_all` e `advisors_read_all` hanno entrambe `USING true` per
`authenticated`: ogni Junior può leggere nome, email, ruolo e struttura di team
dell'intera rete. L'interfaccia non li mostra, ma i dati viaggiano lo stesso.
Se è una scelta voluta va bene; se non lo è, va ristretta al proprio team.

## 7. Auto-provisioning: era nel database, non nel frontend — CORRETTO

Nota rettificata. Il frontend, non trovando un profilo, tentava di crearne uno
con ruolo Junior, e quell'INSERT falliva sempre per assenza di policy. Ma il
profilo veniva creato comunque, dal trigger `on_auth_user_created` lato
database, che essendo `SECURITY DEFINER` scavalca le RLS — con il ruolo preso
dai metadati del client (vedi punto 00).

Dopo la correzione del trigger l'auto-provisioning non esiste più: i profili si
creano solo dalla sezione **Utenti**, e chi arriva senza invito vede "Account
non ancora abilitato". C'è **già oggi un utente auth senza profilo** (8 utenti
auth, 7 advisor), quindi quella schermata non è un caso teorico.

## 8. Colonne duplicate e incoerenti

| Tabella | Duplicati | Conseguenza |
|---|---|---|
| `activities`, `appointments`, `proposals`, `contracts` | `note` **e** `notes` | l'app scrive `notes`; `note` resta vuota e confonde ogni query fatta a mano |
| `contracts` | `amount`, `premium_annual`, `line`, `contract_type`, `kind` | **VERIFICATO:** tutti i 27 contratti hanno `premium_annual = 0` (default mai usato); il valore vero è in `amount`, che è ciò che legge `v_progress_monthly`. Da settembre 2026 l'app scrive entrambe: serve un allineamento dello storico (Fase 3-bis) |
| `goals` | `target_consulenze` … **e** `consulenze` … | due serie di colonne per lo stesso dato |
| `goals_monthly` | idem, più `appuntamenti` e `ym` | idem |
| `leads` | `is_working` **e** `stop_working`, più `status` mai usata | tre modi di dire la stessa cosa |
| `advisors` | `is_active` **e** `disabled` | due flag opposti da tenere allineati a mano |

L'applicazione ora scrive **entrambe** le colonne dove sono duplicate, per non
lasciare dati incoerenti. È una toppa: la soluzione è una migrazione che
elimini le colonne vecchie.

**Canali di contatto, VERIFICATO:** il vincolo su `activities.channel` ammette
esattamente `phone | email | inperson | video`. Nei dati: 297 `phone` e 45
`email`, nessun `inperson` né `video`. Le vecchie opzioni WhatsApp, SMS e
"Altro" finivano tutte in `phone` e sono ormai indistinguibili. Per tracciarle
davvero serve estendere il vincolo:

```sql
ALTER TABLE public.activities DROP CONSTRAINT activities_channel_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_channel_check
  CHECK (channel = ANY (ARRAY['phone','email','inperson','video','whatsapp','sms']));
```

e poi aggiungere le voci in `src/lib/domain.ts`.

## 9. `goals_monthly.ym` è `bpchar`

Il frontend storico scriveva un intero `YYYYMM`, che Postgres converte in
stringa. Il formato attuale viene mantenuto per compatibilità, ma la colonna è
ridondante (`year` e `month` esistono già) e andrebbe rimossa o resa generata.

## 10. Vincoli di unicità per gli upsert — NON È UN PROBLEMA, VERIFICATO

Gli indici esistono già e sono sulle colonne giuste: `idx_goals_unique` su
`(advisor_user_id, year)` e `idx_goals_monthly_unique` su
`(advisor_user_id, year, month)`. Nessun duplicato presente. Il ripiego
previsto nel codice applicativo non entra mai in funzione: resta come rete di
sicurezza.

## 11. Tabelle di un altro prodotto — entrambe vuote, VERIFICATO

`users` e `team_presences` hanno **zero righe**: l'applicativo delle presenze
in questo database non esiste. Questo rende innocuo il ramo su `users` che
`is_admin()` conserva, e toglie ogni preoccupazione di privacy sul punto.

`users` (con `office`, `job_role`, `law_104`) e `team_presences` non hanno
alcun rapporto con GuideUp. Se il database è condiviso con la gestione
presenze, va documentato; altrimenti sono residui da rimuovere.

## 12. `goals_annual` è irraggiungibile in scrittura

Ha solo policy di SELECT e usa `advisor_id` invece di `advisor_user_id`.
L'applicazione scrive gli obiettivi annuali su `goals`. Probabile tabella
abbandonata: da eliminare, o da riallineare.

---

## Cosa servirebbe in più

Due viste renderebbero l'applicazione molto più veloce, eliminando calcoli che
oggi il browser è costretto a fare scaricando gli id:

- **`v_leads_enriched`** — per ogni lead: numero di contatti, appuntamenti,
  proposte, contratti, data dell'ultimo contatto e produzione totale. Oggi la
  pagina Lead, per filtrare "mai contattati" o per ordinare sull'ultimo
  contatto, deve scaricare gli id di tutte le attività.
- **`v_lead_never_contacted`** — conteggio dei lead senza attività per
  assegnatario, usato dalla dashboard.
