import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Icon,
  IconButton,
  Modal,
  Segmented,
  SelectField,
  Skeleton,
  TextField,
  TextareaField,
  useConfirm,
  useToast,
} from '../ui'
import { PageHeader } from '../app/AppShell'
import { ScopeSelect } from '../app/ScopeSelect'
import { useAdvisors, type Scope } from '../lib/useAdvisors'
import { fetchAllPages, inChunks } from '../lib/db'
import { MODES, labelOf, leadName, type Lead } from '../lib/domain'
import {
  addDays,
  dayKey,
  fromLocalInput,
  isValidLocalInput,
  monthKeyOf,
  parseMonthKey,
  sameDay,
  startOfWeek,
  toIsoWithOffset,
  toLocalInput,
} from '../lib/datetime'
import { displayName, errorMessage, formatFullDay, formatTime } from '../lib/format'

type Appointment = {
  id: string
  lead_id: string
  ts: string
  mode: string
  notes: string | null
}

type Draft = {
  id: string | null
  lead_id: string
  ts: string
  mode: string
  notes: string
  notify: boolean
}

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
const MAX_PREVIEW = 3

export default function CalendarPage({ onOpenLead }: { onOpenLead: (id: string) => void }) {
  const { resolveScope, scopeOptions, defaultScope, byUserId } = useAdvisors()
  const toast = useToast()
  const confirm = useConfirm()

  const [scope, setScope] = useState<Scope | null>(null)
  const [month, setMonth] = useState(() => monthKeyOf(new Date()))
  const [view, setView] = useState<'month' | 'week'>('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const [leads, setLeads] = useState<Lead[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [dayOpen, setDayOpen] = useState<Date | null>(null)

  useEffect(() => {
    if (!scope) setScope(defaultScope)
  }, [defaultScope, scope])

  const ownerIds = useMemo(() => (scope ? resolveScope(scope) : []), [scope, resolveScope])
  const ownerKey = ownerIds.join(',')

  const load = useCallback(async () => {
    if (!ownerIds.length) {
      setLeads([])
      setAppointments([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const { year, month: m } = parseMonthKey(month)
      // La vista settimanale può sconfinare nel mese precedente o successivo:
      // si carica un margine di una settimana per lato.
      const start = addDays(new Date(year, m - 1, 1), -7).toISOString()
      const end = addDays(new Date(year, m, 1), 7).toISOString()

      const leadRows = await inChunks(ownerIds, slice =>
        fetchAllPages<Lead>(
          () =>
            supabase
              .from('leads')
              .select('id,owner_id,first_name,last_name,company_name')
              .in('owner_id', slice) as never,
        ),
      )
      setLeads(leadRows)

      const appts = await inChunks(leadRows.map(l => l.id), slice =>
        fetchAllPages<Appointment>(
          () =>
            supabase
              .from('appointments')
              .select('id,lead_id,ts,mode,notes')
              .in('lead_id', slice)
              .gte('ts', start)
              .lt('ts', end)
              .order('ts', { ascending: true }) as never,
        ),
      )
      setAppointments(appts)
    } catch (e) {
      setError(errorMessage(e, 'Impossibile caricare il calendario'))
    } finally {
      setLoading(false)
    }
  }, [ownerKey, month])

  useEffect(() => {
    void load()
  }, [load])

  const leadById = useMemo(() => new Map(leads.map(l => [l.id, l])), [leads])

  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const a of appointments) {
      const k = dayKey(new Date(a.ts))
      const arr = map.get(k)
      if (arr) arr.push(a)
      else map.set(k, [a])
    }
    for (const arr of map.values()) arr.sort((x, y) => x.ts.localeCompare(y.ts))
    return map
  }, [appointments])

  const monthGrid = useMemo(() => {
    const { year, month: m } = parseMonthKey(month)
    const first = new Date(year, m - 1, 1)
    const offset = (first.getDay() + 6) % 7
    const cells: { date: Date; inMonth: boolean }[] = []
    for (let i = 0; i < 42; i++) {
      const date = addDays(first, i - offset)
      cells.push({ date, inMonth: date.getMonth() === m - 1 })
    }
    return cells
  }, [month])

  function openCreate(date: Date) {
    const at = new Date(date)
    if (at.getHours() === 0) at.setHours(9, 0, 0, 0)
    setDraft({ id: null, lead_id: '', ts: toLocalInput(at.toISOString()), mode: 'inperson', notes: '', notify: false })
  }

  function openEdit(a: Appointment) {
    setDraft({ id: a.id, lead_id: a.lead_id, ts: toLocalInput(a.ts), mode: a.mode, notes: a.notes || '', notify: false })
  }

  async function save() {
    if (!draft) return
    if (!draft.lead_id) {
      toast.error('Seleziona il lead a cui si riferisce l’appuntamento')
      return
    }
    if (!isValidLocalInput(draft.ts)) {
      toast.error('Imposta una data e un’ora valide')
      return
    }
    setSaving(true)
    try {
      const payload = {
        lead_id: draft.lead_id,
        ts: fromLocalInput(draft.ts),
        mode: draft.mode,
        notes: draft.notes.trim() || null,
      }
      if (draft.id) {
        const { error } = await supabase.from('appointments').update(payload).eq('id', draft.id)
        if (error) throw error
        toast.success('Appuntamento aggiornato')
      } else {
        const { error } = await supabase.from('appointments').insert(payload)
        if (error) throw error
        toast.success('Appuntamento creato')
        if (draft.notify) await sendInvite(draft)
      }
      setDraft(null)
      await load()
    } catch (e) {
      toast.error('Salvataggio non riuscito', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function sendInvite(d: Draft) {
    const lead = leadById.get(d.lead_id)
    if (!lead) return
    // Il nome non basta: per l'invito serve l'email, che in questa vista non è
    // caricata. Si legge solo al momento dell'invio.
    const { data } = await supabase.from('leads').select('email,owner_id').eq('id', d.lead_id).maybeSingle()
    const clientEmail = (data?.email || '').trim()
    if (!clientEmail) {
      toast.info('Invito non inviato', 'Il lead non ha un indirizzo email.')
      return
    }
    const owner = data?.owner_id ? byUserId.get(data.owner_id) : null
    try {
      const { error } = await supabase.functions.invoke('sendAppointmentEmail', {
        body: {
          to_client_email: clientEmail,
          cc_advisor_email: owner?.email || '',
          cliente_nome: leadName(lead),
          advisor_nome: displayName(owner, 'Advisory+'),
          ts_iso: toIsoWithOffset(new Date(d.ts)),
          durata_minuti: 60,
          modalita: labelOf(MODES, d.mode),
          note: d.notes,
          location: '',
        },
      })
      if (error) throw error
      toast.success('Invito inviato al cliente')
    } catch (e) {
      toast.error("Appuntamento salvato, ma l'invito non è partito", errorMessage(e))
    }
  }

  async function remove(id: string) {
    const ok = await confirm({ title: 'Eliminare questo appuntamento?', confirmLabel: 'Elimina' })
    if (!ok) return
    try {
      const { error } = await supabase.from('appointments').delete().eq('id', id)
      if (error) throw error
      setAppointments(list => list.filter(a => a.id !== id))
      toast.success('Appuntamento eliminato')
    } catch (e) {
      toast.error('Eliminazione non riuscita', errorMessage(e))
    }
  }

  const shiftMonth = (delta: number) => {
    const { year, month: m } = parseMonthKey(month)
    const next = new Date(year, m - 1 + delta, 1)
    setMonth(monthKeyOf(next))
    setAnchor(next)
  }

  const weekDays = useMemo(() => {
    const start = startOfWeek(anchor)
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }, [anchor])

  const renderCard = (a: Appointment, compact = false) => {
    const lead = leadById.get(a.lead_id)
    const owner = lead?.owner_id ? byUserId.get(lead.owner_id) : null
    return (
      <div
        key={a.id}
        style={{
          border: '1px solid var(--gu-border)',
          borderLeft: '3px solid var(--gu-chart-1)',
          borderRadius: 'var(--gu-radius-sm)',
          padding: '6px 8px',
          background: 'var(--gu-n-25)',
          display: 'grid',
          gap: 2,
        }}
      >
        <div className="gu-row" style={{ justifyContent: 'space-between', gap: 4, flexWrap: 'nowrap' }}>
          <span style={{ fontSize: 'var(--gu-text-xs)', fontWeight: 700 }}>{formatTime(a.ts)}</span>
          <span className="gu-row-tight" style={{ gap: 0 }}>
            <IconButton icon="edit" label="Modifica appuntamento" size="sm" onClick={() => openEdit(a)} />
            <IconButton icon="trash" label="Elimina appuntamento" size="sm" tone="danger" onClick={() => remove(a.id)} />
          </span>
        </div>
        <button
          type="button"
          onClick={() => onOpenLead(a.lead_id)}
          className="gu-truncate"
          style={{
            border: 0,
            background: 'none',
            padding: 0,
            textAlign: 'left',
            fontSize: 'var(--gu-text-xs)',
            fontWeight: 600,
            color: 'var(--gu-primary)',
          }}
          title={`Apri la scheda di ${leadName(lead)}`}
        >
          {leadName(lead)}
        </button>
        {!compact && (
          <div className="gu-row-tight" style={{ fontSize: 'var(--gu-text-2xs)', color: 'var(--gu-text-subtle)', gap: 4 }}>
            <Icon name={MODES.find(m => m.value === a.mode)?.icon || 'mapPin'} size={11} />
            {labelOf(MODES, a.mode)}
            {owner && <span className="gu-truncate">· {displayName(owner)}</span>}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title="Calendario"
        description="Appuntamenti della rete, per mese o per settimana."
        actions={
          <Button variant="primary" icon="plus" onClick={() => openCreate(new Date())}>
            Nuovo appuntamento
          </Button>
        }
      />

      <div className="gu-filters">
        {scope && <ScopeSelect value={scope} onChange={setScope} options={scopeOptions} />}

        <div className="gu-field">
          <span className="gu-field__label">Periodo</span>
          <div className="gu-row-tight">
            <IconButton icon="chevronLeft" label="Mese precedente" onClick={() => shiftMonth(-1)} />
            <input
              className="gu-input"
              type="month"
              value={month}
              aria-label="Mese visualizzato"
              onChange={e => {
                if (!e.target.value) return
                setMonth(e.target.value)
                const { year, month: m } = parseMonthKey(e.target.value)
                setAnchor(new Date(year, m - 1, 1))
              }}
              style={{ width: 168 }}
            />
            <IconButton icon="chevronRight" label="Mese successivo" onClick={() => shiftMonth(1)} />
          </div>
        </div>

        <div className="gu-field">
          <span className="gu-field__label">Vista</span>
          <Segmented
            value={view}
            onChange={setView}
            ariaLabel="Tipo di vista"
            options={[
              { value: 'month', label: 'Mese' },
              { value: 'week', label: 'Settimana' },
            ]}
          />
        </div>

        <div className="gu-spacer" />
        <Button
          icon="clock"
          onClick={() => {
            const now = new Date()
            setMonth(monthKeyOf(now))
            setAnchor(now)
          }}
        >
          Oggi
        </Button>
      </div>

      {error && <Alert tone="danger" title="Errore">{error}</Alert>}

      {loading ? (
        <Card>
          <CardBody>
            <Skeleton height={480} radius={12} />
          </CardBody>
        </Card>
      ) : view === 'month' ? (
        <Card>
          <CardBody>
            <div className="gu-cal__head">
              {WEEKDAYS.map(d => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="gu-cal__grid">
              {monthGrid.map((cell, i) => {
                const items = byDay.get(dayKey(cell.date)) || []
                const today = sameDay(cell.date, new Date())
                const preview = items.slice(0, MAX_PREVIEW)
                const hidden = items.length - preview.length
                return (
                  <div key={i} className="gu-cal__cell" data-outside={!cell.inMonth} data-today={today}>
                    <div className="gu-cal__cell-head">
                      <span className="gu-cal__day">{cell.date.getDate()}</span>
                      <IconButton
                        icon="plus"
                        label={`Nuovo appuntamento il ${cell.date.toLocaleDateString('it-IT')}`}
                        size="sm"
                        onClick={() => openCreate(cell.date)}
                      />
                    </div>
                    <div className="gu-cal__items">{preview.map(a => renderCard(a, true))}</div>
                    {hidden > 0 && (
                      <button type="button" className="gu-cal__more" onClick={() => setDayOpen(cell.date)}>
                        +{hidden} altri
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <div className="gu-row" style={{ justifyContent: 'space-between', marginBottom: 'var(--gu-space-3)' }}>
              <div className="gu-row-tight">
                <IconButton icon="chevronLeft" label="Settimana precedente" onClick={() => setAnchor(d => addDays(d, -7))} />
                <strong>
                  {weekDays[0].toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })} –{' '}
                  {weekDays[6].toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
                </strong>
                <IconButton icon="chevronRight" label="Settimana successiva" onClick={() => setAnchor(d => addDays(d, 7))} />
              </div>
            </div>
            <div className="gu-cal__head">
              {WEEKDAYS.map(d => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="gu-cal__grid gu-cal__grid--week">
              {weekDays.map((d, i) => {
                const items = byDay.get(dayKey(d)) || []
                return (
                  <div key={i} className="gu-cal__cell" data-today={sameDay(d, new Date())}>
                    <div className="gu-cal__cell-head">
                      <span className="gu-cal__day">
                        {d.getDate()}/{d.getMonth() + 1}
                      </span>
                      <IconButton icon="plus" label="Nuovo appuntamento" size="sm" onClick={() => openCreate(d)} />
                    </div>
                    <div className="gu-cal__items">
                      {items.length === 0 ? (
                        <span style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)' }}>Libero</span>
                      ) : (
                        items.map(a => renderCard(a))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {!loading && appointments.length === 0 && (
        <EmptyState
          icon="calendar"
          title="Nessun appuntamento in questo periodo"
          text="Fissa un appuntamento dal calendario o dalla scheda di un lead."
          action={
            <Button variant="primary" icon="plus" onClick={() => openCreate(new Date())}>
              Nuovo appuntamento
            </Button>
          }
        />
      )}

      {/* Dettaglio giornata */}
      <Modal
        open={!!dayOpen}
        onClose={() => setDayOpen(null)}
        title={dayOpen ? formatFullDay(dayOpen) : ''}
        description="Tutti gli appuntamenti della giornata"
        width={560}
      >
        <div className="gu-stack-sm">{dayOpen && (byDay.get(dayKey(dayOpen)) || []).map(a => renderCard(a))}</div>
      </Modal>

      {/* Editor */}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Modifica appuntamento' : 'Nuovo appuntamento'}
        width={480}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Annulla
            </Button>
            <Button variant="primary" icon="check" onClick={save} loading={saving}>
              Salva
            </Button>
          </>
        }
      >
        {draft && (
          <div className="gu-stack">
            <SelectField
              label="Lead"
              required
              value={draft.lead_id}
              onChange={e => setDraft({ ...draft, lead_id: e.target.value })}
              hint={`${leads.length} lead nel perimetro selezionato`}
            >
              <option value="">— Seleziona —</option>
              {[...leads]
                .sort((a, b) => leadName(a).localeCompare(leadName(b), 'it'))
                .map(l => (
                  <option key={l.id} value={l.id}>
                    {leadName(l)}
                  </option>
                ))}
            </SelectField>

            <TextField
              label="Data e ora"
              type="datetime-local"
              required
              value={draft.ts}
              onChange={e => setDraft({ ...draft, ts: e.target.value })}
              error={draft.ts && !isValidLocalInput(draft.ts) ? 'Data non valida' : null}
            />

            <SelectField label="Modalità" value={draft.mode} onChange={e => setDraft({ ...draft, mode: e.target.value })}>
              {MODES.map(m => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </SelectField>

            <TextareaField
              label="Note"
              rows={2}
              maxLength={240}
              value={draft.notes}
              onChange={e => setDraft({ ...draft, notes: e.target.value })}
            />

            {!draft.id && (
              <label className="gu-check">
                <input type="checkbox" checked={draft.notify} onChange={e => setDraft({ ...draft, notify: e.target.checked })} />
                <span>Invia al cliente l'invito con l'evento per il calendario</span>
              </label>
            )}
          </div>
        )}
      </Modal>

      {appointments.length > 0 && (
        <div className="gu-row" style={{ justifyContent: 'center' }}>
          <Badge tone="neutral">
            {appointments.length} appuntamenti nel periodo caricato
          </Badge>
        </div>
      )}
    </>
  )
}
