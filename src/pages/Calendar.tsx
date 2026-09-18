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
import { useScopeParam } from '../app/ScopeProvider'
import { useAdvisors } from '../lib/useAdvisors'
import { useDebounced } from '../lib/filters'
import { applyTextSearch, isSearchable } from '../lib/search'
import { fetchAllPages, inChunks, uniq } from '../lib/db'
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
import type { NavigateFn, Route } from '../lib/router'

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
  leadLabel: string
  ts: string
  mode: string
  notes: string
  notify: boolean
}

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
const MAX_PREVIEW = 3
const ADVISOR_COLORS = [
  'var(--gu-chart-1)',
  'var(--gu-chart-2)',
  'var(--gu-chart-4)',
  'var(--gu-chart-3)',
  'var(--gu-chart-5)',
]

export default function CalendarPage({
  route,
  go,
  onOpenLead,
}: {
  route: Route
  go: NavigateFn
  onOpenLead: (id: string) => void
}) {
  const { resolveScope, scopeOptions, byUserId } = useAdvisors()
  const { scope, setScope } = useScopeParam(route, go)
  const toast = useToast()
  const confirm = useConfirm()

  /**
   * Una sola data di riferimento.
   *
   * Prima ce n'erano due, `month` e `anchor`: il caricamento dipendeva dalla
   * prima, le frecce della vista settimanale muovevano solo la seconda. Avanzare
   * di tre settimane mostrava quindi giorni vuoti — gli appuntamenti c'erano, ma
   * non erano mai stati chiesti al database. E la griglia mensile disegna 42
   * caselle mentre la query ne copriva sette oltre la fine del mese: le ultime
   * caselle risultavano vuote comunque.
   */
  const [anchor, setAnchor] = useState(() => new Date())
  const [view, setView] = useState<'month' | 'week'>('month')
  const [modeFilter, setModeFilter] = useState('tutte')

  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [leadsById, setLeadsById] = useState<Map<string, Lead>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [dayOpen, setDayOpen] = useState<Date | null>(null)

  const ownerIds = useMemo(() => (scope ? resolveScope(scope) : []), [scope, resolveScope])
  const ownerKey = ownerIds.join(',')
  const colorOf = useCallback(
    (userId: string | null | undefined) => {
      if (!userId) return ADVISOR_COLORS[0]
      const i = ownerIds.indexOf(userId)
      return ADVISOR_COLORS[(i < 0 ? 0 : i) % ADVISOR_COLORS.length]
    },
    [ownerKey],
  )

  /** Esattamente le giornate disegnate a schermo, né una di più né una di meno. */
  const visible = useMemo(() => {
    if (view === 'week') {
      const start = startOfWeek(anchor)
      return { start, days: Array.from({ length: 7 }, (_, i) => addDays(start, i)) }
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const start = startOfWeek(first)
    return { start, days: Array.from({ length: 42 }, (_, i) => addDays(start, i)) }
  }, [anchor, view])

  const rangeStart = visible.days[0].toISOString()
  const rangeEnd = addDays(visible.days[visible.days.length - 1], 1).toISOString()

  const load = useCallback(async () => {
    if (!ownerIds.length) {
      setAppointments([])
      setLeadsById(new Map())
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      // Si parte dai lead del perimetro per i soli id, poi si chiedono gli
      // appuntamenti della finestra visibile e infine SOLO i lead che vi
      // compaiono. Prima venivano scaricati tutti i lead del perimetro con
      // nome e cognome per riempire una tendina: con la rete intera erano
      // migliaia di righe a ogni cambio di mese.
      const owned = await inChunks(ownerIds, slice =>
        fetchAllPages<{ id: string }>(() => supabase.from('leads').select('id').in('owner_id', slice) as never),
      )
      const ownedIds = owned.map(l => l.id)

      const appts = await inChunks(ownedIds, slice =>
        fetchAllPages<Appointment>(
          () =>
            supabase
              .from('appointments')
              .select('id,lead_id,ts,mode,notes')
              .in('lead_id', slice)
              .gte('ts', rangeStart)
              .lt('ts', rangeEnd)
              .order('ts', { ascending: true }) as never,
        ),
      )
      setAppointments(appts)

      const referenced = uniq(appts.map(a => a.lead_id))
      const leadRows = await inChunks(referenced, slice =>
        fetchAllPages<Lead>(
          () =>
            supabase
              .from('leads')
              .select('id,owner_id,first_name,last_name,company_name')
              .in('id', slice) as never,
        ),
      )
      setLeadsById(new Map(leadRows.map(l => [l.id, l])))
    } catch (e) {
      setError(errorMessage(e, 'Impossibile caricare il calendario'))
    } finally {
      setLoading(false)
    }
  }, [ownerKey, rangeStart, rangeEnd])

  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(
    () => (modeFilter === 'tutte' ? appointments : appointments.filter(a => a.mode === modeFilter)),
    [appointments, modeFilter],
  )

  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const a of shown) {
      const k = dayKey(new Date(a.ts))
      const arr = map.get(k)
      if (arr) arr.push(a)
      else map.set(k, [a])
    }
    for (const arr of map.values()) arr.sort((x, y) => x.ts.localeCompare(y.ts))
    return map
  }, [shown])

  function openCreate(date: Date) {
    const at = new Date(date)
    if (at.getHours() === 0) at.setHours(9, 0, 0, 0)
    setDraft({
      id: null,
      lead_id: '',
      leadLabel: '',
      ts: toLocalInput(at.toISOString()),
      mode: 'inperson',
      notes: '',
      notify: false,
    })
  }

  function openEdit(a: Appointment) {
    setDraft({
      id: a.id,
      lead_id: a.lead_id,
      leadLabel: leadName(leadsById.get(a.lead_id)),
      ts: toLocalInput(a.ts),
      mode: a.mode,
      notes: a.notes || '',
      notify: false,
    })
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
    // Il nome non basta: per l'invito serve l'email, che in questa vista non è
    // caricata. Si legge solo al momento dell'invio.
    const { data } = await supabase.from('leads').select('email,owner_id,first_name,last_name,company_name').eq('id', d.lead_id).maybeSingle()
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
          cliente_nome: leadName(data as Lead),
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

  const monthKey = monthKeyOf(anchor)
  const shiftPeriod = (delta: number) =>
    setAnchor(d =>
      view === 'week' ? addDays(d, delta * 7) : new Date(d.getFullYear(), d.getMonth() + delta, 1),
    )

  const renderCard = (a: Appointment, compact = false) => {
    const lead = leadsById.get(a.lead_id)
    const owner = lead?.owner_id ? byUserId.get(lead.owner_id) : null
    const past = new Date(a.ts).getTime() < Date.now()
    return (
      <div
        key={a.id}
        style={{
          border: '1px solid var(--gu-border)',
          // Un colore per advisor: con il perimetro su tutta la rete gli
          // appuntamenti di sette persone erano graficamente identici.
          borderLeft: `3px solid ${colorOf(lead?.owner_id)}`,
          borderRadius: 'var(--gu-radius-sm)',
          padding: '6px 8px',
          background: 'var(--gu-n-25)',
          opacity: past ? 0.65 : 1,
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
        {scope && scopeOptions.length > 1 && <ScopeSelect value={scope} onChange={setScope} options={scopeOptions} />}

        <div className="gu-field">
          <span className="gu-field__label">{view === 'week' ? 'Settimana' : 'Mese'}</span>
          <div className="gu-row-tight">
            <IconButton
              icon="chevronLeft"
              label={view === 'week' ? 'Settimana precedente' : 'Mese precedente'}
              onClick={() => shiftPeriod(-1)}
            />
            <input
              className="gu-input"
              type="month"
              value={monthKey}
              aria-label="Mese visualizzato"
              onChange={e => {
                if (!e.target.value) return
                const { year, month: m } = parseMonthKey(e.target.value)
                setAnchor(new Date(year, m - 1, 1))
              }}
              style={{ width: 160 }}
            />
            <IconButton
              icon="chevronRight"
              label={view === 'week' ? 'Settimana successiva' : 'Mese successivo'}
              onClick={() => shiftPeriod(1)}
            />
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

        <SelectField
          label="Modalità"
          value={modeFilter}
          onChange={e => setModeFilter(e.target.value)}
          style={{ minWidth: 145 }}
        >
          <option value="tutte">Tutte</option>
          {MODES.map(m => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </SelectField>

        <div className="gu-spacer" />
        <Button icon="clock" onClick={() => setAnchor(new Date())}>
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
      ) : (
        <Card>
          <CardBody>
            {view === 'week' && (
              <div className="gu-row" style={{ justifyContent: 'center', marginBottom: 'var(--gu-space-3)' }}>
                <strong>
                  {visible.days[0].toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })} –{' '}
                  {visible.days[6].toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}
                </strong>
              </div>
            )}
            <div className="gu-cal__head">
              {WEEKDAYS.map(d => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className={`gu-cal__grid${view === 'week' ? ' gu-cal__grid--week' : ''}`}>
              {visible.days.map((date, i) => {
                const items = byDay.get(dayKey(date)) || []
                const today = sameDay(date, new Date())
                const preview = view === 'week' ? items : items.slice(0, MAX_PREVIEW)
                const hidden = items.length - preview.length
                const outside = view === 'month' && date.getMonth() !== anchor.getMonth()
                return (
                  <div key={i} className="gu-cal__cell" data-outside={outside} data-today={today}>
                    <div className="gu-cal__cell-head">
                      <span className="gu-cal__day">
                        {view === 'week' ? `${date.getDate()}/${date.getMonth() + 1}` : date.getDate()}
                      </span>
                      <IconButton
                        icon="plus"
                        label={`Nuovo appuntamento il ${date.toLocaleDateString('it-IT')}`}
                        size="sm"
                        onClick={() => openCreate(date)}
                      />
                    </div>
                    <div className="gu-cal__items">
                      {view === 'week' && items.length === 0 ? (
                        <span style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)' }}>Libero</span>
                      ) : (
                        preview.map(a => renderCard(a, view === 'month'))
                      )}
                    </div>
                    {hidden > 0 && (
                      <button type="button" className="gu-cal__more" onClick={() => setDayOpen(date)}>
                        +{hidden} altri
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {!loading && shown.length === 0 && (
        <EmptyState
          icon="calendar"
          title={
            modeFilter === 'tutte'
              ? 'Nessun appuntamento in questo periodo'
              : `Nessun appuntamento ${labelOf(MODES, modeFilter).toLowerCase()} in questo periodo`
          }
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
            <LeadPicker
              ownerIds={ownerIds}
              value={draft.lead_id}
              label={draft.leadLabel}
              onChange={(id, name) => setDraft({ ...draft, lead_id: id, leadLabel: name })}
            />

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

      {shown.length > 0 && (
        <div className="gu-row" style={{ justifyContent: 'center' }}>
          <Badge tone="neutral">
            {shown.length} {shown.length === 1 ? 'appuntamento' : 'appuntamenti'} nel periodo mostrato
          </Badge>
        </div>
      )}
    </>
  )
}

/* ========================================================================== */
/* Selezione del lead: cerca invece di elencare tutto                          */
/* ========================================================================== */

function LeadPicker({
  ownerIds,
  value,
  label,
  onChange,
}: {
  ownerIds: string[]
  value: string
  label: string
  onChange: (id: string, name: string) => void
}) {
  const [term, setTerm] = useState('')
  const [rows, setRows] = useState<Lead[]>([])
  const [loading, setLoading] = useState(false)
  const debounced = useDebounced(term, 250)

  useEffect(() => {
    if (!isSearchable(debounced)) {
      setRows([])
      return
    }
    let alive = true
    setLoading(true)
    void applyTextSearch(
      supabase.from('leads').select('id,owner_id,first_name,last_name,company_name').in('owner_id', ownerIds),
      debounced,
      ['last_name', 'first_name', 'company_name'],
    )
      .limit(8)
      .then(({ data }) => {
        if (!alive) return
        setRows((data || []) as Lead[])
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [debounced, ownerIds.join(',')])

  if (value) {
    return (
      <div className="gu-field">
        <span className="gu-field__label">Lead</span>
        <div className="gu-row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <strong className="gu-truncate">{label || 'Lead selezionato'}</strong>
          <Button size="sm" variant="ghost" icon="x" onClick={() => onChange('', '')}>
            Cambia
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="gu-field">
      <label className="gu-field__label" htmlFor="gu-cal-lead">
        Lead<span className="gu-field__required" aria-hidden="true">*</span>
      </label>
      <input
        id="gu-cal-lead"
        className="gu-input"
        type="search"
        value={term}
        placeholder="Cerca per cognome o ragione sociale…"
        onChange={e => setTerm(e.target.value)}
      />
      {loading && <span className="gu-field__hint">Ricerca in corso…</span>}
      {!loading && isSearchable(debounced) && rows.length === 0 && (
        <span className="gu-field__hint">Nessun lead trovato nel perimetro selezionato.</span>
      )}
      {rows.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
          {rows.map(l => (
            <li key={l.id}>
              <button type="button" className="gu-menu__item" onClick={() => onChange(l.id, leadName(l))}>
                <Icon name="user" size={14} />
                {leadName(l)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
