import { useState } from 'react'
import { supabase } from '../../supabaseClient'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Icon,
  RadioGroup,
  SelectField,
  Tabs,
  TextField,
  TextareaField,
  useConfirm,
  useToast,
  type TabItem,
} from '../../ui'
import { Timeline, TimelineForm, type TimelineItem } from './Timeline'
import { useChildTable } from './useChildTable'
import {
  CHANNELS,
  CONTRACT_TYPES,
  MODES,
  OUTCOMES,
  SOURCE_LABEL,
  labelOf,
  leadName,
  type Advisor,
  type ContractType,
  type Lead,
  type LeadSource,
} from '../../lib/domain'
import { fromLocalInput, isValidLocalInput, toDateInput, toIsoWithOffset, toLocalInput } from '../../lib/datetime'
import { displayName, errorMessage, formatCurrency } from '../../lib/format'
import { useAuth } from '../../auth/AuthProvider'

type TabKey = 'anagrafica' | 'contatti' | 'appuntamenti' | 'promemoria' | 'proposte' | 'contratti'

export type LeadFormState = {
  is_agency_client: boolean | null
  owner_id: string | null
  first_name: string
  last_name: string
  company_name: string
  email: string
  phone: string
  city: string
  address: string
  source: LeadSource | ''
  is_working: boolean
}

export function emptyLeadForm(ownerId: string | null): LeadFormState {
  return {
    is_agency_client: null,
    owner_id: ownerId,
    first_name: '',
    last_name: '',
    company_name: '',
    email: '',
    phone: '',
    city: '',
    address: '',
    source: '',
    is_working: true,
  }
}

export function leadToForm(l: Lead): LeadFormState {
  return {
    is_agency_client: l.is_agency_client,
    owner_id: l.owner_id,
    first_name: l.first_name || '',
    last_name: l.last_name || '',
    company_name: l.company_name || '',
    email: l.email || '',
    phone: l.phone || '',
    city: l.city || '',
    address: l.address || '',
    source: (l.source || '') as LeadSource | '',
    is_working: l.is_working ?? true,
  }
}

export type LeadFormErrors = Partial<Record<keyof LeadFormState, string>>

export function validateLead(f: LeadFormState): LeadFormErrors {
  const errors: LeadFormErrors = {}
  if (f.is_agency_client === null) errors.is_agency_client = 'Indica se è già cliente di agenzia'
  if (!f.email.trim() && !f.phone.trim()) {
    errors.email = 'Serve almeno un recapito: email o telefono'
    errors.phone = 'Serve almeno un recapito: email o telefono'
  }
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) {
    errors.email = 'Indirizzo email non valido'
  }
  const hasPerson = !!f.first_name.trim() && !!f.last_name.trim()
  if (!hasPerson && !f.company_name.trim()) {
    errors.last_name = 'Inserisci nome e cognome, oppure la ragione sociale'
  }
  return errors
}

