import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../supabaseClient'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Icon,
  IconButton,
  Skeleton,
  useToast,
} from '../ui'
import { PageHeader } from '../app/AppShell'
import { ScopeSelect } from '../app/ScopeSelect'
import { useScopeParam } from '../app/ScopeProvider'
import { useAdvisors } from '../lib/useAdvisors'
import { fetchAllPages, inChunks } from '../lib/db'
import { daysSinceContact, loadAggregates } from '../lib/leadAggregates'
import { MODES, labelOf, leadName, progressOf, type Lead } from '../lib/domain'
import { addDays, startOfDay } from '../lib/datetime'
import { errorMessage, formatTime, relativeTime } from '../lib/format'
import { hrefFor, type NavigateFn, type Route } from '../lib/router'

type Row = { id: string; lead_id: string; ts: string; mode: string | null; notes: string | null }

/**
 * Pagina "Oggi".
 *
 * Nasce da un buco preciso: i promemoria esistevano solo dentro la scheda del
 * singolo lead. Se ne creava uno per martedì prossimo e non lo si rivedeva mai
 * più, a meno di riaprire esattamente quel lead. C'era la tabella, c'era la
 * funzione che manda l'email, c'era la scheda — e nessun posto dove vederli.
 *
 * Qui stanno insieme le tre domande di inizio giornata: cosa mi sono segnato,
 * chi incontro oggi, chi sto trascurando.
 */
