
// ReportPage.tsx — Patch: etichette visibili + mirror a torta con percentuale >100% e testo verde al superamento
// Mantiene le funzionalità esistenti, legge gli obiettivi dalla pagina Obiettivi (tabella goals_monthly).

import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

type Role = 'Admin' | 'Team Lead' | 'Junior'
type Me = { id: string; user_id: string; email: string; full_name: string | null; role: Role }

type ProgressRow = {
  advisor_user_id: string
  year: number
  month: number
  consulenze: number
  contratti: number
  prod_danni: number
  prod_vprot: number
  prod_vpr: number
  prod_vpu: number
}

type GoalsRow = {
  advisor_user_id: string | 'TEAM'
  year: number
  month: number
  consulenze: number
  contratti: number
  prod_danni: number
  prod_vprot: number
  prod_vpr: number
  prod_vpu: number
}

const card: React.CSSProperties = {
  background: 'var(--card, #fff)',
  border: '1px solid var(--border,#e7e7e7)',
  borderRadius: 16,
  padding: 16,
  boxShadow: '0 0 0 rgba(0,0,0,0)'
}
const headerTitle: React.CSSProperties = { fontSize: 16, fontWeight: 700 }
const meta: React.CSSProperties = { fontSize: 12, color: '#667085' }
const input: React.CSSProperties = { padding: '8px 10px', border: '1px solid #D0D5DD', borderRadius: 10, background:'#fff' }

