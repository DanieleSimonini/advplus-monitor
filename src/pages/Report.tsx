// src/pages/Report.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

type Role = 'Admin' | 'Team Lead' | 'Junior'

type Me = { id: string; user_id: string; email: string; full_name: string | null; role: Role }

type GoalsRow = {
  advisor_user_id: string
  year: number
  month: number
  // target presenti in v_goals_monthly
  consulenze?: number
  contratti: number
  prod_danni: number
  prod_vprot: number
  prod_vpr: number
  prod_vpu: number
}

type ProgressRow = {
  advisor_user_id: string
  year: number
  month: number
  consulenze?: number
  contratti: number
  prod_danni: number
  prod_vprot: number
  prod_vpr: number
  prod_vpu: number
  // potrebbe NON esserci nella vista → lo calcoliamo noi
  appuntamenti?: number
}

const box: React.CSSProperties = { background: 'var(--card, #fff)', border: '1px solid var(--border, #eee)', borderRadius: 16, padding: 16 }
const ipt: React.CSSProperties = { padding: '6px 10px', border: '1px solid var(--border, #ddd)', borderRadius: 8, background:'#fff', color:'var(--text, #111)' }

export default function ReportPage(){
  const [me, setMe] = useState<Me | null>(null)
  const [advisors, setAdvisors] = useState<{ user_id: string, email: string, full_name: string | null }[]>([])

  const today = new Date()
  const defTo = toMonthKey(today)
  const defFrom = toMonthKey(addMonths(today, -5))
  const [fromKey, setFromKey] = useState<string>(defFrom)
  const [toKey, setToKey] = useState<string>(defTo)
  const [advisorUid, setAdvisorUid] = useState<string>('')

  const [goals, setGoals] = useState<GoalsRow[]>([])
  const [prog, setProg] = useState<ProgressRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(()=>{ (async()=>{
    setLoading(true); setErr('')
    try{
      const { data: auth } = await supabase.auth.getUser()
      const uid = auth.user?.id
      if (!uid){ setErr('Utente non autenticato'); setLoading(false); return }

      const { data: meRow, error: meErr } = await supabase
        .from('advisors')
        .select('id,user_id,email,full_name,role')
        .eq('user_id', uid)
        .maybeSingle()
      if (meErr) throw meErr
      if (!meRow){ setErr('Profilo non trovato'); setLoading(false); return }
      setMe({ id: meRow.id, user_id: meRow.user_id, email: meRow.email, full_name: meRow.full_name, role: meRow.role as Role })

      if (meRow.role === 'Admin' || meRow.role === 'Team Lead'){
        const { data: list, error: lerr } = await supabase
          .from('advisors')
          .select('user_id,email,full_name')
          .order('full_name', { ascending: true })
        if (lerr) throw lerr
        setAdvisors((list||[]).filter(x=>!!x.user_id) as any)
        setAdvisorUid(uid)
      } else {
        setAdvisors([])
        setAdvisorUid(uid)
      }
    } catch(ex:any){ setErr(ex.message || 'Errore bootstrap') }
    finally{ setLoading(false) }
  })() },[])

  useEffect(()=>{ (async()=>{
    if (!advisorUid) return
    setLoading(true); setErr('')
    try{
      const rng = monthRange(fromKey, toKey)
      const yrs = Array.from(new Set(rng.map(r=>r.y)))

      // === GOALS (NO 'appuntamenti' nella select) ===
      const goalsRes: GoalsRow[] = []
      for(const y of yrs){
        const months = rng.filter(r=>r.y===y).map(r=>r.m)
        const { data, error } = await supabase
          .from('v_goals_monthly')
          .select('advisor_user_id,year,month,consulenze,contratti,prod_danni,prod_vprot,prod_vpr,prod_vpu')
          .eq('advisor_user_id', advisorUid)
          .eq('year', y)
          .in('month', months)
        if (error) throw error
        goalsRes.push(...(data||[]))
      }
      setGoals(goalsRes)

      // === PROGRESS (NO 'appuntamenti' nella select) ===
      const progRes: ProgressRow[] = []
      for(const y of yrs){
        const months = rng.filter(r=>r.y===y).map(r=>r.m)
        const { data, error } = await supabase
          .from('v_progress_monthly')
          .select('advisor_user_id,year,month,consulenze,contratti,prod_danni,prod_vprot,prod_vpr,prod_vpu')
          .eq('advisor_user_id', advisorUid)
          .eq('year', y)
          .in('month', months)
        if (error) throw error
        progRes.push(...(data||[]))
      }

      // Se la vista non espone 'appuntamenti' → calcolo su tabella appointments
      const needsAppointments = progRes.every(r => typeof r.appuntamenti === 'undefined')
      if (needsAppointments){
        const monthKeys = rng.map(r=>`${r.y}-${String(r.m).padStart(2,'0')}`)
        const byMonth = await countAppointmentsByMonth(advisorUid, monthKeys)
        for(const row of progRes){
          const key = `${row.year}-${String(row.month).padStart(2,'0')}`
          row.appuntamenti = byMonth.get(key) || 0
        }
      }

      setProg(progRes)
    } catch(ex:any){ setErr(ex.message || 'Errore caricamento dati') }
    finally{ setLoading(false) }
  })() },[advisorUid, fromKey, toKey])

  const rows = useMemo(()=> mergeByMonth(goals, prog, fromKey, toKey), [goals, prog, fromKey, toKey])

  return (
    <div style={{ display:'grid', gap:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
        <div style={{ fontSize:20, fontWeight:800 }}>Report — Andamento vs Obiettivi</div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <label style={{ fontSize:12 }}>Dal</label>
          <input type="month" value={fromKey} onChange={e=>setFromKey(e.target.value)} style={ipt} />
          <label style={{ fontSize:12 }}>al</label>
          <input type="month" value={toKey} onChange={e=>setToKey(e.target.value)} style={ipt} />
          {me && (me.role==='Admin' || me.role==='Team Lead') ? (
            <>
              <label style={{ fontSize:12 }}>Advisor</label>
              <select value={advisorUid} onChange={e=>setAdvisorUid(e.target.value)} style={ipt}>
                <option value={me.user_id}>— {me.full_name || me.email} (me)</option>
                {advisors.filter(a=>a.user_id!==me.user_id).map(a=> (
                  <option key={a.user_id} value={a.user_id}>{a.full_name || a.email}</option>
                ))}
              </select>
            </>
          ) : (
            <div style={{ fontSize:12, color:'#666' }}>Advisor: solo me</div>
          )}
        </div>
      </div>

      {err && <div style={{ ...box, color:'#c00' }}>{err}</div>}

      <div style={{ display:'grid', gap:16 }}>
        <MetricCard title="Appuntamenti" field="appuntamenti" rows={rows} format="int" />
        <MetricCard title="Contratti" field="contratti" rows={rows} format="int" />
        <MetricCard title="Produzione Danni Non Auto" field="prod_danni" rows={rows} format="currency" />
        <MetricCard title="Vita Protection" field="prod_vprot" rows={rows} format="currency" />
        <MetricCard title="Vita Premi Ricorrenti" field="prod_vpr" rows={rows} format="currency" />
        <MetricCard title="Vita Premi Unici" field="prod_vpu" rows={rows} format="currency" />
      </div>

      {loading && <div style={{ color:'#666' }}>Caricamento...</div>}
    </div>
  )
}

// ===== Helpers render =====

function MetricCard({ title, field, rows, format }:{
  title:string,
  field: keyof GoalsRow | 'appuntamenti',
  rows: MergedRow[],
  format:'int'|'currency'
}){
  const data = rows
  const totGoal = data.reduce((s,r)=> s + (r.goal[field]||0), 0)
  const totAct  = data.reduce((s,r)=> s + (r.actual[field]||0), 0)
  const pct = totGoal>0 ? (totAct / totGoal) : 0
  return (
    <div style={{ ...box }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
        <div style={{ fontSize:16, fontWeight:700 }}>{title}</div>
        <div style={{ fontSize:14 }}>
          <b>{fmt(totAct, format)}</b> / {fmt(totGoal, format)}
          <span style={{ marginLeft:8, color: pct>=1? '#0a0':'#a60' }}>{(pct*100).toFixed(0)}%</span>
        </div>
      </div>
      <BarChart rows={data} field={field} format={format} />
      <div style={{ marginTop:10 }}>
        <PeriodTargetChart totalGoal={totGoal} totalActual={totAct} format={format} />
      </div>
    </div>
  )
}

function BarChart({ rows, field, format }:{ rows:MergedRow[], field:keyof GoalsRow|'appuntamenti', format:'int'|'currency' }){
  const W = Math.max(600, rows.length*60)
  const H = 160
  const pad = { l:40, r:20, t:10, b:30 }
  const maxVal = Math.max(1, ...rows.map(r => Math.max(r.goal[field]||0, r.actual[field]||0)))
  const step = (W - pad.l - pad.r) / Math.max(1, rows.length)
  const barW = Math.max(14, step*0.35)

  return (
    <div style={{ overflowX:'auto' }}>
      <svg width={W} height={H}>
        <line x1={pad.l} y1={H-pad.b} x2={W-pad.r} y2={H-pad.b} stroke="#ddd" />
        {rows.map((r, i) => {
          const x = pad.l + i*step + 8
          const gVal = r.goal[field]||0
          const aVal = r.actual[field]||0
          const gH = (gVal/maxVal) * (H - pad.b - pad.t)
          const aH = (aVal/maxVal) * (H - pad.b - pad.t)
          const baseY = H - pad.b
          return (
            <g key={i}>
              <rect x={x} y={baseY - gH} width={barW} height={gH} fill="#eaeaea" />
              <rect x={x + barW + 6} y={baseY - aH} width={barW} height={aH} fill="#888" />
              <text x={x + barW} y={H-10} fontSize={11} textAnchor="middle">{r.label}</text>
              <text x={x + barW/2} y={baseY - gH - 4} fontSize={10} textAnchor="middle" fill="#777">{fmt(gVal, format)}</text>
              <text x={x + barW + 6 + barW/2} y={baseY - aH - 4} fontSize={10} textAnchor="middle" fill="#333">{fmt(aVal, format)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function PeriodTargetChart({ totalGoal, totalActual, format }:{ totalGoal:number; totalActual:number; format:'int'|'currency' }){
  const W = 560, H = 38, pad = 4
  const max = Math.max(totalGoal, totalActual, 1)
  const goalW = Math.round((totalGoal/max) * (W - pad*2))
  const actW  = Math.round((totalActual/max) * (W - pad*2))
  const pct = totalGoal>0 ? Math.round((totalActual/totalGoal)*100) : 0
  return (
    <div>
      <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Obiettivo di periodo</div>
      <svg width={W} height={H} role="img" aria-label="Obiettivo di periodo">
        <rect x={pad} y={8} width={goalW} height={H-16} rx={6} ry={6} fill="#eaeaea" />
        <rect x={pad} y={8} width={actW} height={H-16} rx={6} ry={6} fill="#0b57d0" />
        <text x={pad} y={H-2} fontSize={11} fill="#666">Realizzato: {fmt(totalActual, format)}</text>
        <text x={W-pad} y={H-2} fontSize={11} fill="#666" textAnchor="end">Target: {fmt(totalGoal, format)} · {pct}%</text>
      </svg>
    </div>
  )
}

function fmt(v:number, mode:'int'|'currency'){
  if (mode==='int') return String(Math.round(v||0))
  try{ return new Intl.NumberFormat('it-IT', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(v||0) }catch{ return String(v||0) }
}

// ===== Merge/Date helpers =====

type YM = { y:number, m:number }

type MergedRow = {
  y: number
  m: number
  label: string
  goal: Record<keyof GoalsRow | 'appuntamenti', number>
  actual: Record<keyof GoalsRow | 'appuntamenti', number>
}

function toMonthKey(d: Date){
  const y = d.getFullYear()
  const m = d.getMonth()+1
  return `${y}-${String(m).padStart(2,'0')}`
}
function addMonths(d: Date, delta: number){
  const dd = new Date(d.getTime())
  dd.setMonth(dd.getMonth()+delta)
  return dd
}
function monthRange(fromKey:string, toKey:string): YM[]{
  const [fy,fm] = fromKey.split('-').map(n=>parseInt(n,10))
  const [ty,tm] = toKey.split('-').map(n=>parseInt(n,10))
  const out: YM[] = []
  let y=fy, m=fm
  while (y<ty || (y===ty && m<=tm)){
    out.push({ y, m })
    m++; if (m>12){ m=1; y++ }
  }
  return out
}
function monthStartEnd(y:number,m:number){
  const start = new Date(y, m-1, 1).toISOString()
  const end   = new Date(y, m,   1).toISOString()
  return { start, end }
}

function mergeByMonth(goals: GoalsRow[], prog: ProgressRow[], fromKey:string, toKey:string): MergedRow[]{
  const rng = monthRange(fromKey, toKey)
  const key = (y:number,m:number)=> `${y}-${m}`
  const gmap = new Map<string, GoalsRow>()
  const amap = new Map<string, ProgressRow>()
  for(const g of goals) gmap.set(key(g.year,g.month), g)
  for(const a of prog)  amap.set(key(a.year,a.month), a)

  const metricFields: (keyof GoalsRow | 'appuntamenti')[] = [
    'appuntamenti','contratti','prod_danni','prod_vprot','prod_vpr','prod_vpu'
  ]

  const out: MergedRow[] = []
  for(const {y,m} of rng){
    const g = gmap.get(key(y,m))
    const a = amap.get(key(y,m))
    const row: MergedRow = {
      y, m,
      label: `${String(m).padStart(2,'0')}/${String(y).slice(2)}`,
      goal: {} as any,
      actual: {} as any,
    }
    for(const f of metricFields){
      // Goal 'appuntamenti' deriva da 'consulenze' (se presente), altrimenti 0
      const gv =
        f === 'appuntamenti'
          ? ((g as any)?.consulenze ?? 0)
          : ((g as any)?.[f] ?? 0)

      // Actual 'appuntamenti' usa il valore calcolato a monte, se non c'è → 0
      const av =
        f === 'appuntamenti'
          ? ((a as any)?.appuntamenti ?? 0)
          : ((a as any)?.[f] ?? 0)

      row.goal[f] = gv || 0
      row.actual[f] = av || 0
    }
    out.push(row)
  }
  return out
}

// ===== Query helpers (Appuntamenti per mese) =====
async function countAppointmentsByMonth(advisor_user_id:string, monthKeys:string[]){
  const { data: leads, error: lerr } = await supabase
    .from('leads')
    .select('id')
    .eq('owner_id', advisor_user_id)
  if (lerr) throw lerr
  const leadIds = (leads||[]).map(l=>l.id)
  const map = new Map<string, number>()
  if (leadIds.length===0) { monthKeys.forEach(k=>map.set(k,0)); return map }

  for(const k of monthKeys){
    const [y,m] = k.split('-').map(Number)
    const { start, end } = monthStartEnd(y,m)
    const { count } = await supabase
      .from('appointments')
      .select('id', { count:'exact', head:true })
      .in('lead_id', leadIds)
      .gte('ts', start)
      .lt('ts', end)
    map.set(k, count||0)
  }
  return map
}