export default function TodayPage({
  route,
  go,
  onOpenLead,
}: {
  route: Route
  go: NavigateFn
  onOpenLead: (id: string) => void
}) {
  const { resolveScope, scopeOptions } = useAdvisors()
  const { scope, setScope } = useScopeParam(route, go)
  const toast = useToast()

  const [leads, setLeads] = useState<Lead[]>([])
  const [reminders, setReminders] = useState<Row[]>([])
  const [appointments, setAppointments] = useState<Row[]>([])
  const [neverContacted, setNeverContacted] = useState(0)
  const [stale, setStale] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const ownerIds = useMemo(() => (scope ? resolveScope(scope) : []), [scope, resolveScope])
  const ownerKey = ownerIds.join(',')

  const load = useCallback(async () => {
    if (!ownerIds.length) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const leadRows = await inChunks(ownerIds, slice =>
        fetchAllPages<Lead>(
          () =>
            supabase
              .from('leads')
              .select('id,owner_id,first_name,last_name,company_name,email,phone,is_working')
              .in('owner_id', slice)
              .eq('is_working', true) as never,
        ),
      )
      setLeads(leadRows)
      const leadIds = leadRows.map(l => l.id)

      const endOfToday = addDays(startOfDay(new Date()), 1).toISOString()
      const startOfToday = startOfDay(new Date()).toISOString()

      const [rem, app, aggs] = await Promise.all([
        // Promemoria scaduti e di oggi: tutto ciò che è già "dovuto".
        inChunks(leadIds, slice =>
          fetchAllPages<Row>(
            () =>
              supabase
                .from('reminders')
                .select('id,lead_id,ts,mode,notes')
                .in('lead_id', slice)
                .lt('ts', endOfToday)
                .order('ts', { ascending: true }) as never,
          ),
        ),
        inChunks(leadIds, slice =>
          fetchAllPages<Row>(
            () =>
              supabase
                .from('appointments')
                .select('id,lead_id,ts,mode,notes')
                .in('lead_id', slice)
                .gte('ts', startOfToday)
                .lt('ts', endOfToday)
                .order('ts', { ascending: true }) as never,
          ),
        ),
        loadAggregates(leadIds),
      ])

      setReminders(rem.sort((a, b) => a.ts.localeCompare(b.ts)))
      setAppointments(app.sort((a, b) => a.ts.localeCompare(b.ts)))

      const now = Date.now()
      setNeverContacted(leadIds.filter(id => progressOf(aggs[id]) === 'never').length)
      setStale(
        leadIds.filter(id => {
          const days = daysSinceContact(aggs[id], now)
          return days !== null && days >= 30 && progressOf(aggs[id]) !== 'client'
        }).length,
      )
    } catch (e) {
      setError(errorMessage(e, 'Impossibile caricare la giornata'))
    } finally {
      setLoading(false)
    }
  }, [ownerKey])

  useEffect(() => {
    void load()
  }, [load])

  const leadById = useMemo(() => new Map(leads.map(l => [l.id, l])), [leads])

  async function completeReminder(r: Row) {
    try {
      const { error } = await supabase.from('reminders').delete().eq('id', r.id)
      if (error) throw error
      setReminders(list => list.filter(x => x.id !== r.id))
      toast.success('Promemoria archiviato')
    } catch (e) {
      toast.error('Non è stato possibile archiviare il promemoria', errorMessage(e))
    }
  }

  const overdue = reminders.filter(r => new Date(r.ts).getTime() < startOfDay(new Date()).getTime())

  return (
    <>
      <PageHeader
        title="Oggi"
        description="Quello che ti aspetta adesso: promemoria, appuntamenti e lead da riprendere in mano."
        actions={
          <Button icon="refresh" onClick={() => void load()} loading={loading}>
            Aggiorna
          </Button>
        }
      />

      {scopeOptions.length > 1 && scope && (
        <div className="gu-filters">
          <ScopeSelect value={scope} onChange={setScope} options={scopeOptions} />
        </div>
      )}

      {error && <Alert tone="danger" title="Errore">{error}</Alert>}

      {overdue.length > 0 && (
        <Alert tone="warning" title={`${overdue.length} promemoria in ritardo`}>
          Erano previsti prima di oggi e non sono ancora stati chiusi.
        </Alert>
      )}

      <div className="gu-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <Card>
          <CardHeader
            title="Promemoria"
            subtitle="Scaduti e di oggi"
            icon="bell"
            actions={reminders.length > 0 ? <Badge tone="primary">{reminders.length}</Badge> : null}
          />
          <CardBody>
            {loading ? (
              <Skeleton height={160} radius={12} />
            ) : reminders.length === 0 ? (
              <EmptyState
                icon="checkCircle"
                title="Nessun promemoria in sospeso"
                text="I promemoria si creano dalla scheda di un lead, nella scheda Promemoria."
              />
            ) : (
              <ul className="gu-stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {reminders.map(r => (
                  <TodayItem
                    key={r.id}
                    ts={r.ts}
                    late={new Date(r.ts).getTime() < startOfDay(new Date()).getTime()}
                    title={leadName(leadById.get(r.lead_id))}
                    detail={r.notes || labelOf(MODES, r.mode, 'Promemoria')}
                    onOpen={() => onOpenLead(r.lead_id)}
                    action={
                      <IconButton
                        icon="check"
                        label="Segna come fatto e archivia"
                        size="sm"
                        onClick={() => void completeReminder(r)}
                      />
                    }
                  />
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Appuntamenti di oggi"
            icon="calendar"
            actions={appointments.length > 0 ? <Badge tone="primary">{appointments.length}</Badge> : null}
          />
          <CardBody>
            {loading ? (
              <Skeleton height={160} radius={12} />
            ) : appointments.length === 0 ? (
              <EmptyState icon="calendar" title="Nessun appuntamento oggi" text="La giornata è libera." />
            ) : (
              <ul className="gu-stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {appointments.map(a => (
                  <TodayItem
                    key={a.id}
                    ts={a.ts}
                    title={leadName(leadById.get(a.lead_id))}
                    detail={[labelOf(MODES, a.mode, ''), a.notes || ''].filter(Boolean).join(' · ')}
                    onOpen={() => onOpenLead(a.lead_id)}
                  />
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Scorciatoie: portano all'elenco già filtrato, non a una lista da rifiltrare. */}
      <div className="gu-grid gu-grid--2">
        <ShortcutCard
          icon="alert"
          tone={neverContacted > 0 ? 'warning' : 'success'}
          value={neverContacted}
          title="lead mai contattati"
          text="Opportunità ferme in portafoglio, mai toccate da nessuno."
          href={hrefFor('leads', null, { avanzamento: 'never', ordina: 'recenti' })}
          loading={loading}
        />
        <ShortcutCard
          icon="clock"
          tone={stale > 0 ? 'warning' : 'success'}
          value={stale}
          title="lead fermi da oltre 30 giorni"
          text="Contattati almeno una volta, poi lasciati lì."
          href={hrefFor('leads', null, { contatto: '30', ordina: 'trascurati' })}
          loading={loading}
        />
      </div>
    </>
  )
}

/* ========================================================================== */

function TodayItem({
  ts,
  title,
  detail,
  late,
  onOpen,
  action,
}: {
  ts: string
  title: string
  detail?: string
  late?: boolean
  onOpen: () => void
  action?: ReactNode
}) {
  return (
    <li
      className="gu-row"
      style={{
        gap: 'var(--gu-space-3)',
        padding: 'var(--gu-space-2) var(--gu-space-3)',
        border: '1px solid var(--gu-border)',
        borderLeft: `3px solid ${late ? 'var(--gu-amber-500)' : 'var(--gu-chart-1)'}`,
        borderRadius: 'var(--gu-radius-md)',
        flexWrap: 'nowrap',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--gu-font-display)',
          fontWeight: 700,
          fontSize: 'var(--gu-text-sm)',
          minWidth: 46,
          flex: 'none',
        }}
      >
        {formatTime(ts)}
      </span>
      <button
        type="button"
        onClick={onOpen}
        style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', minWidth: 0, flex: 1, cursor: 'pointer' }}
      >
        <span className="gu-truncate" style={{ display: 'block', fontWeight: 600, color: 'var(--gu-primary)' }}>
          {title}
        </span>
        <span
          className="gu-truncate"
          style={{ display: 'block', fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)' }}
        >
          {late ? `In ritardo di ${relativeTime(ts).replace(/^/, '')} · ` : ''}
          {detail}
        </span>
      </button>
      {action}
    </li>
  )
}

function ShortcutCard({
  icon,
  tone,
  value,
  title,
  text,
  href,
  loading,
}: {
  icon: 'alert' | 'clock'
  tone: 'warning' | 'success'
  value: number
  title: string
  text: string
  href: string
  loading: boolean
}) {
  return (
    <Card>
      <CardBody>
        <div className="gu-row" style={{ justifyContent: 'space-between', gap: 'var(--gu-space-4)' }}>
          <div className="gu-row" style={{ gap: 'var(--gu-space-3)', flexWrap: 'nowrap', minWidth: 0 }}>
            <div
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 44,
                height: 44,
                flex: 'none',
                borderRadius: 'var(--gu-radius-lg)',
                background: tone === 'warning' ? 'var(--gu-warning-soft)' : 'var(--gu-success-soft)',
                color: tone === 'warning' ? 'var(--gu-warning-fg)' : 'var(--gu-success-fg)',
              }}
            >
              <Icon name={value > 0 ? icon : 'checkCircle'} size={20} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 'var(--gu-text-lg)' }}>
                {loading ? <Skeleton height={22} width={160} /> : value > 0 ? `${value} ${title}` : `Nessun ${title.replace(/^lead /, 'lead ')}`}
              </div>
              <div style={{ fontSize: 'var(--gu-text-sm)', color: 'var(--gu-text-subtle)' }}>{text}</div>
            </div>
          </div>
          {value > 0 && (
            <a className="gu-btn gu-btn--primary" href={href}>
              Vedili
              <Icon name="arrowUpRight" size={16} />
            </a>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
