import React, { useEffect, useMemo, useState } from 'react'

// Mock Supabase client per demo
const supabase = {
  auth: {
    getUser: async () => ({ data: { user: { id: 'user123' } } })
  },
  from: (table: string) => ({
    select: (fields: string) => ({
      eq: (field: string, value: any) => ({
        maybeSingle: async () => ({
          data: { 
            id: 'adv1', 
            user_id: 'user123', 
            email: 'advisor@example.com', 
            full_name: 'Mario Rossi',
            role: 'Admin'
          },
          error: null
        }),
        order: (field: string, opts: any) => ({
          then: async (fn: any) => fn({ 
            data: [
              { user_id: 'user123', email: 'advisor@example.com', full_name: 'Mario Rossi' },
              { user_id: 'user456', email: 'advisor2@example.com', full_name: 'Luca Bianchi' }
            ], 
            error: null 
          })
        })
      }),
      in: (field: string, values: any[]) => ({
        then: async (fn: any) => fn({ 
          data: Array(6).fill(null).map((_, i) => ({
            year: 2025,
            month: i + 5,
            consulenze: 20 + i * 2,
            contratti: 15 + i,
            prod_danni: 50000 + i * 5000,
            prod_vprot: 30000 + i * 3000,
            prod_vpr: 20000 + i * 2000,
            prod_vpu: 40000 + i * 4000,
            advisor_user_id: 'user123'
          })),
          error: null 
        })
      })
    })
  })
}

type Role = 'Admin' | 'Team Lead' | 'Junior'
type Me = { id: string; user_id: string; email: string; full_name: string | null; role: Role }

type GoalsRow = {
  advisor_user_id?: string
  advisor_id?: string
  year: number
  month: number
  consulenze?: number
  contratti?: number
  prod_danni?: number
  prod_vprot?: number
  prod_vpr?: number
  prod_vpu?: number
}

type ProgressRow = {
  advisor_user_id?: string
  advisor_id?: string
  year: number
  month: number
  consulenze?: number
  contratti?: number
  prod_danni?: number
  prod_vprot?: number
  prod_vpr?: number
  prod_vpu?: number
  appuntamenti?: number
}

const box: React.CSSProperties = { 
  background: '#fff', 
  border: '1px solid #e5e7eb', 
  borderRadius: 12, 
  padding: 20,
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
}

const ipt: React.CSSProperties = { 
  padding: '8px 12px', 
  border: '1px solid #d1d5db', 
  borderRadius: 8, 
  background:'#fff', 
  fontSize: 14
}