export default function ReportPage(){
  const [me, setMe] = useState<Me | null>(null)
  const [advisors, setAdvisors] = useState<{ user_id: string, email: string, full_name: string | null }[]>([])
  const today = new Date()
  const [fromKey, setFromKey] = useState(toMonthKey(addMonths(today, -5)))
  const [toKey, setToKey] = useState(toMonthKey(today))
  const [advisorUid, setAdvisorUid] = useState<string>('')
  const [myTeam, setMyTeam] = useState<boolean>(false)

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
      setAdvisorUid(uid)

      if (meRow.role === 'Admin' || meRow.role === 'Team Lead'){
        const { data: list, error: lerr } = await supabase
          .from('advisors')
          .select('user_id,email,full_name')
          .order('full_name', { ascending: true })
        if (lerr) throw lerr
        setAdvisors((list||[]).filter(x=>!!x.user_id) as any)
      }
    } catch(ex:any){ setErr(ex.message || 'Errore bootstrap') }
    finally{ setLoading(false) }
  })() },[])

  useEffect(()=>{ (async()=>{
    if (!advisorUid || !me) return
    setLoading(true); setErr('')
    try{
      const rng = monthRange(fromKey, toKey)
      const years = Array.from(new Set(rng.map(r=>r.y)))

      let scopeUserIds: string[] = [advisorUid]
      if (myTeam && (me.role==='Team Lead' || me.role==='Admin')) {
        const teamLead = me.role==='Admin' ? advisorUid : me.user_id
        const { data: team, error: teamErr } = await supabase
          .from('advisors')
          .select('user_id,team_lead_user_id')
          .or(`user_id.eq.${teamLead},team_lead_user_id.eq.${teamLead}`)
        if (teamErr) throw teamErr
        scopeUserIds = (team||[]).map(r=>r.user_id).filter(Boolean)
      }

      const progRows: ProgressRow[] = []
      for (const y of years){
        const months = rng.filter(r=>r.y===y).map(r=>r.m)
        const { data, error } = await supabase
          .from('v_progress_monthly')
          .select('advisor_user_id,year,month,consulenze,contratti,prod_danni,prod_vprot,prod_vpr,prod_vpu')
          .eq('year', y)
          .in('month', months)
          .in('advisor_user_id', scopeUserIds)
        if (error) throw error
        if (myTeam){
          const acc = groupSumByYM(data||[])
          progRows.push(...acc)
        } else {
          progRows.push(...(data||[]))
        }
      }
      setProg(progRows)

      const goalsRows = await loadGoalsMonthlyFromGoalsTable({ rng, years, scopeUserIds, isTeam: myTeam })
        .catch(async ()=> await loadGoalsMonthlyFromViews({ rng, years, scopeUserIds, isTeam: myTeam }))

      setGoals(goalsRows)
    } catch(ex:any){ setErr(ex.message || 'Errore caricamento dati') }
    finally{ setLoading(false) }
  })() }, [advisorUid, fromKey, toKey, myTeam, me])

  const rows = useMemo(()=> mergeByMonth(goals, prog, fromKey, toKey), [goals, prog, fromKey, toKey])
  const totals = useMemo(()=> aggregateTotals(rows), [rows])

  return (
    <div style={{ display:'grid', gap:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
        <div style={{ fontSize:20, fontWeight:800 }}>Report — Andamento vs Obiettivi</div>
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <label style={meta}>Dal</label>
          <input type="month" value={fromKey} onChange={e=>setFromKey(e.target.value)} style={input} />
          <label style={meta}>al</label>
          <input type="month" value={toKey} onChange={e=>setToKey(e.target.value)} style={input} />
          {me && (me.role==='Team Lead' || me.role==='Admin') && (
            <label style={{ display:'inline-flex', alignItems:'center', gap:8, ...meta }}>
              <input type="checkbox" checked={myTeam} onChange={e=>setMyTeam(e.target.checked)} />
              Tutto il Team
            </label>
          )}
          {me && (me.role==='Admin' || me.role==='Team Lead') ? (
            <>
              <label style={meta}>Advisor</label>
              <select value={advisorUid} onChange={e=>setAdvisorUid(e.target.value)} style={input}>
                {me && <option value={me.user_id}>— {me.full_name || me.email} (me)</option>}
                {advisors.filter(a=>a.user_id!==me?.user_id).map(a=> (
                  <option key={a.user_id} value={a.user_id}>{a.full_name || a.email}</option>
                ))}
              </select>
            </>
          ) : (
            <div style={meta}>Advisor: solo me</div>
          )}
        </div>
      </div>

      {err && <div style={{ ...card, color:'#c00' }}>{err}</div>}

      <div style={{
        display:'grid',
        gap:16,
        gridTemplateColumns: typeof window !== 'undefined' && window.innerWidth < 1024
          ? '1fr'
          : 'minmax(0,1.25fr) minmax(300px,0.75fr)'
      }}>
        <div style={{ display:'grid', gap:16 }}>
          <MetricCard title="Appuntamenti" field="consulenze" rows={rows} format="int" />
          <MetricCard title="Contratti" field="contratti" rows={rows} format="int" />
          <MetricCard title="Produzione Danni Non Auto" field="prod_danni" rows={rows} format="currency" />
          <MetricCard title="Vita Protection" field="prod_vprot" rows={rows} format="currency" />
          <MetricCard title="Vita Premi Ricorrenti" field="prod_vpr" rows={rows} format="currency" />
          <MetricCard title="Vita Premi Unici" field="prod_vpu" rows={rows} format="currency" />
        </div>
        <div style={{ display:'grid', gap:16, alignContent:'start' }}>
          <MirrorCard title="Appuntamenti" goal={totals.goal.consulenze} actual={totals.actual.consulenze} format="int" />
          <MirrorCard title="Contratti" goal={totals.goal.contratti} actual={totals.actual.contratti} format="int" />
          <MirrorCard title="Danni Non Auto" goal={totals.goal.prod_danni} actual={totals.actual.prod_danni} format="currency" />
          <MirrorCard title="Vita Protection" goal={totals.goal.prod_vprot} actual={totals.actual.prod_vprot} format="currency" />
          <MirrorCard title="Vita Premi Ricorrenti" goal={totals.goal.prod_vpr} actual={totals.actual.prod_vpr} format="currency" />
          <MirrorCard title="Vita Premi Unici" goal={totals.goal.prod_vpu} actual={totals.actual.prod_vpu} format="currency" />
        </div>
      </div>

      {loading && <div style={{ color:'#666' }}>Caricamento…</div>}
    </div>
  )
}

function MetricCard({
  title, field, rows, format
}:{ title:string, field: keyof GoalsRow, rows: MergedRow[], format:'int'|'currency' }){
  const totGoal = rows.reduce((s,r)=> s + (r.goal[field]||0), 0)
  const totAct  = rows.reduce((s,r)=> s + (r.actual[field]||0), 0)
  const pct = totGoal>0 ? (totAct / totGoal) : 0

  return (
    <div style={{ ...card, minHeight: 220, display:'grid', gap:10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
        <div style={headerTitle}>{title}</div>
        <div style={{ fontSize:14 }}>
          <b>{fmt(totAct, format)}</b> / {fmt(totGoal, format)}
          <span style={{
            marginLeft:8,
            color: pct>=1 ? '#067647' : pct>=0.7 ? '#B54708' : '#B42318',
            fontWeight: 700
          }}>{(pct*100).toFixed(0)}%</span>
        </div>
      </div>
      <Bars rows={rows} field={field} format={format} />
    </div>
  )
}

// ⇩⇩⇩ PATCH: padding superiore aumentato e label spostate più in alto
function Bars({ rows, field, format }:{ rows:MergedRow[], field:keyof GoalsRow, format:'int'|'currency' }){
  const W = Math.max(640, rows.length*64)
  const H = 180 // era 160
  const pad = { l:40, r:20, t:30, b:30 } // t era 10 → ora 30 per lasciare spazio alle etichette
  const maxVal = Math.max(1, ...rows.map(r => Math.max(r.goal[field]||0, r.actual[field]||0)))
  const step = (W - pad.l - pad.r) / Math.max(1, rows.length)
  const barW = Math.max(16, step*0.36)

  return (
    <div style={{ overflowX:'auto' }}>
      <svg width={W} height={H}>
        <line x1={pad.l} y1={H-pad.b} x2={W-pad.r} y2={H-pad.b} stroke="#EAECF0" />
        {rows.map((r, i) => {
          const x = pad.l + i*step + 8
          const gVal = r.goal[field]||0
          const aVal = r.actual[field]||0
          const gH = (gVal/maxVal) * (H - pad.b - pad.t)
          const aH = (aVal/maxVal) * (H - pad.b - pad.t)
          const baseY = H - pad.b
          return (
            <g key={i}>
              <rect x={x} y={baseY - gH} width={barW} height={gH} fill="#EEF2F6" rx="6" />
              <rect x={x + barW + 6} y={baseY - aH} width={barW} height={aH} fill="#98A2B3" rx="6" />
              <text x={x + barW} y={H-10} fontSize={11} textAnchor="middle" fill="#667085">{r.label}</text>
              {/* etichette alzate per evitare tagli */}
              <text x={x + barW/2} y={baseY - gH - 8} fontSize={10} textAnchor="middle" fill="#667085">{fmt(gVal, format)}</text>
              <text x={x + barW + 6 + barW/2} y={baseY - aH - 8} fontSize={10} textAnchor="middle" fill="#111827">{fmt(aVal, format)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ⇩⇩⇩ PATCH: mirror trasformato in grafico a torta (progressivo) con percentuale >100% e testo verde al superamento
function MirrorCard({ title, goal, actual, format }:{ title:string, goal:number, actual:number, format:'int'|'currency' }){
  const pctRaw = goal>0 ? (actual/goal)*100 : 0
  const pctDisplay = Math.round(pctRaw*10)/10 // può superare 100
  const HColor = pctRaw>=100? '#067647' : pctRaw>=70? '#B54708' : '#B42318'

  // configurazione pie
  const size = 140
  const cx = size/2
  const cy = size/2
  const r = 46
  const strokeW = 12

  // arco visivo: massimo 360°, ma il numero centrale può superare 100%
  const angle = Math.min(360, (pctRaw / 100) * 360)
  const largeArc = angle > 180 ? 1 : 0
  const rad = (deg:number)=> (deg * Math.PI) / 180
  const x = cx + r * Math.sin(rad(angle))
  const y = cy - r * Math.cos(rad(angle))

  return (
    <div style={{ ...card, minHeight: 220, display:'grid', gap:10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
        <div style={headerTitle}>{title}</div>
        <div style={{ fontSize:13, fontWeight:700, color: HColor }}>{pctDisplay}%</div>
      </div>
      <div style={meta}>
        Attuale: <b>{fmt(actual, format)}</b> · Obiettivo: {fmt(goal, format)}
      </div>
      <div style={{ display:'grid', placeItems:'center', paddingTop:4, paddingBottom:8 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* background */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EEF2F6" strokeWidth={strokeW} />
          {/* progress: se >=100, anello completo; colore dell'arco verde quando superato */}
          {pctRaw >= 100 ? (
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#067647" strokeWidth={strokeW} />
          ) : (
            <path
              d={`M ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${x} ${y}`}
              stroke={HColor === '#067647' ? '#067647' : '#98A2B3'}
              strokeWidth={strokeW}
              fill="none"
            />
          )}
          {/* label percentuale al centro, verde quando >=100% */}
          <text x={cx} y={cy+4} textAnchor="middle" fontSize="16" fontWeight="bold" fill={HColor}>
            {pctDisplay}%
          </text>
        </svg>
      </div>
    </div>
  )
}

type YM = { y:number, m:number }
type MergedRow = {
  y: number
  m: number
  label: string
  goal: Record<keyof GoalsRow, number>
  actual: Record<keyof GoalsRow, number>
}

function mergeByMonth(goals: GoalsRow[], prog: ProgressRow[], fromKey:string, toKey:string): MergedRow[]{
  const rng = monthRange(fromKey, toKey)
  const k = (y:number,m:number)=> `${y}-${m}`
  const gmap = new Map<string, GoalsRow>()
  const amap = new Map<string, ProgressRow>()
  goals.forEach(g=>gmap.set(k(g.year,g.month), g))
  prog.forEach(a=>amap.set(k(a.year,a.month), a))
  const fields: (keyof GoalsRow)[] = ['advisor_user_id','year','month','consulenze','contratti','prod_danni','prod_vprot','prod_vpr','prod_vpu']
  const metrics: (keyof GoalsRow)[] = ['consulenze','contratti','prod_danni','prod_vprot','prod_vpr','prod_vpu']
  const out: MergedRow[] = []
  for(const {y,m} of rng){
    const g = gmap.get(k(y,m))
    const a = amap.get(k(y,m))
    const row: MergedRow = {
      y, m,
      label: `${String(m).padStart(2,'0')}/${String(y).slice(2)}`,
      goal: Object.fromEntries(fields.map(f=>[f, 0])) as any,
      actual: Object.fromEntries(fields.map(f=>[f, 0])) as any,
    }
    for(const f of metrics){
      row.goal[f] = (g as any)?.[f] || 0
      row.actual[f] = (a as any)?.[f] || 0
    }
    out.push(row)
  }
  return out
}

function aggregateTotals(rows: MergedRow[]){
  const sum = (f: keyof GoalsRow, kind:'goal'|'actual') => rows.reduce((s,r)=> s + (r[kind][f] || 0), 0)
  return {
    goal: {
      consulenze: sum('consulenze','goal'),
      contratti: sum('contratti','goal'),
      prod_danni: sum('prod_danni','goal'),
      prod_vprot: sum('prod_vprot','goal'),
      prod_vpr: sum('prod_vpr','goal'),
      prod_vpu: sum('prod_vpu','goal'),
    },
    actual: {
      consulenze: sum('consulenze','actual'),
      contratti: sum('contratti','actual'),
      prod_danni: sum('prod_danni','actual'),
      prod_vprot: sum('prod_vprot','actual'),
      prod_vpr: sum('prod_vpr','actual'),
      prod_vpu: sum('prod_vpu','actual'),
    }
  }
}

async function loadGoalsMonthlyFromGoalsTable({
  rng, years, scopeUserIds, isTeam
}:{ rng: YM[], years:number[], scopeUserIds:string[], isTeam:boolean }): Promise<GoalsRow[]>{
  const rows: GoalsRow[] = []
  for (const y of years){
    const months = rng.filter(r=>r.y===y).map(r=>r.m)
    const { data, error } = await supabase
      .from('goals_monthly')
      .select('advisor_user_id,year,month,target_consulenze,target_contratti,target_prod_danni,target_prod_vprot,target_prod_vpr,target_prod_vpu')
      .eq('year', y)
      .in('month', months)
      .in('advisor_user_id', scopeUserIds)
    if (error) throw error

    if (isTeam){
      const map = new Map<string, GoalsRow>()

      for(const g of (data||[])){
        const k = `${g.year}-${g.month}`
        const acc = map.get(k) || {
          advisor_user_id: 'TEAM',
          year: g.year, month: g.month,
          consulenze: 0, contratti: 0,
          prod_danni: 0, prod_vprot: 0, prod_vpr: 0, prod_vpu: 0
        }
        acc.consulenze += g.target_consulenze || 0
        acc.contratti  += g.target_contratti  || 0
        acc.prod_danni += g.target_prod_danni || 0
        acc.prod_vprot += g.target_prod_vprot || 0
        acc.prod_vpr   += g.target_prod_vpr   || 0
        acc.prod_vpu   += g.target_prod_vpu   || 0
        map.set(k, acc)
      }
      rows.push(...map.values())
    } else {
      rows.push(...(data||[]).map((g:any)=>({
        advisor_user_id: g.advisor_user_id,
        year: g.year,
        month: g.month,
        consulenze: g.target_consulenze || 0,
        contratti: g.target_contratti || 0,
        prod_danni: g.target_prod_danni || 0,
        prod_vprot: g.target_prod_vprot || 0,
        prod_vpr: g.target_prod_vpr || 0,
        prod_vpu: g.target_prod_vpu || 0,
      })))
    }
  }
  return rows
}

async function loadGoalsMonthlyFromViews({
  rng, years, scopeUserIds, isTeam
}:{ rng: YM[], years:number[], scopeUserIds:string[], isTeam:boolean }): Promise<GoalsRow[]>{
  const rows: GoalsRow[] = []
  for(const y of years){
    const months = rng.filter(r=>r.y===y).map(r=>r.m)
    if (isTeam){
      const { data, error } = await supabase
        .from('v_team_goals_monthly_sum')
        .select('year,month,consulenze,contratti,danni_non_auto,vita_protection,vita_ricorrenti,vita_unici')
        .eq('year', y)
        .in('month', months)
      if (error) throw error
      for(const r of (data||[])){
        rows.push({
          advisor_user_id: 'TEAM',
          year: r.year, month: r.month,
          consulenze: r.consulenze || 0,
          contratti: r.contratti || 0,
          prod_danni: r.danni_non_auto || 0,
          prod_vprot: r.vita_protection || 0,
          prod_vpr: r.vita_ricorrenti || 0,
          prod_vpu: r.vita_unici || 0,
        })
      }
    } else {
      const { data, error } = await supabase
        .from('v_goals_monthly')
        .select('advisor_user_id,year,month,consulenze,contratti,prod_danni,prod_vprot,prod_vpr,prod_vpu')
        .in('advisor_user_id', scopeUserIds.slice(0,1))
        .eq('year', y)
        .in('month', months)
      if (error) throw error
      rows.push(...(data||[]))
    }
  }
  return rows
}

function fmt(v:number, mode:'int'|'currency'){
  if (mode==='int') return String(Math.round(v||0))
  try{ return new Intl.NumberFormat('it-IT', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(v||0) }catch{ return String(v||0) }
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
function monthRange(fromKey:string, toKey:string): {y:number,m:number}[]{
  const [fy,fm] = fromKey.split('-').map(n=>parseInt(n,10))
  const [ty,tm] = toKey.split('-').map(n=>parseInt(n,10))
  const out: {y:number,m:number}[] = []
  let y=fy, m=fm
  while (y<ty || (y===ty && m<=tm)){
    out.push({ y, m })
    m++; if (m>12){ m=1; y++ }
  }
  return out
}

function groupSumByYM(data: any[]): ProgressRow[] {
  const byKey = new Map<string, ProgressRow>()
  const k = (y:number,m:number)=>`${y}-${m}`
  for(const r of data){
    const key = k(r.year, r.month)
    const acc = byKey.get(key) || {
      advisor_user_id: 'TEAM',
      year: r.year, month: r.month,
      consulenze: 0, contratti: 0, prod_danni: 0, prod_vprot: 0, prod_vpr: 0, prod_vpu: 0
    }
    acc.consulenze += r.consulenze || 0
    acc.contratti  += r.contratti  || 0
    acc.prod_danni += r.prod_danni || 0
    acc.prod_vprot += r.prod_vprot || 0
    acc.prod_vpr   += r.prod_vpr   || 0
    acc.prod_vpu   += r.prod_vpu   || 0
    byKey.set(key, acc)
  }
  return Array.from(byKey.values())
}