export function LeadDetail({
  lead,
  form,
  onFormChange,
  errors,
  onSave,
  onCancel,
  onDelete,
  saving,
  assignableAdvisors,
  canAssign,
  advisorsByUserId,
}: {
  lead: Lead | null
  form: LeadFormState
  onFormChange: (patch: Partial<LeadFormState>) => void
  errors: LeadFormErrors
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  saving: boolean
  assignableAdvisors: Advisor[]
  canAssign: boolean
  advisorsByUserId: Map<string, Advisor>
}) {
  const [tab, setTab] = useState<TabKey>('anagrafica')
  const leadId = lead?.id || null

  const activities = useChildTable<any>('activities', 'id,ts,channel,outcome,notes', leadId)
  const appointments = useChildTable<any>('appointments', 'id,ts,mode,notes', leadId)
  const reminders = useChildTable<any>('reminders', 'id,ts,mode,notes', leadId)
  const proposals = useChildTable<any>('proposals', 'id,ts,line,premium,notes', leadId)
  const contracts = useChildTable<any>('contracts', 'id,ts,contract_type,amount,premium_annual,notes', leadId)

  const tabs: TabItem<TabKey>[] = [
    { value: 'anagrafica', label: 'Anagrafica', icon: 'user' },
    { value: 'contatti', label: 'Contatti', icon: 'phone', count: activities.rows.length },
    { value: 'appuntamenti', label: 'Appuntamenti', icon: 'calendar', count: appointments.rows.length },
    { value: 'promemoria', label: 'Promemoria', icon: 'bell', count: reminders.rows.length },
    { value: 'proposte', label: 'Proposte', icon: 'fileText', count: proposals.rows.length },
    { value: 'contratti', label: 'Contratti', icon: 'checkCircle', count: contracts.rows.length },
  ]

  const owner = form.owner_id ? advisorsByUserId.get(form.owner_id) : null

  return (
    <Card>
      <CardHeader
        title={lead ? leadName(lead) : 'Nuovo lead'}
        subtitle={
          lead ? (
            <span className="gu-row-tight" style={{ gap: 6 }}>
              <Badge tone={form.is_working ? 'accent' : 'neutral'} dot>
                {form.is_working ? 'In lavorazione' : 'Lavorazione sospesa'}
              </Badge>
              {owner && <span>Assegnato a {displayName(owner)}</span>}
            </span>
          ) : (
            'Compila i dati e salva per iniziare a lavorarlo'
          )
        }
        actions={
          <>
            {lead && (
              <Button
                variant={form.is_working ? 'secondary' : 'accent'}
                icon={form.is_working ? 'pause' : 'play'}
                onClick={() => onFormChange({ is_working: !form.is_working })}
                title={form.is_working ? 'Sospendi la lavorazione' : 'Riprendi la lavorazione'}
              >
                {form.is_working ? 'Sospendi' : 'Riprendi'}
              </Button>
            )}
            {lead && <Button variant="danger-soft" icon="trash" onClick={onDelete} aria-label="Elimina lead" />}
          </>
        }
      />

      <div style={{ padding: '0 var(--gu-space-4)' }}>
        <Tabs value={tab} items={lead ? tabs : tabs.slice(0, 1)} onChange={setTab} ariaLabel="Sezioni del lead" />
      </div>

      <CardBody>
        {tab === 'anagrafica' && (
          <form
            className="gu-stack"
            onSubmit={e => {
              e.preventDefault()
              onSave()
            }}
          >
            {canAssign && (
              <SelectField
                label="Assegnato a"
                value={form.owner_id || ''}
                onChange={e => onFormChange({ owner_id: e.target.value || null })}
                hint="Chi lavorerà questo lead e lo vedrà nella propria lista."
              >
                <option value="">— Seleziona un advisor —</option>
                {['Team Lead', 'Junior'].map(role => {
                  const group = assignableAdvisors.filter(a => a.role === role && a.user_id)
                  if (!group.length) return null
                  return (
                    <optgroup key={role} label={role}>
                      {group.map(a => (
                        <option key={a.user_id!} value={a.user_id!}>
                          {displayName(a)}
                        </option>
                      ))}
                    </optgroup>
                  )
                })}
              </SelectField>
            )}

            <RadioGroup
              label="Già cliente di agenzia?"
              required
              value={form.is_agency_client === null ? null : form.is_agency_client ? 'si' : 'no'}
              options={[
                { value: 'si', label: 'Sì' },
                { value: 'no', label: 'No' },
              ]}
              onChange={v => onFormChange({ is_agency_client: v === 'si' })}
              error={errors.is_agency_client}
            />

            <div className="gu-grid gu-grid--2">
              <TextField
                label="Nome"
                value={form.first_name}
                onChange={e => onFormChange({ first_name: e.target.value })}
                autoComplete="given-name"
              />
              <TextField
                label="Cognome"
                value={form.last_name}
                onChange={e => onFormChange({ last_name: e.target.value })}
                error={errors.last_name}
                autoComplete="family-name"
              />
            </div>

            <TextField
              label="Ragione sociale"
              value={form.company_name}
              onChange={e => onFormChange({ company_name: e.target.value })}
              hint="Compila in alternativa a nome e cognome, per i lead aziendali."
            />

            <div className="gu-grid gu-grid--2">
              <TextField
                label="Email"
                type="email"
                value={form.email}
                onChange={e => onFormChange({ email: e.target.value })}
                error={errors.email}
                autoComplete="email"
              />
              <TextField
                label="Telefono"
                type="tel"
                value={form.phone}
                onChange={e => onFormChange({ phone: e.target.value })}
                error={errors.phone}
                autoComplete="tel"
              />
            </div>

            <div className="gu-grid gu-grid--2">
              <TextField label="Città" value={form.city} onChange={e => onFormChange({ city: e.target.value })} />
              <TextField label="Indirizzo" value={form.address} onChange={e => onFormChange({ address: e.target.value })} />
            </div>

            <SelectField
              label="Fonte"
              value={form.source}
              onChange={e => onFormChange({ source: e.target.value as LeadSource | '' })}
            >
              <option value="">— Non specificata —</option>
              {(Object.keys(SOURCE_LABEL) as LeadSource[]).map(s => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </SelectField>

            <div className="gu-row" style={{ justifyContent: 'flex-end', paddingTop: 'var(--gu-space-2)' }}>
              <Button variant="ghost" onClick={onCancel}>
                Annulla
              </Button>
              <Button type="submit" variant="primary" icon="check" loading={saving}>
                {lead ? 'Salva modifiche' : 'Crea lead'}
              </Button>
            </div>
          </form>
        )}

        {tab === 'contatti' && <ContactsTab lead={lead!} table={activities} />}
        {tab === 'appuntamenti' && <AppointmentsTab table={appointments} owner={owner} form={form} />}
        {tab === 'promemoria' && <RemindersTab table={reminders} owner={owner} form={form} />}
        {tab === 'proposte' && <ProposalsTab table={proposals} />}
        {tab === 'contratti' && <ContractsTab table={contracts} />}
      </CardBody>
    </Card>
  )
}

/* ========================================================================== */
/* Hook comune alle schede                                                     */
/* ========================================================================== */

function useTimelineTab<D>(
  table: ReturnType<typeof useChildTable<any>>,
  emptyDraft: D,
  label: string,
) {
  const toast = useToast()
  const confirm = useConfirm()
  const [draft, setDraft] = useState<D>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setDraft(emptyDraft)
    setEditingId(null)
  }

  const submit = async (
    payload: Record<string, unknown>,
    onInserted?: () => Promise<void> | void,
  ) => {
    setSaving(true)
    try {
      if (editingId) {
        await table.update(editingId, payload)
        toast.success(`${label} aggiornato`)
      } else {
        await table.insert(payload)
        toast.success(`${label} registrato`)
        await onInserted?.()
      }
      reset()
    } catch (e) {
      toast.error(`Salvataggio non riuscito`, errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    const ok = await confirm({ title: `Eliminare questo ${label.toLowerCase()}?`, confirmLabel: 'Elimina' })
    if (!ok) return
    try {
      await table.remove(id)
      toast.success(`${label} eliminato`)
      if (editingId === id) reset()
    } catch (e) {
      toast.error('Eliminazione non riuscita', errorMessage(e))
    }
  }

  return { draft, setDraft, editingId, setEditingId, saving, reset, submit, remove, toast }
}

/* ========================================================================== */
/* Contatti                                                                    */
/* ========================================================================== */

function ContactsTab({ lead, table }: { lead: Lead; table: ReturnType<typeof useChildTable<any>> }) {
  const empty = { ts: toLocalInput(new Date().toISOString()), channel: 'phone', outcome: 'spoke', notes: '' }
  const tab = useTimelineTab(table, empty, 'Contatto')
  const d = tab.draft

  const items: TimelineItem[] = table.rows.map(r => ({
    id: r.id,
    ts: r.ts,
    title: labelOf(CHANNELS, r.channel),
    notes: r.notes,
    badge: labelOf(OUTCOMES, r.outcome),
    tone: OUTCOMES.find(o => o.value === r.outcome)?.tone,
    icon: CHANNELS.find(c => c.value === r.channel)?.icon || 'phone',
  }))

  return (
    <div className="gu-stack">
      <TimelineForm
        editing={!!tab.editingId}
        saving={tab.saving}
        disabled={!isValidLocalInput(d.ts)}
        submitLabel="Registra contatto"
        onCancel={tab.reset}
        onSubmit={() =>
          tab.submit({
            ts: fromLocalInput(d.ts),
            channel: d.channel,
            outcome: d.outcome,
            notes: d.notes.trim() || null,
          })
        }
      >
        <div className="gu-grid gu-grid--3">
          <TextField
            label="Data e ora"
            type="datetime-local"
            required
            value={d.ts}
            onChange={e => tab.setDraft({ ...d, ts: e.target.value })}
            error={d.ts && !isValidLocalInput(d.ts) ? 'Data non valida' : null}
          />
          <SelectField label="Canale" value={d.channel} onChange={e => tab.setDraft({ ...d, channel: e.target.value })}>
            {CHANNELS.map(c => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Esito" value={d.outcome} onChange={e => tab.setDraft({ ...d, outcome: e.target.value })}>
            {OUTCOMES.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
        </div>
        <TextareaField
          label="Note"
          maxLength={240}
          rows={2}
          value={d.notes}
          onChange={e => tab.setDraft({ ...d, notes: e.target.value })}
          hint={`${d.notes.length}/240`}
        />
      </TimelineForm>

      <Timeline
        items={items}
        loading={table.loading}
        editingId={tab.editingId}
        emptyTitle="Nessun contatto registrato"
        emptyText={`${leadName(lead)} non è mai stato contattato. Registra il primo tentativo qui sopra.`}
        onEdit={id => {
          const r = table.rows.find(x => x.id === id)
          if (!r) return
          tab.setEditingId(id)
          tab.setDraft({ ts: toLocalInput(r.ts), channel: r.channel, outcome: r.outcome, notes: r.notes || '' })
        }}
        onDelete={tab.remove}
      />
    </div>
  )
}

/* ========================================================================== */
/* Appuntamenti                                                                */
/* ========================================================================== */

function AppointmentsTab({
  table,
  owner,
  form,
}: {
  table: ReturnType<typeof useChildTable<any>>
  owner: Advisor | null | undefined
  form: LeadFormState
}) {
  const empty = { ts: '', mode: 'inperson', notes: '', notify: true }
  const tab = useTimelineTab(table, empty, 'Appuntamento')
  const d = tab.draft

  const items: TimelineItem[] = table.rows.map(r => ({
    id: r.id,
    ts: r.ts,
    title: labelOf(MODES, r.mode),
    notes: r.notes,
    icon: MODES.find(m => m.value === r.mode)?.icon || 'calendar',
  }))

  const clientEmail = form.email.trim()

  async function sendInvite() {
    if (!d.notify || !clientEmail) return
    const clientName = [form.first_name, form.last_name].filter(Boolean).join(' ').trim() || form.company_name || 'Cliente'
    try {
      const { error } = await supabase.functions.invoke('sendAppointmentEmail', {
        body: {
          to_client_email: clientEmail,
          cc_advisor_email: owner?.email || '',
          cliente_nome: clientName,
          advisor_nome: displayName(owner, 'Advisory+'),
          ts_iso: toIsoWithOffset(new Date(d.ts)),
          durata_minuti: 60,
          modalita: labelOf(MODES, d.mode),
          note: d.notes,
          location: '',
          subject: `Promemoria appuntamento – ${clientName}`,
          title: `Appuntamento Advisory+ con ${clientName}`,
        },
      })
      if (error) throw error
      tab.toast.success('Invito inviato', `Email con invito calendario a ${clientEmail}`)
    } catch (e) {
      // L'appuntamento è già salvato: l'email è un di più, non deve sembrare
      // che l'operazione principale sia fallita.
      tab.toast.error("Appuntamento salvato, ma l'invito non è partito", errorMessage(e))
    }
  }

  return (
    <div className="gu-stack">
      <TimelineForm
        editing={!!tab.editingId}
        saving={tab.saving}
        disabled={!isValidLocalInput(d.ts)}
        submitLabel="Fissa appuntamento"
        onCancel={tab.reset}
        onSubmit={() =>
          tab.submit(
            { ts: fromLocalInput(d.ts), mode: d.mode, notes: d.notes.trim() || null },
            sendInvite,
          )
        }
      >
        <div className="gu-grid gu-grid--2">
          <TextField
            label="Data e ora"
            type="datetime-local"
            required
            value={d.ts}
            onChange={e => tab.setDraft({ ...d, ts: e.target.value })}
            error={d.ts && !isValidLocalInput(d.ts) ? 'Data non valida' : null}
          />
          <SelectField label="Modalità" value={d.mode} onChange={e => tab.setDraft({ ...d, mode: e.target.value })}>
            {MODES.map(m => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </SelectField>
        </div>
        <TextareaField
          label="Note"
          maxLength={240}
          rows={2}
          value={d.notes}
          onChange={e => tab.setDraft({ ...d, notes: e.target.value })}
        />
        {!tab.editingId && (
          <label className="gu-check">
            <input
              type="checkbox"
              checked={d.notify && !!clientEmail}
              disabled={!clientEmail}
              onChange={e => tab.setDraft({ ...d, notify: e.target.checked })}
            />
            <span>
              Invia al cliente l'invito con l'evento per il calendario
              {!clientEmail && (
                <span style={{ color: 'var(--gu-text-subtle)' }}> — richiede un indirizzo email sul lead</span>
              )}
            </span>
          </label>
        )}
      </TimelineForm>

      <Timeline
        items={items}
        loading={table.loading}
        editingId={tab.editingId}
        emptyTitle="Nessun appuntamento"
        emptyText="Quando fissi un appuntamento puoi inviare al cliente l'invito per il calendario."
        onEdit={id => {
          const r = table.rows.find(x => x.id === id)
          if (!r) return
          tab.setEditingId(id)
          tab.setDraft({ ts: toLocalInput(r.ts), mode: r.mode, notes: r.notes || '', notify: false })
        }}
        onDelete={tab.remove}
      />
    </div>
  )
}

/* ========================================================================== */
/* Promemoria                                                                  */
/* ========================================================================== */

function RemindersTab({
  table,
  owner,
  form,
}: {
  table: ReturnType<typeof useChildTable<any>>
  owner: Advisor | null | undefined
  form: LeadFormState
}) {
  const { me } = useAuth()
  const empty = { ts: '', mode: 'phone', notes: '' }
  const tab = useTimelineTab(table, empty, 'Promemoria')
  const d = tab.draft

  const items: TimelineItem[] = table.rows.map(r => ({
    id: r.id,
    ts: r.ts,
    title: r.mode ? labelOf(MODES, r.mode) : 'Promemoria',
    notes: r.notes,
    icon: 'bell',
  }))

  async function notifyAdvisor() {
    const to = owner?.email?.trim()
    if (!to) return
    const clientName = [form.first_name, form.last_name].filter(Boolean).join(' ').trim() || form.company_name || 'Cliente'
    try {
      const { error } = await supabase.functions.invoke('sendReminderEmail', {
        body: {
          to_advisor_email: to,
          advisor_nome: displayName(owner, 'Advisory+'),
          cliente_nome: clientName,
          ts_iso: toIsoWithOffset(new Date(d.ts)),
          durata_minuti: 30,
          note: d.notes,
          location: '',
        },
      })
      if (error) throw error
    } catch (e) {
      tab.toast.error("Promemoria salvato, ma l'email non è partita", errorMessage(e))
    }
  }

  return (
    <div className="gu-stack">
      <Alert tone="info">
        I promemoria sono privati: arrivano via email all'advisor che ha il lead in carico, non al cliente.
      </Alert>

      <TimelineForm
        editing={!!tab.editingId}
        saving={tab.saving}
        disabled={!isValidLocalInput(d.ts)}
        submitLabel="Crea promemoria"
        onCancel={tab.reset}
        onSubmit={() =>
          tab.submit(
            {
              ts: fromLocalInput(d.ts),
              mode: d.mode,
              notes: d.notes.trim() || null,
              // `created_by` esiste a schema ma non veniva mai valorizzata.
              created_by: me?.user_id ?? null,
            },
            notifyAdvisor,
          )
        }
      >
        <div className="gu-grid gu-grid--2">
          <TextField
            label="Quando ricordarmelo"
            type="datetime-local"
            required
            value={d.ts}
            onChange={e => tab.setDraft({ ...d, ts: e.target.value })}
            error={d.ts && !isValidLocalInput(d.ts) ? 'Data non valida' : null}
          />
          <SelectField label="Modalità prevista" value={d.mode} onChange={e => tab.setDraft({ ...d, mode: e.target.value })}>
            {MODES.map(m => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </SelectField>
        </div>
        <TextareaField
          label="Cosa devo fare"
          maxLength={240}
          rows={2}
          value={d.notes}
          onChange={e => tab.setDraft({ ...d, notes: e.target.value })}
        />
      </TimelineForm>

      <Timeline
        items={items}
        loading={table.loading}
        editingId={tab.editingId}
        emptyTitle="Nessun promemoria"
        emptyText="Imposta un promemoria per non perdere di vista questo lead."
        onEdit={id => {
          const r = table.rows.find(x => x.id === id)
          if (!r) return
          tab.setEditingId(id)
          tab.setDraft({ ts: toLocalInput(r.ts), mode: r.mode || 'phone', notes: r.notes || '' })
        }}
        onDelete={tab.remove}
      />
    </div>
  )
}

/* ========================================================================== */
/* Proposte                                                                    */
/* ========================================================================== */

function ProposalsTab({ table }: { table: ReturnType<typeof useChildTable<any>> }) {
  const empty = { ts: toDateInput(new Date().toISOString()), line: '', premium: '', notes: '' }
  const tab = useTimelineTab(table, empty, 'Proposta')
  const d = tab.draft

  const items: TimelineItem[] = table.rows.map(r => ({
    id: r.id,
    ts: r.ts,
    title: r.line || 'Proposta',
    meta: formatCurrency(Number(r.premium || 0)),
    notes: r.notes,
    icon: 'fileText',
  }))

  return (
    <div className="gu-stack">
      <TimelineForm
        editing={!!tab.editingId}
        saving={tab.saving}
        disabled={!d.ts || !d.line.trim()}
        submitLabel="Registra proposta"
        onCancel={tab.reset}
        onSubmit={() =>
          tab.submit({
            // proposals.ts è una colonna `date`: si invia la sola data.
            ts: d.ts,
            line: d.line.trim(),
            premium: Number(d.premium || 0),
            notes: d.notes.trim() || null,
          })
        }
      >
        <div className="gu-grid gu-grid--3">
          <TextField
            label="Data"
            type="date"
            required
            value={d.ts}
            onChange={e => tab.setDraft({ ...d, ts: e.target.value })}
          />
          <TextField
            label="Linea / descrizione"
            required
            value={d.line}
            onChange={e => tab.setDraft({ ...d, line: e.target.value })}
            placeholder="Es. RC professionale"
          />
          <TextField
            label="Premio (€)"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={d.premium}
            onChange={e => tab.setDraft({ ...d, premium: e.target.value })}
          />
        </div>
        <TextareaField
          label="Note"
          maxLength={240}
          rows={2}
          value={d.notes}
          onChange={e => tab.setDraft({ ...d, notes: e.target.value })}
        />
      </TimelineForm>

      <Timeline
        items={items}
        loading={table.loading}
        editingId={tab.editingId}
        emptyTitle="Nessuna proposta"
        emptyText="Registra qui i preventivi presentati: alimentano l'imbuto di conversione."
        onEdit={id => {
          const r = table.rows.find(x => x.id === id)
          if (!r) return
          tab.setEditingId(id)
          tab.setDraft({ ts: toDateInput(r.ts), line: r.line || '', premium: String(r.premium ?? ''), notes: r.notes || '' })
        }}
        onDelete={tab.remove}
      />
    </div>
  )
}

/* ========================================================================== */
/* Contratti                                                                   */
/* ========================================================================== */

function ContractsTab({ table }: { table: ReturnType<typeof useChildTable<any>> }) {
  const empty: { ts: string; contract_type: ContractType; amount: string; notes: string } = {
    ts: toDateInput(new Date().toISOString()),
    contract_type: CONTRACT_TYPES[0],
    amount: '',
    notes: '',
  }
  const tab = useTimelineTab(table, empty, 'Contratto')
  const d = tab.draft

  const items: TimelineItem[] = table.rows.map(r => ({
    id: r.id,
    ts: r.ts,
    title: r.contract_type || 'Contratto',
    meta: formatCurrency(Number(r.amount ?? r.premium_annual ?? 0)),
    notes: r.notes,
    icon: 'checkCircle',
    tone: 'success' as const,
  }))

  const total = table.rows.reduce((s, r) => s + Number(r.amount ?? r.premium_annual ?? 0), 0)

  return (
    <div className="gu-stack">
      <TimelineForm
        editing={!!tab.editingId}
        saving={tab.saving}
        disabled={!d.ts}
        submitLabel="Registra contratto"
        onCancel={tab.reset}
        onSubmit={() => {
          const amount = Number(d.amount || 0)
          return tab.submit({
            ts: d.ts,
            contract_type: d.contract_type,
            // `line` e `premium_annual` sono obbligatorie a schema: se non le
            // si valorizza l'inserimento fallisce (o resta a zero e i report
            // non tornano). Vengono tenute allineate ad `amount`.
            line: d.contract_type,
            amount,
            premium_annual: amount,
            notes: d.notes.trim() || null,
          })
        }}
      >
        <div className="gu-grid gu-grid--3">
          <TextField
            label="Data"
            type="date"
            required
            value={d.ts}
            onChange={e => tab.setDraft({ ...d, ts: e.target.value })}
          />
          <SelectField
            label="Tipo di contratto"
            value={d.contract_type}
            onChange={e => tab.setDraft({ ...d, contract_type: e.target.value as ContractType })}
          >
            {CONTRACT_TYPES.map(t => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Premio annuo (€)"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={d.amount}
            onChange={e => tab.setDraft({ ...d, amount: e.target.value })}
          />
        </div>
        <TextareaField
          label="Note"
          maxLength={240}
          rows={2}
          value={d.notes}
          onChange={e => tab.setDraft({ ...d, notes: e.target.value })}
        />
      </TimelineForm>

      {table.rows.length > 0 && (
        <div
          className="gu-row"
          style={{
            justifyContent: 'space-between',
            padding: 'var(--gu-space-3)',
            background: 'var(--gu-success-soft)',
            borderRadius: 'var(--gu-radius-md)',
          }}
        >
          <span className="gu-row-tight" style={{ fontWeight: 600, color: 'var(--gu-success-fg)' }}>
            <Icon name="trendUp" size={16} />
            Produzione su questo lead
          </span>
          <strong style={{ color: 'var(--gu-success-fg)', fontSize: 'var(--gu-text-lg)' }}>
            {formatCurrency(total)}
          </strong>
        </div>
      )}

      <Timeline
        items={items}
        loading={table.loading}
        editingId={tab.editingId}
        emptyTitle="Nessun contratto"
        emptyText="I contratti firmati chiudono l'imbuto e alimentano i report di produzione."
        onEdit={id => {
          const r = table.rows.find(x => x.id === id)
          if (!r) return
          tab.setEditingId(id)
          tab.setDraft({
            ts: toDateInput(r.ts),
            contract_type: r.contract_type || CONTRACT_TYPES[0],
            amount: String(r.amount ?? r.premium_annual ?? ''),
            notes: r.notes || '',
          })
        }}
        onDelete={tab.remove}
      />
    </div>
  )
}
