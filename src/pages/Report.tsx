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
  Skeleton,
  toneForRatio,
} from '../ui'
import { PageHeader } from '../app/AppShell'
import { MonthRange, ScopeSelect } from '../app/ScopeSelect'
import { useAdvisors, type Scope } from '../lib/useAdvisors'
import { chunk } from '../lib/db'
import { METRICS, emptyMetrics, type MetricDef, type MetricValues } from '../lib/domain'
import { addMonths, listMonths, monthKeyOf } from '../lib/datetime'
import { downloadCsv, errorMessage, formatCurrency, formatNumber, formatPercent, monthLabel } from '../lib/format'

type MonthRow = {
  key: string
  year: number
  month: number
  label: string
  target: MetricValues
  actual: MetricValues
}

export default function ReportPage() {
  const { resolveScope, scopeOptions, defaultScope } = useAdvisors()
  const [scope, setScope] = useState<Scope | null>(null)
  const [period, setPeriod] = useState(() => {
    const now = monthKeyOf(new Date())
    return { from: addMonths(now, -5), to: now }
  })
  const [rows, setRows] = useState<MonthRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!scope) setScope(defaultScope)
  }, [defaultScope, scope])

  const advisorIds = useMemo(() => (scope ? resolveScope(scope) : []), [scope, resolveScope])
  const advisorKey = advisorIds.join(',')

  const load = useCallback(async () => {
    if (!advisorIds.length) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const months = listMonths(period.from, period.to)
      const years = Array.from(new Set(months.map(m => m.year)))

      const [progress, goals] = await Promise.all([
        loadRows('v_progress_monthly', advisorIds, years, METRICS.map(m => m.key)),
        loadRows('goals_monthly', advisorIds, years, METRICS.map(m => m.targetColumn)),
      ])

      const targetByMonth = aggregate(goals, METRICS.map(m => [m.key, m.targetColumn] as const))
      const actualByMonth = aggregate(progress, METRICS.map(m => [m.key, m.key] as const))

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

  return (
    <>
      <PageHeader
        title="Report"
        description="Risultati a confronto con gli obiettivi, mese per mese."
        actions={
          <Button icon="download" onClick={exportReport} disabled={!rows.length}>
            Esporta
          </Button>
        }
      />

      <div className="gu-filters">
        {scope && <ScopeSelect value={scope} onChange={setScope} options={scopeOptions} />}
        <MonthRange from={period.from} to={period.to} onChange={setPeriod} />
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
                    <Badge tone={badgeTone(totals.actual[m.key] / totals.target[m.key])}>
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

function badgeTone(ratio: number): 'success' | 'warning' | 'danger' {
  return toneForRatio(ratio)
}

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
      return (data || []) as unknown as Record<string, number>[]
    }),
  )
  return results.flat()
}

/**
 * Somma le righe di più advisor sullo stesso mese.
 * `mapping` associa la chiave della metrica alla colonna da leggere: le viste
 * usano i nomi senza prefisso, la tabella obiettivi quelli con `target_`.
 */
function aggregate(rows: Record<string, number>[], mapping: readonly (readonly [string, string])[]) {
  const out = new Map<string, MetricValues>()
  for (const r of rows) {
    const key = `${r.year}-${String(r.month).padStart(2, '0')}`
    const acc = out.get(key) || emptyMetrics()
    for (const [metricKey, column] of mapping) {
      acc[metricKey as keyof MetricValues] += Number(r[column] || 0)
    }
    out.set(key, acc)
  }
  return out
}
