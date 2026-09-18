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
  Progress,
  Segmented,
  SelectField,
  Skeleton,
  toneForRatio,
} from '../ui'
import { PageHeader } from '../app/AppShell'
import { PeriodSelect, ScopeSelect, parsePeriod, periodFromPreset, serializePeriod, type Period } from '../app/ScopeSelect'
import { useScopeParam } from '../app/ScopeProvider'
import { useAdvisors } from '../lib/useAdvisors'
import { chunk } from '../lib/db'
import { METRICS, emptyMetrics, type MetricDef, type MetricKey, type MetricValues } from '../lib/domain'
import { listMonths } from '../lib/datetime'
import { displayName, downloadCsv, errorMessage, formatCurrency, formatNumber, formatPercent, monthLabel } from '../lib/format'
import type { NavigateFn, Route } from '../lib/router'

type MonthRow = {
  key: string
  year: number
  month: number
  label: string
  target: MetricValues
  actual: MetricValues
}

type AdvisorRow = { userId: string; name: string; target: MetricValues; actual: MetricValues }

export default function ReportPage({ route, go }: { route: Route; go: NavigateFn }) {
  const { resolveScope, scopeOptions, byUserId } = useAdvisors()
  const { scope, setScope } = useScopeParam(route, go)

  const period = useMemo(
    () => parsePeriod(route.query.periodo, periodFromPreset('dodici')),
    [route.query.periodo],
  )
  const setPeriod = useCallback(
    (next: Period) => go(route.id, { query: { ...route.query, periodo: serializePeriod(next) } }),
    [go, route.id, route.query],
  )

  const [rows, setRows] = useState<MonthRow[]>([])
  const [perAdvisor, setPerAdvisor] = useState<AdvisorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rankMetric, setRankMetric] = useState<MetricKey>('contratti')
  const [rankOrder, setRankOrder] = useState<'indietro' | 'avanti'>('indietro')

  const advisorIds = useMemo(() => (scope ? resolveScope(scope) : []), [scope, resolveScope])
  const advisorKey = advisorIds.join(',')

  const load = useCallback(async () => {
    if (!advisorIds.length) {
      setRows([])
      setPerAdvisor([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const months = listMonths(period.from, period.to)
      const monthKeys = new Set(months.map(m => m.key))
      const years = Array.from(new Set(months.map(m => m.year)))

      const [progress, goals] = await Promise.all([
        loadRows('v_progress_monthly', advisorIds, years, METRICS.map(m => m.key)),
        loadRows('goals_monthly', advisorIds, years, METRICS.map(m => m.targetColumn)),
      ])

      // Il periodo può iniziare e finire a metà anno: si tengono solo i mesi
      // effettivamente richiesti, non tutti quelli degli anni coinvolti.
      const inPeriod = <T extends { year: number; month: number }>(r: T) =>
        monthKeys.has(`${r.year}-${String(r.month).padStart(2, '0')}`)

      const progressRows = progress.filter(inPeriod)
      const goalRows = goals.filter(inPeriod)

      const targetByMonth = groupByMonth(goalRows, METRICS.map(m => [m.key, m.targetColumn] as const))
      const actualByMonth = groupByMonth(progressRows, METRICS.map(m => [m.key, m.key] as const))

      setRows(
        months.map(m => ({
          key: m.key,
          year: m.year,
          month: m.month,
          label: monthLabel(m.year, m.month),
          target: targetByMonth.get(m.key) || emptyMetrics(),
          actual: actualByMonth.get(m.key) || emptyMetrics(),
        })),
      )

      const targetByAdvisor = groupByAdvisor(goalRows, METRICS.map(m => [m.key, m.targetColumn] as const))
      const actualByAdvisor = groupByAdvisor(progressRows, METRICS.map(m => [m.key, m.key] as const))
      setPerAdvisor(
        advisorIds.map(id => ({
          userId: id,
          name: displayName(byUserId.get(id), 'Advisor'),
          target: targetByAdvisor.get(id) || emptyMetrics(),
          actual: actualByAdvisor.get(id) || emptyMetrics(),
        })),
      )
    } catch (e) {
      setError(errorMessage(e, 'Impossibile caricare il report'))
    } finally {
      setLoading(false)
    }
  }, [advisorKey, period.from, period.to])

  useEffect(() => {
    void load()
  }, [load])

  const totals = useMemo(() => {
    const target = emptyMetrics()
    const actual = emptyMetrics()
    for (const r of rows) {
      for (const m of METRICS) {
        target[m.key] += r.target[m.key] || 0
        actual[m.key] += r.actual[m.key] || 0
      }
    }
    return { target, actual }
  }, [rows])

  const hasTargets = METRICS.some(m => totals.target[m.key] > 0)
  const hasData = rows.length > 0 && (hasTargets || METRICS.some(m => totals.actual[m.key] > 0))

  const ranking = useMemo(() => {
    const metric = METRICS.find(m => m.key === rankMetric)!
    const withRatio = perAdvisor.map(a => ({
      ...a,
      ratio: a.target[metric.key] > 0 ? a.actual[metric.key] / a.target[metric.key] : null,
    }))
    return withRatio.sort((x, y) => {
      // Chi non ha obiettivo finisce in fondo comunque: non è "indietro",
      // semplicemente non è misurabile.
      if (x.ratio === null && y.ratio === null) return y.actual[metric.key] - x.actual[metric.key]
      if (x.ratio === null) return 1
      if (y.ratio === null) return -1
      return rankOrder === 'indietro' ? x.ratio - y.ratio : y.ratio - x.ratio
    })
  }, [perAdvisor, rankMetric, rankOrder])

  function exportReport() {
    downloadCsv(
      `guideup_report_${period.from}_${period.to}.csv`,
      rows.map(r => {
        const out: Record<string, unknown> = { Mese: r.label }
        for (const m of METRICS) {
          out[`${m.label} — obiettivo`] = r.target[m.key]
          out[`${m.label} — risultato`] = r.actual[m.key]
          out[`${m.label} — %`] = r.target[m.key] ? Math.round((r.actual[m.key] / r.target[m.key]) * 100) : ''
        }
        return out
      }),
    )
  }

  function exportPerAdvisor() {
    downloadCsv(
      `guideup_report_advisor_${period.from}_${period.to}.csv`,
      perAdvisor.map(a => {
        const out: Record<string, unknown> = { Advisor: a.name }
        for (const m of METRICS) {
          out[`${m.label} — obiettivo`] = a.target[m.key]
          out[`${m.label} — risultato`] = a.actual[m.key]
          out[`${m.label} — %`] = a.target[m.key] ? Math.round((a.actual[m.key] / a.target[m.key]) * 100) : ''
        }
        return out
      }),
    )
  }

  return (
    <>
      <PageHeader
        title="Report"
        description="Risultati a confronto con gli obiettivi, mese per mese e advisor per advisor."
        actions={
          <Button icon="download" onClick={exportReport} disabled={!rows.length}>
            Esporta
          </Button>
        }
      />

      <div className="gu-filters">
        {scope && scopeOptions.length > 1 && <ScopeSelect value={scope} onChange={setScope} options={scopeOptions} />}
        <PeriodSelect value={period} onChange={setPeriod} />
        <div className="gu-spacer" />
        {advisorIds.length > 1 && <Badge tone="primary">Dati aggregati su {advisorIds.length} advisor</Badge>}
      </div>

      {error && <Alert tone="danger" title="Errore">{error}</Alert>}

      {!loading && !hasTargets && rows.length > 0 && (
        <Alert tone="warning" title="Nessun obiettivo impostato per questo periodo">
          I risultati sono visibili, ma senza target non è possibile calcolare gli scostamenti. Imposta gli obiettivi
          dalla sezione Obiettivi.
        </Alert>
      )}

      {/* Riepilogo di periodo: un bullet per metrica */}
      <Card>
        <CardHeader
          title="Riepilogo del periodo"
          subtitle={`${rows.length} ${rows.length === 1 ? 'mese' : 'mesi'} · risultato contro obiettivo`}
          icon="target"
        />
        <CardBody className="gu-stack">
          {loading ? (
            <Skeleton height={220} radius={12} />
          ) : !hasData ? (
            <EmptyState
              icon="report"
              title="Nessun dato nel periodo"
              text="Non risultano né obiettivi né risultati nell'intervallo selezionato."
            />
          ) : (
            METRICS.map(m => (
              <BulletRow key={m.key} metric={m} target={totals.target[m.key]} actual={totals.actual[m.key]} />
            ))
          )}
        </CardBody>
      </Card>

      {/*
        Chi del team è indietro.
        Prima Dashboard e Report sommavano tutto il perimetro in un totale
        unico: un Team Lead non poteva sapere su chi intervenire, che è l'unica
        cosa che un Team Lead deve sapere.
      */}
      {perAdvisor.length > 1 && (
        <Card>
          <CardHeader
            title="Per advisor"
            subtitle="Chi è avanti e chi è indietro, sulla metrica scelta"
            icon="users"
            actions={
              <Button size="sm" icon="download" onClick={exportPerAdvisor} disabled={loading}>
                Esporta
              </Button>
            }
          />
          <CardBody className="gu-stack">
            <div className="gu-filters" style={{ padding: 0, border: 0, background: 'none', boxShadow: 'none' }}>
              <SelectField
                label="Metrica"
                value={rankMetric}
                onChange={e => setRankMetric(e.target.value as MetricKey)}
                style={{ minWidth: 200 }}
              >
                {METRICS.map(m => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </SelectField>
              <div className="gu-field">
                <span className="gu-field__label">Ordine</span>
                <Segmented
                  value={rankOrder}
                  onChange={setRankOrder}
                  ariaLabel="Ordine della classifica"
                  options={[
                    { value: 'indietro', label: 'Più indietro' },
                    { value: 'avanti', label: 'Più avanti' },
                  ]}
                />
              </div>
            </div>

            {loading ? (
              <Skeleton height={200} radius={12} />
            ) : (
              <div className="gu-table-wrap">
                <table className="gu-table">
                  <thead>
                    <tr>
                      <th scope="col">Advisor</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Obiettivo</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Risultato</th>
                      <th scope="col" style={{ minWidth: 140 }}>Avanzamento</th>
                      <th scope="col" style={{ textAlign: 'right' }}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map(a => {
                      const metric = METRICS.find(m => m.key === rankMetric)!
                      const t = a.target[rankMetric]
                      const v = a.actual[rankMetric]
                      return (
                        <tr key={a.userId}>
                          <td>{a.name}</td>
                          <td className="gu-table__num">{t > 0 ? formatValue(t, metric) : '—'}</td>
                          <td className="gu-table__num">{formatValue(v, metric)}</td>
                          <td>{a.ratio === null ? <span style={{ color: 'var(--gu-text-subtle)' }}>Nessun obiettivo</span> : <Progress ratio={a.ratio} label={`${a.name}: ${formatPercent(a.ratio * 100, 0)}`} />}</td>
                          <td className="gu-table__num">
                            {a.ratio === null ? '—' : <Badge tone={toneForRatio(a.ratio)}>{formatPercent(a.ratio * 100, 0)}</Badge>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Dettaglio mensile */}
      {!loading && hasData && (
        <div className="gu-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))' }}>
          {METRICS.map(m => (
            <Card key={m.key}>
              <CardHeader
                title={m.label}
                icon={m.icon}
                subtitle={
                  totals.target[m.key] > 0
                    ? `${formatValue(totals.actual[m.key], m)} su ${formatValue(totals.target[m.key], m)}`
                    : formatValue(totals.actual[m.key], m)
                }
                actions={
                  totals.target[m.key] > 0 ? (
                    <Badge tone={toneForRatio(totals.actual[m.key] / totals.target[m.key])}>
                      {formatPercent((totals.actual[m.key] / totals.target[m.key]) * 100, 0)}
                    </Badge>
                  ) : null
                }
              />
              <CardBody>
                <MonthlyBars rows={rows} metric={m} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

/* ========================================================================== */
/* Bullet chart: risultato, obiettivo e scostamento in una riga               */
/* ========================================================================== */

function BulletRow({ metric, target, actual }: { metric: MetricDef; target: number; actual: number }) {
  const ratio = target > 0 ? actual / target : 0
  const scale = Math.max(target, actual, 1)
  const tone = toneForRatio(ratio)
  const color =
    tone === 'success' ? 'var(--gu-accent-500)' : tone === 'warning' ? 'var(--gu-amber-500)' : 'var(--gu-red-500)'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) minmax(0, 3fr) auto', gap: 'var(--gu-space-3)', alignItems: 'center' }}>
      <div>
        <div style={{ fontSize: 'var(--gu-text-sm)', fontWeight: 600 }}>{metric.label}</div>
        <div style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)' }}>
          {target > 0 ? `obiettivo ${formatValue(target, metric)}` : 'nessun obiettivo'}
        </div>
      </div>

      <div className="gu-bullet">
        <div
          className="gu-bullet__fill"
          style={{ width: `${Math.min(100, (actual / scale) * 100)}%`, background: color }}
        />
        {target > 0 && (
          <span
            className="gu-bullet__target"
            style={{ left: `min(calc(100% - 2px), ${(target / scale) * 100}%)` }}
            title={`Obiettivo: ${formatValue(target, metric)}`}
          />
        )}
      </div>

      <div style={{ textAlign: 'right', minWidth: 130 }}>
        <div style={{ fontWeight: 700, fontFamily: 'var(--gu-font-display)' }}>{formatValue(actual, metric)}</div>
        <div style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)' }}>
          {target > 0 ? (
            <>
              {formatPercent(ratio * 100, 0)}
              {' · '}
              {actual >= target
                ? `+${formatValue(actual - target, metric)}`
                : `mancano ${formatValue(target - actual, metric)}`}
            </>
          ) : (
            '—'
          )}
        </div>
      </div>
    </div>
  )
}

/* ========================================================================== */
/* Barre affiancate per mese                                                   */
/* ========================================================================== */

function MonthlyBars({ rows, metric }: { rows: MonthRow[]; metric: MetricDef }) {
  const max = Math.max(1, ...rows.flatMap(r => [r.target[metric.key] || 0, r.actual[metric.key] || 0]))

  if (!rows.length) return null

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))`,
          gap: 'var(--gu-space-2)',
          alignItems: 'end',
          height: 160,
        }}
      >
        {rows.map(r => {
          const target = r.target[metric.key] || 0
          const actual = r.actual[metric.key] || 0
          const ratio = target > 0 ? actual / target : 0
          const tone = toneForRatio(ratio)
          return (
            <div key={r.key} style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 3, height: '100%' }}>
              <div
                title={`Obiettivo ${r.label}: ${formatValue(target, metric)}`}
                style={{
                  width: '42%',
                  maxWidth: 22,
                  height: `${Math.max(2, (target / max) * 100)}%`,
                  background: 'var(--gu-n-200)',
                  borderRadius: '4px 4px 0 0',
                }}
              />
              <div
                title={`Risultato ${r.label}: ${formatValue(actual, metric)}`}
                style={{
                  width: '42%',
                  maxWidth: 22,
                  height: `${Math.max(2, (actual / max) * 100)}%`,
                  background:
                    target === 0
                      ? 'var(--gu-chart-1)'
                      : tone === 'success'
                        ? 'var(--gu-accent-500)'
                        : tone === 'warning'
                          ? 'var(--gu-amber-500)'
                          : 'var(--gu-red-500)',
                  borderRadius: '4px 4px 0 0',
                }}
              />
            </div>
          )
        })}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))`,
          gap: 'var(--gu-space-2)',
          marginTop: 6,
          paddingTop: 6,
          borderTop: '1px solid var(--gu-border)',
          fontSize: 'var(--gu-text-2xs)',
          color: 'var(--gu-text-subtle)',
          textAlign: 'center',
        }}
      >
        {rows.map(r => (
          <span key={r.key} className="gu-truncate">
            {r.label}
          </span>
        ))}
      </div>

      {/* Fallback testuale: i valori non devono essere leggibili solo al passaggio del mouse */}
      <details style={{ marginTop: 'var(--gu-space-3)' }}>
        <summary style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)', cursor: 'pointer' }}>
          Vedi i valori in tabella
        </summary>
        <div className="gu-table-wrap" style={{ marginTop: 'var(--gu-space-2)' }}>
          <table className="gu-table">
            <thead>
              <tr>
                <th scope="col">Mese</th>
                <th scope="col" style={{ textAlign: 'right' }}>Obiettivo</th>
                <th scope="col" style={{ textAlign: 'right' }}>Risultato</th>
                <th scope="col" style={{ textAlign: 'right' }}>%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const t = r.target[metric.key] || 0
                const a = r.actual[metric.key] || 0
                return (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td className="gu-table__num">{formatValue(t, metric)}</td>
                    <td className="gu-table__num">{formatValue(a, metric)}</td>
                    <td className="gu-table__num">{t > 0 ? formatPercent((a / t) * 100, 0) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

/* ========================================================================== */

function formatValue(v: number, metric: MetricDef) {
  return metric.format === 'currency' ? formatCurrency(v) : formatNumber(v)
}

type RawRow = Record<string, number> & { advisor_user_id: string; year: number; month: number }

async function loadRows(
  table: 'v_progress_monthly' | 'goals_monthly',
  advisorIds: string[],
  years: number[],
  columns: string[],
) {
  const select = `advisor_user_id,year,month,${columns.join(',')}`
  const blocks = chunk(advisorIds)
  const results = await Promise.all(
    blocks.map(async slice => {
      const { data, error } = await supabase.from(table).select(select).in('advisor_user_id', slice).in('year', years)
      if (error) throw error
      return (data || []) as unknown as RawRow[]
    }),
  )
  return results.flat()
}

type Mapping = readonly (readonly [string, string])[]

function accumulate(acc: MetricValues, row: RawRow, mapping: Mapping) {
  for (const [metricKey, column] of mapping) {
    acc[metricKey as keyof MetricValues] += Number(row[column] || 0)
  }
}

/**
 * Somma le righe di più advisor sullo stesso mese.
 * `mapping` associa la chiave della metrica alla colonna da leggere: le viste
 * usano i nomi senza prefisso, la tabella obiettivi quelli con `target_`.
 */
function groupByMonth(rows: RawRow[], mapping: Mapping) {
  const out = new Map<string, MetricValues>()
  for (const r of rows) {
    const key = `${r.year}-${String(r.month).padStart(2, '0')}`
    const acc = out.get(key) || emptyMetrics()
    accumulate(acc, r, mapping)
    out.set(key, acc)
  }
  return out
}

/** Somma i mesi del periodo advisor per advisor. */
function groupByAdvisor(rows: RawRow[], mapping: Mapping) {
  const out = new Map<string, MetricValues>()
  for (const r of rows) {
    const acc = out.get(r.advisor_user_id) || emptyMetrics()
    accumulate(acc, r, mapping)
    out.set(r.advisor_user_id, acc)
  }
  return out
}
