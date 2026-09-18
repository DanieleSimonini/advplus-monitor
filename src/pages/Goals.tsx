import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
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
import { monthKeyOf, parseMonthKey } from '../lib/datetime'
import { displayName, errorMessage, formatCurrency, formatNumber, formatPercent, monthLabel } from '../lib/format'

type Targets = MetricValues

export default function GoalsPage() {
  const { me, isAdmin, isTeamLead, isJunior } = useAuth()
  const { visible: advisors } = useAdvisors()
  const toast = useToast()

  const [advisorId, setAdvisorId] = useState('')
  const [monthKey, setMonthKey] = useState(() => monthKeyOf(new Date()))
  const { year, month } = parseMonthKey(monthKey)

  const [annual, setAnnual] = useState<Targets>(emptyMetrics())
  const [monthly, setMonthly] = useState<Targets>(emptyMetrics())
  const [progress, setProgress] = useState<Record<number, MetricValues>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)

  // Selezione iniziale: un Junior vede solo sé stesso, un Team Lead parte dal
  // proprio team, un Admin dal primo Team Lead disponibile.
  useEffect(() => {
    if (advisorId || !me) return
    if (isJunior || isTeamLead) {
      setAdvisorId(me.user_id || '')
      return
    }
    const firstTl = advisors.find(a => a.role === 'Team Lead' && a.user_id)
    setAdvisorId(firstTl?.user_id || me.user_id || '')
  }, [advisorId, me, advisors, isJunior, isTeamLead])

  const selectable = useMemo(() => advisors.filter(a => a.role !== 'Admin' && a.user_id), [advisors])

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
      const [annualRow, monthlyRow, progressRows] = await Promise.all([
        supabase
          .from('goals')
          .select(`${METRICS.map(m => m.targetColumn).join(',')}`)
          .eq('advisor_user_id', advisorId)
          .eq('year', year)
          .maybeSingle(),
        supabase
          .from('goals_monthly')
          .select(`${METRICS.map(m => m.targetColumn).join(',')}`)
          .eq('advisor_user_id', advisorId)
          .eq('year', year)
          .eq('month', month)
          .maybeSingle(),
        supabase
          .from('v_progress_monthly')
          .select(`month,${METRICS.map(m => m.key).join(',')}`)
          .eq('advisor_user_id', advisorId)
          .eq('year', year),
      ])

      setAnnual(rowToTargets(annualRow.data as unknown as Record<string, unknown> | null))
      setMonthly(rowToTargets(monthlyRow.data as unknown as Record<string, unknown> | null))

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
  }, [advisorId, year, month])

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

  const monthProgress = progress[month] || emptyMetrics()

  async function save() {
    if (!canEdit) return
    setSaving(true)
    try {
      await upsertGoals('goals', { advisor_user_id: advisorId, year }, annual, ['advisor_user_id', 'year'])
      await upsertGoals(
        'goals_monthly',
        {
          advisor_user_id: advisorId,
          year,
          month,
          // `ym` è dichiarata NOT NULL: si mantiene il formato già presente
          // nei dati storici (YYYYMM), scritto esplicitamente come testo.
          ym: String(year * 100 + month),
        },
        monthly,
        ['advisor_user_id', 'year', 'month'],
      )
      toast.success('Obiettivi salvati')
      setDirty(false)
      await load()
    } catch (e) {
      toast.error('Salvataggio non riuscito', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  function distributeAnnual() {
    const next = emptyMetrics()
    for (const m of METRICS) next[m.key] = Math.round(((annual[m.key] || 0) / 12) * 100) / 100
    setMonthly(next)
    setDirty(true)
    toast.info('Obiettivo annuale diviso per 12', 'Controlla i valori e salva per confermare.')
  }

  const selectedAdvisor = advisors.find(a => a.user_id === advisorId)

  return (
    <>
      <PageHeader
        title="Obiettivi"
        description={
          canEdit
            ? 'Imposta i target annuali e mensili e confrontali con i risultati.'
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
            onChange={e => setAdvisorId(e.target.value)}
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

        <div className="gu-field">
          <label className="gu-field__label" htmlFor="goals-month">
            Mese
          </label>
          <input
            id="goals-month"
            className="gu-input"
            type="month"
            value={monthKey}
            onChange={e => e.target.value && setMonthKey(e.target.value)}
            style={{ width: 160 }}
          />
        </div>

        <Button icon="clock" onClick={() => setMonthKey(monthKeyOf(new Date()))}>
          Mese corrente
        </Button>

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

      <div className="gu-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <GoalCard
          title={`Obiettivi ${year}`}
          subtitle="Target annuale"
          values={annual}
          actual={yearProgress}
          readOnly={!canEdit}
          loading={loading}
          onChange={next => {
            setAnnual(next)
            setDirty(true)
          }}
          extra={
            canEdit ? (
              <Button size="sm" icon="arrowDown" onClick={distributeAnnual} title="Copia un dodicesimo sul mese">
                Dividi sul mese
              </Button>
            ) : null
          }
        />

        <GoalCard
          title={`Obiettivi ${monthLabel(year, month)}`}
          subtitle="Target mensile"
          values={monthly}
          actual={monthProgress}
          readOnly={!canEdit}
          loading={loading}
          onChange={next => {
            setMonthly(next)
            setDirty(true)
          }}
        />
      </div>

      <Card>
        <CardHeader title={`Andamento mensile ${year}`} subtitle="Risultati consuntivi per mese" icon="report" />
        <CardBody>
          {loading ? (
            <Skeleton height={200} radius={12} />
          ) : (
            <div className="gu-table-wrap">
              <table className="gu-table">
                <thead>
                  <tr>
                    <th scope="col">Mese</th>
                    {METRICS.map(m => (
                      <th key={m.key} scope="col" style={{ textAlign: 'right' }}>
                        {m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                    const values = progress[m] || emptyMetrics()
                    const isCurrent = m === month
                    return (
                      <tr key={m} style={isCurrent ? { background: 'var(--gu-primary-soft)' } : undefined}>
                        <th scope="row" style={{ fontWeight: isCurrent ? 700 : 500, textTransform: 'none', fontSize: 'var(--gu-text-md)', letterSpacing: 0, position: 'static', background: 'transparent', color: 'inherit' }}>
                          {monthLabel(year, m)}
                        </th>
                        {METRICS.map(metric => (
                          <td key={metric.key} className="gu-table__num">
                            {metric.format === 'currency'
                              ? formatCurrency(values[metric.key])
                              : formatNumber(values[metric.key])}
                          </td>
                        ))}
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

function GoalCard({
  title,
  subtitle,
  values,
  actual,
  readOnly,
  loading,
  onChange,
  extra,
}: {
  title: string
  subtitle: string
  values: Targets
  actual: MetricValues
  readOnly: boolean
  loading: boolean
  onChange: (next: Targets) => void
  extra?: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} icon="target" actions={extra} />
      <CardBody className="gu-stack">
        {METRICS.map(m => {
          const target = values[m.key] || 0
          const done = actual[m.key] || 0
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
                      readOnly={readOnly}
                      disabled={readOnly}
                      onChange={e => onChange({ ...values, [m.key]: Number(e.target.value || 0) })}
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
                      {m.format === 'currency' ? formatCurrency(done) : formatNumber(done)} su{' '}
                      {m.format === 'currency' ? formatCurrency(target) : formatNumber(target)}
                    </span>
                    <strong
                      style={{
                        color:
                          toneForRatio(ratio) === 'success'
                            ? 'var(--gu-success-fg)'
                            : toneForRatio(ratio) === 'warning'
                              ? 'var(--gu-warning-fg)'
                              : 'var(--gu-danger-fg)',
                      }}
                    >
                      {formatPercent(ratio * 100, 0)}
                    </strong>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </CardBody>
    </Card>
  )
}

/* ========================================================================== */

function rowToTargets(row: Record<string, unknown> | null): Targets {
  const out = emptyMetrics()
  if (!row) return out
  for (const m of METRICS) out[m.key] = Number(row[m.targetColumn] || 0)
  return out
}

/**
 * Salvataggio di una riga di obiettivi.
 *
 * Due accortezze:
 * - le tabelle `goals` e `goals_monthly` hanno sia le colonne `target_*` sia
 *   una serie di colonne omonime senza prefisso, rimaste da una migrazione
 *   precedente e dichiarate NOT NULL. Vengono scritte entrambe con lo stesso
 *   valore: altrimenti l'inserimento fallisce o le viste che leggono le
 *   colonne vecchie restano a zero.
 * - `upsert` richiede un vincolo di unicità sulle colonne di conflitto. Se non
 *   c'è, Postgres risponde 42P10: in quel caso si ripiega su un normale
 *   aggiorna-oppure-inserisci.
 */
async function upsertGoals(
  table: 'goals' | 'goals_monthly',
  keys: Record<string, unknown>,
  targets: Targets,
  conflictColumns: string[],
) {
  const payload: Record<string, unknown> = { ...keys }
  for (const m of METRICS) {
    payload[m.targetColumn] = targets[m.key] || 0
    payload[m.key] = targets[m.key] || 0
  }

  const { error } = await supabase.from(table).upsert(payload, { onConflict: conflictColumns.join(',') })
  if (!error) return

  const noConstraint = (error as { code?: string }).code === '42P10'
  if (!noConstraint) throw error

  let find = supabase.from(table).select('id')
  for (const [k, v] of Object.entries(keys)) {
    if (k === 'ym') continue
    find = find.eq(k, v as never)
  }
  const existing = await find.maybeSingle()
  if (existing.data) {
    const { error: upErr } = await supabase.from(table).update(payload).eq('id', (existing.data as { id: string }).id)
    if (upErr) throw upErr
  } else {
    const { error: insErr } = await supabase.from(table).insert(payload)
    if (insErr) throw insErr
  }
}
