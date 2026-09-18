# Note sul database — criticità rilevate

Analisi dello schema e delle policy RLS di produzione. L'applicazione è stata
adattata a ciò che il database fa **oggi**; questo documento elenca i problemi
che vanno risolti lato database, perché nessuna modifica al frontend può
risolverli.

Ordine di priorità: dalla più grave alla meno urgente.

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

## 3-bis. `can_access_lead()` e `is_admin()` non fanno quello che sembra — GRAVE

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

GuideUp gestisce i ruoli in `advisors` e non scrive mai in `users`. Un Admin
senza riga corrispondente in `users` risulta non-admin per tutte le policy che
passano da questa funzione.

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

L'applicazione scrive in `leads.owner_id` lo `user_id` (cioè `auth.uid()`),
quindi tutta la prima famiglia di policy non corrisponde **mai** a nulla: è
codice morto che dà l'illusione di un controllo. Stesso errore in
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

## 7. Nessuna policy di inserimento per l'auto-registrazione

Su `advisors` esistono solo `p_advisors_all` (Admin) e la policy rotta del punto
5. Il vecchio frontend, non trovando un profilo, tentava di crearne uno con
ruolo Junior: quell'INSERT **falliva sempre**, in silenzio, e l'utente restava
bloccato sulla schermata di accesso. Ora il caso viene riconosciuto e spiegato
("Account non ancora abilitato"), ma resta da decidere se l'auto-provisioning
debba esistere o no.

## 8. Colonne duplicate e incoerenti

| Tabella | Duplicati | Conseguenza |
|---|---|---|
| `activities`, `appointments`, `proposals`, `contracts` | `note` **e** `notes` | l'app scrive `notes`; `note` resta vuota e confonde ogni query fatta a mano |
| `contracts` | `amount`, `premium_annual`, `line`, `contract_type`, `kind` | `premium_annual` è NOT NULL ma il vecchio frontend non la valorizzava: i contratti inseriti dall'app potevano avere il premio solo in `amount` |
| `goals` | `target_consulenze` … **e** `consulenze` … | due serie di colonne per lo stesso dato |
| `goals_monthly` | idem, più `appuntamenti` e `ym` | idem |
| `leads` | `is_working` **e** `stop_working`, più `status` mai usata | tre modi di dire la stessa cosa |
| `advisors` | `is_active` **e** `disabled` | due flag opposti da tenere allineati a mano |

L'applicazione ora scrive **entrambe** le colonne dove sono duplicate, per non
lasciare dati incoerenti. È una toppa: la soluzione è una migrazione che
elimini le colonne vecchie.

## 9. `goals_monthly.ym` è `bpchar`

Il frontend storico scriveva un intero `YYYYMM`, che Postgres converte in
stringa. Il formato attuale viene mantenuto per compatibilità, ma la colonna è
ridondante (`year` e `month` esistono già) e andrebbe rimossa o resa generata.

## 10. Da verificare: vincoli di unicità per gli upsert

Il salvataggio degli obiettivi usa:

```sql
ON CONFLICT (advisor_user_id, year)          -- goals
ON CONFLICT (advisor_user_id, year, month)   -- goals_monthly
```

Se questi indici univoci non esistono, Postgres risponde `42P10`. Il codice ora
intercetta l'errore e ripiega su un aggiorna-oppure-inserisci, ma è una rete di
sicurezza: gli indici vanno creati, altrimenti nulla impedisce righe duplicate
di obiettivi per lo stesso mese.

## 11. Tabelle di un altro prodotto

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
