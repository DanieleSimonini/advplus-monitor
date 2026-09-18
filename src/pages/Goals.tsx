import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  Input,
  Progress,
  SelectField,
  Skeleton,
  toneForRatio,
  useToast,
} from '../ui'
import { PageHeader } from '../app/AppShell'
import { useAuth } from '../auth/AuthProvider'
import { useAdvisors } from '../lib/useAdvisors'
import { METRICS, emptyMetrics, type MetricValues } from '../lib/domain'
import { displayName, errorMessage, formatCurrency, formatNumber, formatPercent, monthLabel } from '../lib/format'
import type { NavigateFn, Route } from '../lib/router'

type Targets = MetricValues
type MonthlyTargets = Record<number, Targets>

function emptyYear(): MonthlyTargets {
  const out: MonthlyTargets = {}
  for (let m = 1; m <= 12; m++) out[m] = emptyMetrics()
  return out
}

export default function GoalsPage({ route, go }: { route: Route; go: NavigateFn }) {
  const { me, isAdmin, isTeamLead, isJunior } = useAuth()
  const { visible: advisors } = useAdvisors()
  const toast = useToast()

  const thisYear = new Date().getFullYear()
  const year = Number(route.query.anno) || thisYear
  const advisorId = route.query.chi || ''

  const setQuery = useCallback(
    (patch: Record<string, string>) => go(route.id, { query: { ...route.query, ...patch } }),
    [go, route.id, route.query],
  )

  const [annual, setAnnual] = useState<Targets>(emptyMetrics())
  const [monthly, setMonthly] = useState<MonthlyTargets>(emptyYear)
  const [progress, setProgress] = useState<Record<number, MetricValues>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [showActuals, setShowActuals] = useState(true)

  const selectable = useMemo(() => advisors.filter(a => a.role !== 'Admin' && a.user_id), [advisors])

  // Selezione iniziale: un Junior vede solo sé stesso, un Team Lead parte dal
  // proprio profilo, un Admin dal primo Team Lead disponibile.
  useEffect(() => {
    if (advisorId || !me) return
    if (isJunior || isTeamLead) {
      if (me.user_id) setQuery({ chi: me.user_id })
      return
    }
    const firstTl = advisors.find(a => a.role === 'Team Lead' && a.user_id)
    const target = firstTl?.user_id || me.user_id
    if (target) setQuery({ chi: target })
  }, [advisorId, me, advisors, isJunior, isTeamLead, setQuery])

  /**
   * Chi può modificare cosa, in linea con le policy del database:
   * un Admin modifica tutto, un Team Lead solo i Junior del proprio team
   * (nemmeno i propri obiettivi), un Junior legge e basta.
   */
  const canEdit = useMemo(() => {
    if (!me) return false
    if (isAdmin) return true
    if (isTeamLead) return advisorId !== me.user_id && selectable.some(a => a.user_id === advisorId && a.role === 'Junior')
    return false
  }, [me, isAdmin, isTeamLead, advisorId, selectable])

  const load = useCallback(async () => {
    if (!advisorId) return
    setLoading(true)
    setError('')
    try {
      const targetColumns = METRICS.map(m => m.targetColumn).join(',')
      const [annualRow, monthlyRows, progressRows] = await Promise.all([
        supabase.from('goals').select(targetColumns).eq('advisor_user_id', advisorId).eq('year', year).maybeSingle(),
        supabase
          .from('goals_monthly')
          .select(`month,${targetColumns}`)
          .eq('advisor_user_id', advisorId)
          .eq('year', year),
        supabase
          .from('v_progress_monthly')
          .select(`month,${METRICS.map(m => m.key).join(',')}`)
          .eq('advisor_user_id', advisorId)
          .eq('year', year),
      ])

      setAnnual(rowToTargets(annualRow.data as unknown as Record<string, unknown> | null))

      const grid = emptyYear()
      for (const r of (monthlyRows.data || []) as unknown as Record<string, unknown>[]) {
        const m = Number(r.month)
        if (m >= 1 && m <= 12) grid[m] = rowToTargets(r)
      }
      setMonthly(grid)

      const byMonth: Record<number, MetricValues> = {}
      for (const r of (progressRows.data || []) as unknown as Record<string, number>[]) {
        const values = emptyMetrics()
        for (const m of METRICS) values[m.key] = Number(r[m.key] || 0)
        byMonth[Number(r.month)] = values
      }
      setProgress(byMonth)
      setDirty(false)
    } catch (e) {
      setError(errorMessage(e, 'Impossibile caricare gli obiettivi'))
    } finally {
      setLoading(false)
    }
  }, [advisorId, year])

  useEffect(() => {
    void load()
  }, [load])

  // Avviso prima di perdere modifiche non salvate.
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const yearProgress = useMemo(() => {
    const total = emptyMetrics()
    for (const values of Object.values(progress)) {
      for (const m of METRICS) total[m.key] += values[m.key] || 0
    }
    return total
  }, [progress])

  const monthlySum = useMemo(() => {
    const total = emptyMetrics()
    for (let m = 1; m <= 12; m++) for (const metric of METRICS) total[metric.key] += monthly[m]?.[metric.key] || 0
    return total
  }, [monthly])

  async function save() {
    if (!canEdit) return
    setSaving(true)
    try {
      await upsertGoals('goals', [{ advisor_user_id: advisorId, year, ...targetPayload(annual) }], [
        'advisor_user_id',
        'year',
      ])
      await upsertGoals(
        'goals_monthly',
        Array.from({ length: 12 }, (_, i) => i + 1).map(m => ({
          advisor_user_id: advisorId,
          year,
          month: m,
          // `ym` è dichiarata NOT NULL: si mantiene il formato già presente
          // nei dati storici (YYYYMM), scritto esplicitamente come testo.
          ym: String(year * 100 + m),
          ...targetPayload(monthly[m]),
        })),
        ['advisor_user_id', 'year', 'month'],
      )
      toast.success('Obiettivi salvati', `Anno ${year} · ${displayName(advisors.find(a => a.user_id === advisorId))}`)
      setDirty(false)
      await load()
    } catch (e) {
      toast.error('Salvataggio non riuscito', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  /**
   * Divide l'obiettivo annuale su tutti e dodici i mesi.
   * Prima la stessa funzione riempiva SOLO il mese visualizzato: per impostare
   * un anno servivano dodici passaggi, per una rete di sette advisor 84.
   */
  function distributeAnnual() {
    const grid = emptyYear()
    for (let m = 1; m <= 12; m++) {
      for (const metric of METRICS) {
        const monthlyValue = (annual[metric.key] || 0) / 12
        // L'ultimo mese assorbe l'arrotondamento, così la somma dei dodici mesi
        // fa esattamente l'annuale invece di scostarsi di qualche centesimo.
        grid[m][metric.key] =
          m < 12
            ? Math.round(monthlyValue * 100) / 100
            : Math.round(((annual[metric.key] || 0) - Math.round(monthlyValue * 100) / 100 * 11) * 100) / 100
      }
    }
    setMonthly(grid)
    setDirty(true)
    toast.info('Annuale distribuito sui dodici mesi', 'Controlla i valori e salva per confermare.')
  }

  function setMonthValue(month: number, key: keyof MetricValues, value: number) {
    setMonthly(prev => ({ ...prev, [month]: { ...prev[month], [key]: value } }))
    setDirty(true)
  }

  const selectedAdvisor = advisors.find(a => a.user_id === advisorId)
  const years = [thisYear - 1, thisYear, thisYear + 1]

  return (
    <>
      <PageHeader
        title="Obiettivi"
        description={
          canEdit
            ? "Imposta i target dell'anno e dei singoli mesi, e confrontali con i risultati."
            : 'Consultazione dei target assegnati e dello stato di avanzamento.'
        }
        actions={
          canEdit ? (
            <>
              <Button icon="refresh" onClick={() => void load()} disabled={saving}>
                Ripristina
              </Button>
              <Button variant="primary" icon="check" onClick={save} loading={saving} disabled={!dirty}>
                Salva obiettivi
              </Button>
            </>
          ) : null
        }
      />

      <div className="gu-filters">
        {selectable.length > 1 ? (
          <SelectField
            label="Advisor"
            value={advisorId}
            onChange={e => setQuery({ chi: e.target.value })}
            style={{ minWidth: 220 }}
          >
            {selectable.map(a => (
              <option key={a.user_id!} value={a.user_id!}>
                {displayName(a)}
                {a.role !== 'Junior' ? ` (${a.role})` : ''}
              </option>
            ))}
          </SelectField>
        ) : (
          <div className="gu-field">
            <span className="gu-field__label">Advisor</span>
            <div style={{ height: 'var(--gu-control-h)', display: 'flex', alignItems: 'center', fontWeight: 600 }}>
              {displayName(selectedAdvisor || me)}
            </div>
          </div>
        )}

        <SelectField label="Anno" value={String(year)} onChange={e => setQuery({ anno: e.target.value })} style={{ minWidth: 120 }}>
          {years.map(y => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </SelectField>

        <div className="gu-field">
          <span className="gu-field__label">Risultati</span>
          <Checkbox checked={showActuals} onChange={setShowActuals} label="Mostra i consuntivi" />
        </div>

        <div className="gu-spacer" />
        {!canEdit && <Badge tone="neutral">Sola lettura</Badge>}
        {dirty && <Badge tone="warning" dot>Modifiche non salvate</Badge>}
      </div>

      {error && <Alert tone="danger" title="Errore">{error}</Alert>}

      {isTeamLead && advisorId === me?.user_id && (
        <Alert tone="info">
          I tuoi obiettivi personali sono impostati dall'amministratore della rete. Puoi modificare quelli dei Junior
          del tuo team selezionandoli qui sopra.
        </Alert>
      )}

      <Card>
        <CardHeader
          title={`Obiettivo ${year}`}
          subtitle="Target annuale, confrontato con il consuntivo dell'anno"
          icon="target"
          actions={
            canEdit ? (
              <Button size="sm" icon="arrowDown" onClick={distributeAnnual}>
                Distribuisci sui 12 mesi
              </Button>
            ) : null
          }
        />
        <CardBody className="gu-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
          {METRICS.map(m => {
            const target = annual[m.key] || 0
            const done = yearProgress[m.key] || 0
            const ratio = target > 0 ? done / target : 0
            return (
              <div key={m.key} className="gu-stack-sm">
                <Field label={`${m.label}${m.format === 'currency' ? ' (€)' : ''}`}>
                  {({ id }) =>
                    loading ? (
                      <Skeleton height={36} radius={8} />
                    ) : (
                      <Input
                        id={id}
                        type="number"
                        min={0}
                        step={m.format === 'currency' ? '100' : '1'}
                        inputMode="numeric"
                        value={target}
                        readOnly={!canEdit}
                        disabled={!canEdit}
                        onChange={e => {
                          setAnnual({ ...annual, [m.key]: Number(e.target.value || 0) })
                          setDirty(true)
                        }}
                      />
                    )
                  }
                </Field>
                {target > 0 && (
                  <>
                    <Progress ratio={ratio} label={`${m.label}: ${formatPercent(ratio * 100, 0)} dell'obiettivo`} />
                    <div
                      className="gu-row"
                      style={{ justifyContent: 'space-between', fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)' }}
                    >
                      <span>
                        {formatValue(done, m.format)} su {formatValue(target, m.format)}
                      </span>
                      <strong style={{ color: colorForRatio(ratio) }}>{formatPercent(ratio * 100, 0)}</strong>
                    </div>
                  </>
                )}
                {monthlySum[m.key] > 0 && Math.abs(monthlySum[m.key] - target) > 0.5 && (
                  <span className="gu-field__hint">
                    La somma dei mesi è {formatValue(monthlySum[m.key], m.format)}
                  </span>
                )}
              </div>
            )
          })}
        </CardBody>
      </Card>

      {/*
        Griglia dei dodici mesi.
        Prima si impostava un mese alla volta: per un anno servivano dodici
        visite alla pagina, e i consuntivi stavano in una tabella separata più
        in basso, quindi non si vedeva mai il target accanto al suo risultato.
      */}
      <Card>
        <CardHeader
          title={`Obiettivi mensili ${year}`}
          subtitle={canEdit ? 'Modifica direttamente le celle, poi salva' : 'Target mensili assegnati'}
          icon="calendar"
        />
        <CardBody>
          {loading ? (
            <Skeleton height={320} radius={12} />
          ) : (
            <div className="gu-table-wrap">
              <table className="gu-table gu-goals-grid">
                <thead>
                  <tr>
                    <th scope="col">Mese</th>
                    {METRICS.map(m => (
                      <th key={m.key} scope="col" style={{ textAlign: 'right' }}>
                        {m.label}
                        {m.format === 'currency' ? ' (€)' : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
                    const actual = progress[month] || emptyMetrics()
                    const isCurrent = year === thisYear && month === new Date().getMonth() + 1
                    return (
                      <tr key={month} style={isCurrent ? { background: 'var(--gu-primary-soft)' } : undefined}>
                        <th
                          scope="row"
                          style={{
                            fontWeight: isCurrent ? 700 : 500,
                            textTransform: 'none',
                            fontSize: 'var(--gu-text-md)',
                            letterSpacing: 0,
                            position: 'static',
                            background: 'transparent',
                            color: 'inherit',
                          }}
                        >
                          {monthLabel(year, month)}
                        </th>
                        {METRICS.map(metric => {
                          const target = monthly[month]?.[metric.key] || 0
                          const done = actual[metric.key] || 0
                          const ratio = target > 0 ? done / target : 0
                          return (
                            <td key={metric.key} className="gu-table__num">
                              <input
                                className="gu-input gu-goals-grid__input"
                                type="number"
                                min={0}
                                step={metric.format === 'currency' ? '100' : '1'}
                                inputMode="numeric"
                                aria-label={`${metric.label}, ${monthLabel(year, month)}`}
                                value={target}
                                readOnly={!canEdit}
                                disabled={!canEdit}
                                onChange={e => setMonthValue(month, metric.key, Number(e.target.value || 0))}
                              />
                              {showActuals && (
                                <span
                                  className="gu-goals-grid__actual"
                                  style={{ color: target > 0 ? colorForRatio(ratio) : 'var(--gu-text-subtle)' }}
                                >
                                  {formatValue(done, metric.format)}
                                  {target > 0 ? ` · ${formatPercent(ratio * 100, 0)}` : ''}
                                </span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  )
}

/* ========================================================================== */

function formatValue(v: number, format: 'int' | 'currency') {
  return format === 'currency' ? formatCurrency(v) : formatNumber(v)
}

function colorForRatio(ratio: number) {
  const tone = toneForRatio(ratio)
  return tone === 'success'
    ? 'var(--gu-success-fg)'
    : tone === 'warning'
      ? 'var(--gu-warning-fg)'
      : 'var(--gu-danger-fg)'
}

function rowToTargets(row: Record<string, unknown> | null): Targets {
  const out = emptyMetrics()
  if (!row) return out
  for (const m of METRICS) out[m.key] = Number(row[m.targetColumn] || 0)
  return out
}

function targetPayload(targets: Targets | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of METRICS) out[m.targetColumn] = targets?.[m.key] || 0
  return out
}

/**
 * Salvataggio di una o più righe di obiettivi.
 *
 * Si scrivono SOLO le colonne `target_*`.
 *
 * Accanto a quelle esistono colonne residue di una migrazione precedente, e
 * non hanno gli stessi nomi nelle due tabelle: in `goals` si chiamano
 * `prod_danni`, `prod_vprot`… mentre in `goals_monthly` `danni_non_auto`,
 * `vita_protection`… Scriverle entrambe faceva fallire il salvataggio mensile
 * con "column prod_danni does not exist". Hanno un default a zero, quindi
 * lasciarle stare è corretto: nessuna riga viene rifiutata.
 *
 * `upsert` richiede un vincolo di unicità sulle colonne di conflitto. Gli
 * indici esistono (`idx_goals_unique`, `idx_goals_monthly_unique`), ma se un
 * giorno sparissero Postgres risponderebbe 42P10: il ripiego qui sotto
 * gestisce anche quel caso, riga per riga.
 */
async function upsertGoals(
  table: 'goals' | 'goals_monthly',
  payloads: Record<string, unknown>[],
  conflictColumns: string[],
) {
  if (!payloads.length) return
  const { error } = await supabase.from(table).upsert(payloads, { onConflict: conflictColumns.join(',') })
  if (!error) return

  const noConstraint = (error as { code?: string }).code === '42P10'
  if (!noConstraint) throw error

  for (const payload of payloads) {
    let find = supabase.from(table).select('id')
    for (const key of conflictColumns) find = find.eq(key, payload[key] as never)
    const existing = await find.maybeSingle()
    if (existing.data) {
      const { error: upErr } = await supabase.from(table).update(payload).eq('id', (existing.data as { id: string }).id)
      if (upErr) throw upErr
    } else {
      const { error: insErr } = await supabase.from(table).insert(payload)
      if (insErr) throw insErr
    }
  }
}
