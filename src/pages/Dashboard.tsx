import { useCallback, useEffect, useMemo, useState } from 'react'
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
  Skeleton,
  Stat,
} from '../ui'
import { PageHeader } from '../app/AppShell'
import { MonthRange, ScopeSelect } from '../app/ScopeSelect'
import { useAdvisors, type Scope } from '../lib/useAdvisors'
import { chunk, fetchAllPages, inChunks, uniq } from '../lib/db'
import { addMonths, monthKeyOf, monthRangeDate, monthRangeIso } from '../lib/datetime'
import { errorMessage, formatCurrency, formatNumber, formatPercent } from '../lib/format'
import { CONTRACT_TYPES, FUNNEL_STAGES, METRICS } from '../lib/domain'

type Totals = {
  leads: number
  contacts: number
  appointments: number
  proposals: number
  contracts: number
  production: Record<string, number>
  notContacted: number
}

const EMPTY: Totals = {
  leads: 0,
  contacts: 0,
  appointments: 0,
  proposals: 0,
  contracts: 0,
  production: {},
  notContacted: 0,
}

export default function DashboardPage({ onOpenLeads }: { onOpenLeads: () => void }) {
  const { resolveScope, scopeOptions, defaultScope, loading: advisorsLoading } = useAdvisors()
  const [scope, setScope] = useState<Scope | null>(null)
  const [period, setPeriod] = useState(() => {
    const now = monthKeyOf(new Date())
    return { from: addMonths(now, -5), to: now }
  })
  const [totals, setTotals] = useState<Totals>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!scope) setScope(defaultScope)
  }, [defaultScope, scope])

  const ownerIds = useMemo(() => (scope ? resolveScope(scope) : []), [scope, resolveScope])
  const ownerKey = ownerIds.join(',')

  const load = useCallback(async () => {
    if (!ownerIds.length) {
      setTotals(EMPTY)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const tsRange = monthRangeIso(period.from, period.to)
      const dateRange = monthRangeDate(period.from, period.to)

      // Lead nel perimetro: solo gli id, paginati (PostgREST si ferma a 1000
      // righe per richiesta e prima nessuno lo gestiva).
      const ownedLeads = await inChunks(ownerIds, slice =>
        fetchAllPages<{ id: string }>(() => supabase.from('leads').select('id').in('owner_id', slice) as never),
      )
      const leadIds = ownedLeads.map(l => l.id)

      const [leadsCreated, contacts, appointments, proposals, contractRows, notContacted] = await Promise.all([
        countLeadsCreated(ownerIds, tsRange),
        countByLead('activities', leadIds, tsRange, 'ts'),
        countByLead('appointments', leadIds, tsRange, 'ts'),
        // proposals.ts e contracts.ts sono colonne `date`: il confronto va
        // fatto con 'YYYY-MM-DD', non con un timestamp completo.
        countByLead('proposals', leadIds, dateRange, 'ts'),
        loadContracts(leadIds, dateRange),
        countNeverContacted(ownerIds, leadIds),
      ])

      const production: Record<string, number> = {}
      for (const t of CONTRACT_TYPES) production[t] = 0
      for (const row of contractRows) {
        const type = row.contract_type || ''
        if (!(type in production)) continue
        // `amount` è nullable e `premium_annual` è obbligatoria: a seconda di
        // come è stato inserito il contratto il premio sta nell'una o
        // nell'altra. Si prende il primo valore disponibile.
        production[type] += Number(row.amount ?? row.premium_annual ?? 0)
      }

      setTotals({
        leads: leadsCreated,
        contacts,
        appointments,
        proposals,
        contracts: contractRows.length,
        production,
        notContacted,
      })
    } catch (e) {
      setError(errorMessage(e, 'Impossibile caricare i dati della dashboard'))
    } finally {
      setLoading(false)
    }
  }, [ownerKey, period.from, period.to])

  useEffect(() => {
    void load()
  }, [load])

  const funnel = useMemo(
    () => [
      { ...FUNNEL_STAGES[0], value: totals.leads },
      { ...FUNNEL_STAGES[1], value: totals.contacts },
      { ...FUNNEL_STAGES[2], value: totals.appointments },
      { ...FUNNEL_STAGES[3], value: totals.proposals },
      { ...FUNNEL_STAGES[4], value: totals.contracts },
    ],
    [totals],
  )

  const rates = useMemo(
    () => [
      {
        label: 'Tasso di attivazione',
        formula: 'Contratti su lead caricati',
        value: totals.leads ? (totals.contracts / totals.leads) * 100 : null,
      },
      {
        label: 'Tasso di chiusura',
        formula: 'Contratti su appuntamenti',
        value: totals.appointments ? (totals.contracts / totals.appointments) * 100 : null,
      },
      {
        label: 'Tasso di conversione',
        formula: 'Contratti su contatti',
        value: totals.contacts ? (totals.contracts / totals.contacts) * 100 : null,
      },
    ],
    [totals],
  )

  const totalProduction = useMemo(
    () => Object.values(totals.production).reduce((s, v) => s + v, 0),
    [totals.production],
  )

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Come si muove la pipeline nel periodo selezionato."
        actions={
          <Button icon="refresh" onClick={() => void load()} loading={loading}>
            Aggiorna
          </Button>
        }
      />

      <div className="gu-filters">
        {scope && <ScopeSelect value={scope} onChange={setScope} options={scopeOptions} />}
        <MonthRange from={period.from} to={period.to} onChange={setPeriod} />
        <div className="gu-spacer" />
        <div style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)', alignSelf: 'center' }}>
          {ownerIds.length === 1 ? '1 advisor' : `${ownerIds.length} advisor`} nel perimetro
        </div>
      </div>

      {error && <Alert tone="danger" title="Errore di caricamento">{error}</Alert>}

      {!advisorsLoading && !ownerIds.length && (
        <EmptyState
          icon="users"
          title="Nessun advisor nel perimetro"
          text="Il profilo selezionato non ha advisor associati. Verifica la struttura del team nella sezione Utenti."
        />
      )}

      {/* KPI principali */}
      <div className="gu-grid gu-grid--4">
        <Stat label="Contatti" value={formatNumber(totals.contacts)} icon="phone" loading={loading} />
        <Stat label="Appuntamenti" value={formatNumber(totals.appointments)} icon="calendar" loading={loading} />
        <Stat label="Proposte" value={formatNumber(totals.proposals)} icon="fileText" loading={loading} />
        <Stat
          label="Contratti"
          value={formatNumber(totals.contracts)}
          icon="checkCircle"
          tone="accent"
          loading={loading}
          hint={totalProduction > 0 ? `${formatCurrency(totalProduction)} di produzione` : undefined}
        />
      </div>

      {/* Lead da lavorare — è l'azione, non una statistica */}
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
                  background: totals.notContacted > 0 ? 'var(--gu-warning-soft)' : 'var(--gu-success-soft)',
                  color: totals.notContacted > 0 ? 'var(--gu-warning-fg)' : 'var(--gu-success-fg)',
                }}
              >
                <Icon name={totals.notContacted > 0 ? 'bell' : 'checkCircle'} size={20} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--gu-text-lg)' }}>
                  {loading ? <Skeleton height={22} width={140} /> : (
                    totals.notContacted > 0
                      ? `${formatNumber(totals.notContacted)} lead mai contattati`
                      : 'Tutti i lead sono stati contattati'
                  )}
                </div>
                <div style={{ fontSize: 'var(--gu-text-sm)', color: 'var(--gu-text-subtle)' }}>
                  Opportunità ferme in portafoglio, indipendenti dal periodo selezionato.
                </div>
              </div>
            </div>
            {totals.notContacted > 0 && (
              <Button variant="primary" iconRight="arrowUpRight" onClick={onOpenLeads}>
                Lavorali adesso
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      <div className="gu-grid" style={{ gridTemplateColumns: 'minmax(0, 1.8fr) minmax(280px, 1fr)' }}>
        <Card>
          <CardHeader
            title="Imbuto di conversione"
            subtitle="Ogni riga mostra quanti passano allo stadio successivo"
            icon="filter"
          />
          <CardBody>{loading ? <Skeleton height={280} radius={12} /> : <Funnel steps={funnel} />}</CardBody>
        </Card>

        <div className="gu-stack">
          <Card>
            <CardHeader title="Indicatori" icon="trendUp" />
            <CardBody className="gu-stack">
              {rates.map(r => (
                <div key={r.label}>
                  <div className="gu-row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 'var(--gu-text-sm)', fontWeight: 600 }}>{r.label}</span>
                    <span style={{ fontWeight: 800, fontFamily: 'var(--gu-font-display)' }}>
                      {r.value === null ? '—' : formatPercent(r.value)}
                    </span>
                  </div>
                  <div style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)' }}>{r.formula}</div>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Produzione per linea" icon="shield" />
            <CardBody className="gu-stack-sm">
              {METRICS.filter(m => m.contractType).map(m => {
                const value = totals.production[m.contractType!] || 0
                const share = totalProduction ? (value / totalProduction) * 100 : 0
                return (
                  <div key={m.key}>
                    <div className="gu-row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 'var(--gu-text-sm)' }}>{m.label}</span>
                      <span style={{ fontSize: 'var(--gu-text-sm)', fontWeight: 700 }}>{formatCurrency(value)}</span>
                    </div>
                    <div className="gu-progress" style={{ height: 6 }}>
                      <div
                        className="gu-progress__fill"
                        style={{ width: `${share}%`, background: 'var(--gu-chart-2)' }}
                      />
                    </div>
                  </div>
                )
              })}
              <div
                className="gu-row"
                style={{ justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--gu-border)' }}
              >
                <span style={{ fontSize: 'var(--gu-text-sm)', fontWeight: 600 }}>Totale</span>
                <span style={{ fontWeight: 800 }}>{formatCurrency(totalProduction)}</span>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}

/* ========================================================================== */
/* Funnel                                                                      */
/* ========================================================================== */

function Funnel({ steps }: { steps: { key: string; label: string; help: string; value: number }[] }) {
  const max = Math.max(1, ...steps.map(s => s.value))
  const rowH = 54
  const width = 420
  const pad = 8

  if (steps.every(s => s.value === 0)) {
    return (
      <EmptyState
        icon="filter"
        title="Nessun dato nel periodo"
        text="Non ci sono lead né attività registrate nell'intervallo selezionato. Prova ad allargare il periodo."
      />
    )
  }

  return (
    <div className="gu-stack-sm">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : 0
        const conv = i > 0 && prev > 0 ? (s.value / prev) * 100 : null
        // Larghezza minima: senza, uno stadio a zero collassa in un triangolo
        // che sembra un errore di rendering invece di un dato.
        const usable = width - pad * 2
        const minW = usable * 0.06
        const widthFor = (v: number) => Math.max(minW, (usable * v) / max)
        const topW = i === 0 ? usable : widthFor(steps[i - 1].value)
        const botW = widthFor(s.value)
        // Il calo più marcato è quello su cui intervenire: va evidenziato.
        const isWorst =
          conv !== null &&
          conv ===
            Math.min(
              ...steps
                .map((x, j) => (j > 0 && steps[j - 1].value > 0 ? (x.value / steps[j - 1].value) * 100 : Infinity))
                .filter(n => Number.isFinite(n)),
            )

        return (
          <div
            key={s.key}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(140px, 1fr) minmax(0, 1.4fr) auto',
              gap: 'var(--gu-space-3)',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: 'var(--gu-text-sm)', fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)' }}>{s.help}</div>
            </div>

            <svg
              width="100%"
              height={rowH}
              viewBox={`0 0 ${width} ${rowH}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`${s.label}: ${formatNumber(s.value)}`}
            >
              <polygon
                points={`${(width - topW) / 2},4 ${(width + topW) / 2},4 ${(width + botW) / 2},${rowH - 4} ${
                  (width - botW) / 2
                },${rowH - 4}`}
                fill={i === steps.length - 1 ? 'var(--gu-chart-2)' : 'var(--gu-chart-1)'}
                fillOpacity={0.85 - i * 0.08}
              />
            </svg>

            <div style={{ textAlign: 'right', minWidth: 96 }}>
              <div style={{ fontFamily: 'var(--gu-font-display)', fontWeight: 800, fontSize: 'var(--gu-text-lg)' }}>
                {formatNumber(s.value)}
              </div>
              {conv !== null && (
                <Badge tone={isWorst ? 'warning' : 'neutral'}>
                  {isWorst && <Icon name="arrowDown" size={11} />}
                  {formatPercent(conv, 0)}
                </Badge>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ========================================================================== */
/* Query                                                                       */
/* ========================================================================== */

async function countLeadsCreated(ownerIds: string[], range: { start: string; end: string }) {
  const blocks = chunk(ownerIds)
  const counts = await Promise.all(
    blocks.map(async slice => {
      const { count, error } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .in('owner_id', slice)
        .gte('created_at', range.start)
        .lt('created_at', range.end)
      if (error) throw error
      return count || 0
    }),
  )
  return counts.reduce((a, b) => a + b, 0)
}

async function countByLead(
  table: 'activities' | 'appointments' | 'proposals',
  leadIds: string[],
  range: { start: string; end: string },
  tsColumn: string,
) {
  if (!leadIds.length) return 0
  const blocks = chunk(leadIds)
  const counts = await Promise.all(
    blocks.map(async slice => {
      const { count, error } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .in('lead_id', slice)
        .gte(tsColumn, range.start)
        .lt(tsColumn, range.end)
      if (error) throw error
      return count || 0
    }),
  )
  return counts.reduce((a, b) => a + b, 0)
}

async function loadContracts(leadIds: string[], range: { start: string; end: string }) {
  if (!leadIds.length) return []
  return inChunks(leadIds, slice =>
    fetchAllPages<{ contract_type: string | null; amount: number | null; premium_annual: number | null }>(
      () =>
        supabase
          .from('contracts')
          .select('contract_type,amount,premium_annual')
          .in('lead_id', slice)
          .gte('ts', range.start)
          .lt('ts', range.end) as never,
    ),
  )
}

/**
 * Lead senza nessuna attività registrata.
 * Prima veniva calcolato scaricando tutti i lead e tutte le activities e
 * facendo la differenza nel browser. Qui si prova prima con una join lato
 * server (conteggio puro, nessuna riga trasferita); se la relazione non è
 * esposta si ricade sul metodo precedente, ma con paginazione corretta.
 */
async function countNeverContacted(ownerIds: string[], leadIds: string[]) {
  try {
    const blocks = chunk(ownerIds)
    const withActivity = await Promise.all(
      blocks.map(async slice => {
        const { count, error } = await supabase
          .from('leads')
          .select('id, activities!inner(lead_id)', { count: 'exact', head: true })
          .in('owner_id', slice)
        if (error) throw error
        return count || 0
      }),
    )
    return Math.max(0, leadIds.length - withActivity.reduce((a, b) => a + b, 0))
  } catch {
    if (!leadIds.length) return 0
    const acts = await inChunks(leadIds, slice =>
      fetchAllPages<{ lead_id: string }>(() => supabase.from('activities').select('lead_id').in('lead_id', slice) as never),
    )
    const contacted = new Set(uniq(acts.map(a => a.lead_id)))
    return leadIds.filter(id => !contacted.has(id)).length
  }
}