export default function ReportPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [advisors, setAdvisors] = useState<{ user_id: string, email: string, full_name: string | null }[]>([])

  const today = new Date()
  const [fromKey, setFromKey] = useState(toMonthKey(addMonths(today, -5)))
  const [toKey, setToKey] = useState(toMonthKey(today))
  const [advisorUid, setAdvisorUid] = useState('')

  const [goals, setGoals] = useState<GoalsRow[]>([])
  const [prog, setProg] = useState<ProgressRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      setLoading(true); setErr('')
      try {
        const { data: auth } = await supabase.auth.getUser()
        const uid = auth.user?.id
        if (!uid) { setErr('Utente non autenticato'); setLoading(false); return }

        const meObj: Me = { 
          id: 'adv1', 
          user_id: uid, 
          email: 'advisor@example.com', 
          full_name: 'Mario Rossi',
          role: 'Admin'
        }
        setMe(meObj)
        setAdvisors([
          { user_id: uid, email: 'advisor@example.com', full_name: 'Mario Rossi' },
          { user_id: 'user456', email: 'advisor2@example.com', full_name: 'Luca Bianchi' }
        ])
        setAdvisorUid(uid)

        // Mock data per demo
        const mockGoals = Array(6).fill(null).map((_, i) => ({
          year: 2025,
          month: i + 5,
          consulenze: 25 + i * 2,
          contratti: 18 + i,
          prod_danni: 60000 + i * 6000,
          prod_vprot: 35000 + i * 3500,
          prod_vpr: 25000 + i * 2500,
          prod_vpu: 50000 + i * 5000,
          advisor_user_id: uid
        }))

        const mockProg = Array(6).fill(null).map((_, i) => ({
          year: 2025,
          month: i + 5,
          appuntamenti: 20 + i * 3,
          contratti: 15 + i * 2,
          prod_danni: 52000 + i * 5500,
          prod_vprot: 31000 + i * 3200,
          prod_vpr: 22000 + i * 2300,
          prod_vpu: 45000 + i * 4500,
          advisor_user_id: uid
        }))

        setGoals(mockGoals)
        setProg(mockProg)
      } catch (ex: any) {
        setErr(ex.message || 'Errore bootstrap')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const rows = useMemo(() => 
    mergeByMonth(goals, prog, fromKey, toKey, advisorUid, me?.id || ''), 
    [goals, prog, fromKey, toKey, advisorUid, me?.id]
  )

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, color: '#111' }}>
          📊 Report Andamento vs Obiettivi
        </h1>
        <p style={{ color: '#6b7280', fontSize: 14 }}>
          Monitora le performance rispetto agli obiettivi prefissati
        </p>
      </div>

      {/* Filtri */}
      <div style={{ 
        ...box, 
        display: 'flex', 
        gap: 16, 
        alignItems: 'center', 
        flexWrap: 'wrap',
        marginBottom: 24 
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>Periodo:</label>
          <input 
            type="month" 
            value={fromKey} 
            onChange={e => setFromKey(e.target.value)} 
            style={ipt} 
          />
          <span style={{ color: '#9ca3af' }}>→</span>
          <input 
            type="month" 
            value={toKey} 
            onChange={e => setToKey(e.target.value)} 
            style={ipt} 
          />
        </div>

        {me && (me.role === 'Admin' || me.role === 'Team Lead') && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
            <label style={{ fontSize: 14, fontWeight: 600 }}>Advisor:</label>
            <select 
              value={advisorUid} 
              onChange={e => setAdvisorUid(e.target.value)} 
              style={{ ...ipt, minWidth: 200 }}
            >
              <option value={me.user_id}>👤 {me.full_name || me.email} (me)</option>
              {advisors.filter(a => a.user_id !== me.user_id).map(a => (
                <option key={a.user_id} value={a.user_id}>
                  {a.full_name || a.email}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {err && (
        <div style={{ 
          ...box, 
          background: '#fef2f2', 
          border: '1px solid #fecaca',
          color: '#dc2626',
          marginBottom: 24 
        }}>
          ⚠️ {err}
        </div>
      )}

      {/* Metriche */}
      <div style={{ display: 'grid', gap: 24 }}>
        <MetricCard title="📅 Appuntamenti" field="appuntamenti" rows={rows} format="int" />
        <MetricCard title="📝 Contratti" field="contratti" rows={rows} format="int" />
        <MetricCard title="🛡️ Produzione Danni Non Auto" field="prod_danni" rows={rows} format="currency" />
        <MetricCard title="💼 Vita Protection" field="prod_vprot" rows={rows} format="currency" />
        <MetricCard title="🔄 Vita Premi Ricorrenti" field="prod_vpr" rows={rows} format="currency" />
        <MetricCard title="💰 Vita Premi Unici" field="prod_vpu" rows={rows} format="currency" />
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
          ⏳ Caricamento dati...
        </div>
      )}
    </div>
  )
}

// ---------- MetricCard Component ----------
function MetricCard({ title, field, rows, format }: {
  title: string,
  field: keyof GoalsRow | 'appuntamenti',
  rows: MergedRow[],
  format: 'int' | 'currency'
}) {
  const totGoal = rows.reduce((s, r) => s + (r.goal[field] || 0), 0)
  const totAct = rows.reduce((s, r) => s + (r.actual[field] || 0), 0)
  const pct = totGoal > 0 ? (totAct / totGoal) : 0
  const achieved = pct >= 1

  return (
    <div style={box}>
      {/* Header con totali */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: 20,
        paddingBottom: 16,
        borderBottom: '2px solid #f3f4f6'
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>{title}</div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#111' }}>
            {fmt(totAct, format)}
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
            su {fmt(totGoal, format)} target
          </div>
        </div>
      </div>

      {/* Grafico mensile */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ 
          fontSize: 13, 
          fontWeight: 600, 
          color: '#6b7280',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 16
        }}>
          <span>Andamento Mensile</span>
          <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 12, height: 12, background: '#e5e7eb', borderRadius: 2 }} />
              <span>Obiettivo</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 12, height: 12, background: '#3b82f6', borderRadius: 2 }} />
              <span>Realizzato</span>
            </div>
          </div>
        </div>
        <BarChart rows={rows} field={field} format={format} />
      </div>

      {/* Obiettivo di periodo - ENHANCED */}
      <div style={{ 
        background: achieved ? '#f0fdf4' : '#fef3c7',
        border: `2px solid ${achieved ? '#86efac' : '#fcd34d'}`,
        borderRadius: 12,
        padding: 20
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: 12
        }}>
          <div style={{ 
            fontSize: 15, 
            fontWeight: 700,
            color: achieved ? '#166534' : '#92400e',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <span style={{ fontSize: 20 }}>{achieved ? '✓' : '⚠'}</span>
            Obiettivo di Periodo
          </div>
          <div style={{ 
            fontSize: 28, 
            fontWeight: 800,
            color: achieved ? '#16a34a' : '#d97706'
          }}>
            {Math.round(pct * 100)}%
          </div>
        </div>

        {/* Barra progresso */}
        <PeriodTargetBar 
          totalGoal={totGoal} 
          totalActual={totAct} 
          achieved={achieved}
        />

        {/* Dettagli numerici */}
        <div style={{ 
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          gap: 16,
          marginTop: 16,
          fontSize: 14
        }}>
          <div>
            <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 4 }}>
              Target
            </div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              {fmt(totGoal, format)}
            </div>
          </div>
          
          <div style={{ 
            width: 1, 
            background: '#d1d5db',
            margin: '4px 0'
          }} />
          
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 4 }}>
              Realizzato
            </div>
            <div style={{ 
              fontWeight: 700, 
              fontSize: 16,
              color: achieved ? '#16a34a' : '#d97706'
            }}>
              {fmt(totAct, format)}
            </div>
          </div>
        </div>

        {/* Messaggio di stato */}
        <div style={{ 
          marginTop: 12,
          paddingTop: 12,
          borderTop: `1px solid ${achieved ? '#bbf7d0' : '#fde68a'}`,
          fontSize: 13,
          color: achieved ? '#166534' : '#92400e',
          fontWeight: 500
        }}>
          {achieved 
            ? `🎉 Obiettivo raggiunto con ${fmt(totAct - totGoal, format)} in più!`
            : `📈 Mancano ${fmt(totGoal - totAct, format)} per raggiungere l'obiettivo`
          }
        </div>
      </div>
    </div>
  )
}

// ---------- BarChart Component ----------
function BarChart({ rows, field, format }: { 
  rows: MergedRow[], 
  field: keyof GoalsRow | 'appuntamenti', 
  format: 'int' | 'currency' 
}) {
  const W = Math.max(700, rows.length * 80)
  const H = 200
  const pad = { l: 50, r: 30, t: 30, b: 50 }
  const maxVal = Math.max(1, ...rows.map(r => Math.max(r.goal[field] || 0, r.actual[field] || 0)))
  const step = (W - pad.l - pad.r) / Math.max(1, rows.length)
  const barW = Math.max(16, step * 0.3)

  return (
    <div style={{ 
      overflowX: 'auto', 
      background: '#fafafa',
      borderRadius: 8,
      padding: 16
    }}>
      <svg width={W} height={H}>
        {/* Asse X */}
        <line 
          x1={pad.l} 
          y1={H - pad.b} 
          x2={W - pad.r} 
          y2={H - pad.b} 
          stroke="#d1d5db" 
          strokeWidth={2}
        />
        
        {/* Griglia orizzontale */}
        {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
          const y = H - pad.b - (ratio * (H - pad.b - pad.t))
          return (
            <g key={ratio}>
              <line 
                x1={pad.l} 
                y1={y} 
                x2={W - pad.r} 
                y2={y} 
                stroke="#e5e7eb" 
                strokeDasharray="4,4"
              />
              <text 
                x={pad.l - 8} 
                y={y + 4} 
                fontSize={11} 
                textAnchor="end" 
                fill="#9ca3af"
              >
                {fmt(maxVal * ratio, format)}
              </text>
            </g>
          )
        })}

        {/* Barre */}
        {rows.map((r, i) => {
          const x = pad.l + i * step + step / 2 - barW - 3
          const gVal = r.goal[field] || 0
          const aVal = r.actual[field] || 0
          const gH = (gVal / maxVal) * (H - pad.b - pad.t)
          const aH = (aVal / maxVal) * (H - pad.b - pad.t)
          const baseY = H - pad.b

          return (
            <g key={i}>
              {/* Barra obiettivo */}
              <rect 
                x={x} 
                y={baseY - gH} 
                width={barW} 
                height={Math.max(2, gH)}
                fill="#e5e7eb" 
                rx={4}
              />
              
              {/* Barra realizzato */}
              <rect 
                x={x + barW + 6} 
                y={baseY - aH} 
                width={barW} 
                height={Math.max(2, aH)}
                fill="#3b82f6" 
                rx={4}
              />

              {/* Etichetta mese */}
              <text 
                x={x + barW + 3} 
                y={H - 20} 
                fontSize={12} 
                fontWeight={600}
                textAnchor="middle"
                fill="#374151"
              >
                {r.label}
              </text>

              {/* Valori sopra le barre */}
              {gH > 20 && (
                <text 
                  x={x + barW / 2} 
                  y={baseY - gH - 6} 
                  fontSize={10} 
                  textAnchor="middle" 
                  fill="#6b7280"
                  fontWeight={600}
                >
                  {fmt(gVal, format)}
                </text>
              )}
              {aH > 20 && (
                <text 
                  x={x + barW + 6 + barW / 2} 
                  y={baseY - aH - 6} 
                  fontSize={10} 
                  textAnchor="middle" 
                  fill="#1e40af"
                  fontWeight={600}
                >
                  {fmt(aVal, format)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ---------- PeriodTargetBar Component ----------
function PeriodTargetBar({ totalGoal, totalActual, achieved }: { 
  totalGoal: number
  totalActual: number
  achieved: boolean
}) {
  const max = Math.max(totalGoal, totalActual, 1)
  const goalPct = (totalGoal / max) * 100
  const actPct = (totalActual / max) * 100

  return (
    <div style={{ position: 'relative', height: 32 }}>
      {/* Barra background (obiettivo) */}
      <div style={{
        position: 'absolute',
        top: 8,
        left: 0,
        width: `${goalPct}%`,
        height: 16,
        background: '#e5e7eb',
        borderRadius: 8,
        transition: 'width 0.3s ease'
      }} />
      
      {/* Barra progresso (realizzato) */}
      <div style={{
        position: 'absolute',
        top: 8,
        left: 0,
        width: `${actPct}%`,
        height: 16,
        background: achieved 
          ? 'linear-gradient(90deg, #22c55e 0%, #16a34a 100%)'
          : 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)',
        borderRadius: 8,
        transition: 'width 0.3s ease',
        boxShadow: achieved 
          ? '0 2px 8px rgba(34, 197, 94, 0.3)'
          : '0 2px 8px rgba(245, 158, 11, 0.3)'
      }} />

      {/* Marker obiettivo */}
      {actPct !== goalPct && (
        <div style={{
          position: 'absolute',
          top: 4,
          left: `${goalPct}%`,
          width: 2,
          height: 24,
          background: '#9ca3af',
          transform: 'translateX(-1px)'
        }} />
      )}
    </div>
  )
}

// ---------- Helper Functions ----------
function fmt(v: number, mode: 'int' | 'currency') {
  if (mode === 'int') return String(Math.round(v || 0))
  try {
    return new Intl.NumberFormat('it-IT', { 
      style: 'currency', 
      currency: 'EUR', 
      maximumFractionDigits: 0 
    }).format(v || 0)
  } catch {
    return String(v || 0)
  }
}

type YM = { y: number, m: number }
type MergedRow = {
  y: number
  m: number
  label: string
  goal: Record<keyof GoalsRow | 'appuntamenti', number>
  actual: Record<keyof GoalsRow | 'appuntamenti', number>
}

function toMonthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function addMonths(d: Date, delta: number) {
  const dd = new Date(d.getTime())
  dd.setMonth(dd.getMonth() + delta)
  return dd
}

function monthRange(fromKey: string, toKey: string): YM[] {
  const [fy, fm] = fromKey.split('-').map(n => parseInt(n, 10))
  const [ty, tm] = toKey.split('-').map(n => parseInt(n, 10))
  const out: YM[] = []
  let y = fy, m = fm
  while (y < ty || (y === ty && m <= tm)) {
    out.push({ y, m })
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

function mergeByMonth(
  goals: GoalsRow[],
  prog: ProgressRow[],
  fromKey: string,
  toKey: string,
  advisorUid: string,
  advisorId: string
): MergedRow[] {
  const rng = monthRange(fromKey, toKey)
  const key = (y: number, m: number) => `${y}-${m}`

  const goalRows = goals.filter(g => 
    g.advisor_user_id === advisorUid || g.advisor_id === advisorId
  )
  const progRows = prog.filter(a => 
    a.advisor_user_id === advisorUid || a.advisor_id === advisorId
  )

  const gmap = new Map<string, GoalsRow>()
  const amap = new Map<string, ProgressRow>()
  
  for (const g of goalRows) gmap.set(key(g.year, g.month), g)
  for (const a of progRows) amap.set(key(a.year, a.month), a)

  const metricFields: (keyof GoalsRow | 'appuntamenti')[] = [
    'appuntamenti', 'contratti', 'prod_danni', 
    'prod_vprot', 'prod_vpr', 'prod_vpu'
  ]

  const out: MergedRow[] = []
  for (const { y, m } of rng) {
    const g = gmap.get(key(y, m))
    const a = amap.get(key(y, m))
    const row: MergedRow = {
      y,
      m,
      label: `${String(m).padStart(2, '0')}/${String(y).slice(2)}`,
      goal: {} as any,
      actual: {} as any
    }
    
    for (const f of metricFields) {
      const gv = f === 'appuntamenti' 
        ? (g?.consulenze ?? 0) 
        : ((g as any)?.[f] ?? 0)
      const av = f === 'appuntamenti' 
        ? (a?.appuntamenti ?? 0) 
        : ((a as any)?.[f] ?? 0)
      row.goal[f] = Number(gv) || 0
      row.actual[f] = Number(av) || 0
    }
    out.push(row)
  }
  return out
}
