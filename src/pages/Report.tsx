// src/pages/Report.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * Report — Andamento vs Obiettivi
 */

type Role = 'Admin' | 'Team Lead' | 'Junior'
type Me = { id: string; user_id: string; email: string; full_name: string | null; role: Role }
type AdvisorLite = { id: string; user_id: string; email: string; full_name: string | null }

/** Le metriche visualizzabili nei grafici/riquadri */
type MetricKey =
  | 'appuntamenti'
  | 'contratti'
  | 'prod_danni'
  | 'prod_vprot'
  | 'prod_vpr'
  | 'prod_vpu'

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

type MergedRow = {
  y: number
  m: number
  label: string
  goal: Partial<Record<MetricKey, number>>
  actual: Partial<Record<MetricKey, number>>
}

const box: React.CSSProperties = { background: 'var(--card, #fff)', border: '1px solid var(--border, #eee)', borderRadius: 16, padding: 16 }
const ipt: React.CSSProperties = { padding: '6px 10px', border: '1px solid var(--border, #ddd)', borderRadius: 8, background:'#fff', color:'var(--text, #111)' }
const small: React.CSSProperties = { fontSize: 12, color:'#666' }

function toMonthKey(d: Date){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` }
function addMonths(d: Date, delta: number){ return new Date(d.getFullYear(), d.getMonth()+delta, 1) }
function monthRange(fromKey: string, toKey: string){
  const [yf,mf] = fromKey.split('-').map(Number)
  const [yt,mt] = toKey.split('-').map(Number)
  const start = new Date(yf, mf-1, 1)
  const end   = new Date(yt, mt-1, 1)
  const out: { y:number; m:number }[] = []
  let cur = new Date(start)
  while (cur <= end){
    out.push({ y: cur.getFullYear(), m: cur.getMonth()+1 })
    cur = addMonths(cur, 1)
  }
  return out
}
function ymLabel(y:number,m:number){ return `${y}-${String(m).padStart(2,'0')}` }

export default function ReportPage(){
  const [me, setMe] = useState<Me | null>(null)
  const [advisors, setAdvisors] = useState<AdvisorLite[]>([])

  const today = new Date()
  const [fromKey, setFromKey] = useState(toMonthKey(addMonths(today, -5)))
  const [toKey, setToKey] = useState(toMonthKey(today))

  const [selUid, setSelUid] = useState('')   // advisor_user_id
  const [selAid, setSelAid] = useState('')   // advisors.id

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

      const meObj: Me = { id: meRow.id, user_id: meRow.user_id, email: meRow.email, full_name: meRow.full_name, role: meRow.role as Role }
      setMe(meObj)

      if (meObj.role === 'Admin' || meObj.role === 'Team Lead'){
        const { data: list, error: lerr } = await supabase
          .from('advisors')
          .select('id,user_id,email,full_name')
          .order('full_name', { ascending: true })
        if (lerr) throw lerr
        const arr = (list||[]).filter(a => a.user_id) as AdvisorLite[]
        setAdvisors(arr)
        setSelUid(meObj.user_id)
        setSelAid(meObj.id)
      } else {
        setAdvisors([])
        setSelUid(meObj.user_id)
        setSelAid(meObj.id)
      }
    } catch(ex:any){ setErr(ex.message || 'Errore bootstrap') }
    finally{ setLoading(false) }
  })() },[])

  useEffect(()=>{
    if (!selUid) return
    if (me && selUid === me.user_id) { setSelAid(me.id); return }
    const found = advisors.find(a => a.user_id === selUid)
    setSelAid(found?.id || '')
  }, [selUid, advisors, me?.id])

  useEffect(()=>{ (async()=>{
    if (!selUid) return
    setLoading(true); setErr('')
    try{
      const rng = monthRange(fromKey, toKey)
      const yrs = Array.from(new Set(rng.map(r=>r.y)))

      const goalsRes: GoalsRow[] = []
      for(const y of yrs){
        const months = rng.filter(r=>r.y===y).map(r=>r.m)
        const { data, error } = await supabase
          .from('v_goals_monthly')
          .select('*')
          .eq('year', y)
          .in('month', months)
        if (error) throw error
        goalsRes.push(...(data||[] as any[]))
      }
      setGoals(goalsRes)

      const progRes: ProgressRow[] = []
      for(const y of yrs){
        const months = rng.filter(r=>r.y===y).map(r=>r.m)
        const { data, error } = await supabase
          .from('v_progress_monthly')
          .select('*')
          .eq('year', y)
          .in('month', months)
        if (error) throw error
        progRes.push(...(data||[] as any[]))
      }

      const anyAppField = progRes.some(r => typeof r.appuntamenti !== 'undefined')
      if (!anyAppField){
        const monthKeys = rng.map(r=>ymLabel(r.y, r.m))
        const byMonth = await countAppointmentsByMonth(selUid, monthKeys)
        for(const row of progRes){
          const key = ymLabel(row.year, row.month)
          row.appuntamenti = byMonth.get(key) || 0
        }
      }

      setProg(progRes)
    } catch(ex:any){ setErr(ex.message || 'Errore caricamento dati') }
    finally{ setLoading(false) }
  })() },[selUid, fromKey, toKey])

  const rows = useMemo(
    ()=> mergeByMonth(goals, prog, fromKey, toKey, selUid, selAid),
    [goals, prog, fromKey, toKey, selUid, selAid]
  )

  return (
    <div style={{ display:'grid', gap:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
        <div style={{ fontSize:20, fontWeight:800 }}>Report — Andamento vs Obiettivi</div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <label style={small}>Dal</label>
          <input type="month" value={fromKey} onChange={e=>setFromKey(e.target.value)} style={ipt} />
          <label style={small}>al</label>
          <input type="month" value={toKey} onChange={e=>setToKey(e.target.value)} style={ipt} />

          {me && (me.role==='Admin' || me.role==='Team Lead') ? (
            <>
              <label style={small}>Advisor</label>
              <select
                value={selUid}
                onChange={e=>setSelUid(e.target.value)}
                style={ipt}
              >
                <option value={me.user_id}>— {me.full_name || me.email} (me)</option>
                {advisors
                  .filter(a=>a.user_id!==me.user_id)
                  .map(a=> (
                    <option key={a.user_id} value={a.user_id}>
                      {a.full_name || a.email}
                    </option>
                  ))}
              </select>
            </>
          ) : (
            <div style={small}>Advisor: solo me</div>
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

/* ---------------------- Conteggio appuntamenti (fallback) ---------------------- */
async function countAppointmentsByMonth(advisorUserId: string, monthKeys: string[]){
  const out = new Map<string, number>()
  if (!advisorUserId || monthKeys.length===0) return out

  const { data: leads } = await supabase
    .from('leads')
    .select('id')
    .eq('owner_id', advisorUserId)

  const leadIds = (leads||[]).map(l=>l.id)
  if (!leadIds.length){ monthKeys.forEach(k=>out.set(k,0)); return out }

  const years = Array.from(new Set(monthKeys.map(k=>Number(k.slice(0,4)))))
  const monthsByYear: Record<number, number[]> = {}
  for(const k of monthKeys){
    const y = Number(k.slice(0,4)), m = Number(k.slice(5,7))
    if (!monthsByYear[y]) monthsByYear[y] = []
    if (!monthsByYear[y].includes(m)) monthsByYear[y].push(m)
  }
  const minY = Math.min(...years), maxY = Math.max(...years)
  const minM = Math.min(...monthsByYear[minY]), maxM = Math.max(...monthsByYear[maxY])
  const startIso = new Date(minY, minM-1, 1).toISOString()
  const endIso   = new Date(maxY, maxM, 1).toISOString()

  const { data: apps } = await supabase
    .from('appointments')
    .select('ts,lead_id')
    .in('lead_id', leadIds)
    .gte('ts', startIso)
    .lt('ts', endIso)

  for(const k of monthKeys) out.set(k, 0)
  for(const a of (apps||[])){
    const d = new Date(a.ts)
    const k = ymLabel(d.getFullYear(), d.getMonth()+1)
    if (out.has(k)) out.set(k, (out.get(k)||0)+1)
  }
  return out
}

/* ---------------------- Merge Goals vs Actual ---------------------- */
function mergeByMonth(
  goals: GoalsRow[],
  progress: ProgressRow[],
  fromKey: string,
  toKey: string,
  advisor_user_id: string,
  advisor_id: string
): MergedRow[] {
  const rng = monthRange(fromKey, toKey)
  const rows: MergedRow[] = rng.map(({y,m}) => ({
    y, m, label: ymLabel(y,m),
    goal:{}, actual:{}
  }))

  function matchByAdvisor(r: {advisor_user_id?:string; advisor_id?:string}){
    if (r.advisor_user_id && advisor_user_id) return r.advisor_user_id === advisor_user_id
    if (r.advisor_id && advisor_id) return r.advisor_id === advisor_id
    return false
    }

  // GOALS
  for(const g of goals){
    if (!matchByAdvisor(g)) continue
    const idx = rows.findIndex(r => r.y===g.year && r.m===g.month)
    if (idx<0) continue
    rows[idx].goal = {
      appuntamenti: g.consulenze || 0, // mapping "consulenze" → "appuntamenti"
      contratti: g.contratti || 0,
      prod_danni: g.prod_danni || 0,
      prod_vprot: g.prod_vprot || 0,
      prod_vpr:   g.prod_vpr   || 0,
      prod_vpu:   g.prod_vpu   || 0,
    }
  }

  // PROGRESS
  for(const p of progress){
    if (!matchByAdvisor(p)) continue
    const idx = rows.findIndex(r => r.y===p.year && r.m===p.month)
    if (idx<0) continue
    rows[idx].actual = {
      appuntamenti: p.appuntamenti || p.consulenze || 0,
      contratti: p.contratti || 0,
      prod_danni: p.prod_danni || 0,
      prod_vprot: p.prod_vprot || 0,
      prod_vpr:   p.prod_vpr   || 0,
      prod_vpu:   p.prod_vpu   || 0,
    }
  }

  return rows
}

/* ---------------------- Render helpers ---------------------- */
function fmt(n:number, type:'int'|'currency'){
  if (type==='currency') return new Intl.NumberFormat('it-IT',{ style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(n||0)
  return new Intl.NumberFormat('it-IT').format(Math.round(n||0))
}

function MetricCard({ title, field, rows, format }:{
  title:string,
  field: MetricKey,
  rows: MergedRow[],
  format:'int'|'currency'
}){
  const totGoal = rows.reduce((s,r)=> s + (r.goal[field]||0), 0)
  const totAct  = rows.reduce((s,r)=> s + (r.actual[field]||0), 0)
  const pct = totGoal>0 ? (totAct / totGoal) : 0
  const delta = totAct - totGoal

  return (
    <div style={{ ...box }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
        <div style={{ fontSize:16, fontWeight:700 }}>{title}</div>
        <div style={{ fontSize:14, minWidth:260, textAlign:'right' }}>
          <span style={{ color:'#666' }}>Totale periodo: </span>
          <b>{fmt(totAct, format)}</b>
          <span> / {fmt(totGoal, format)}</span>
          <span style={{ marginLeft:10, fontWeight:800, color: pct>=1? '#0a0':'#a60' }}>
            {(pct*100).toFixed(0)}%
          </span>
        </div>
      </div>

      <BarChart rows={rows} field={field} format={format} />

      <div style={{ marginTop:12, display:'grid', gap:6 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:12, color:'#666' }}>Obiettivo periodo</div>
          <div style={{ fontSize:14 }}>
            <strong>{fmt(totGoal, format)}</strong>
            <span style={{ marginLeft:8, color: delta>=0 ? '#0a0' : '#c00' }}>
              {delta>=0 ? `(+${fmt(delta, format)} vs goal)` : `(${fmt(delta, format)} vs goal)`}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------------------- BarChart ---------------------- */
function BarChart({ rows, field, format }:{
  rows: MergedRow[],
  field: MetricKey,
  format: 'int'|'currency'
}){
  const values = rows.flatMap(r => [r.actual[field]||0, r.goal[field]||0])
  const max = Math.max(1, ...values)
  const H = 160
  const barW = 22
  const gap = 14
  const groupGap = 18
  const leftPad = 40
  const rightPad = 12
  const width = leftPad + rightPad + rows.length * (barW*2 + gap + groupGap)

  function y(v:number){ return H - Math.round((v/max) * (H-24)) }

  return (
    <div style={{ overflowX:'auto' }}>
      <svg width={Math.max(width, 560)} height={H+28} role="img" aria-label="BarChart">
        <text x={0} y={y(0)} fontSize="10" fill="#666">0</text>
        <text x={0} y={y(max)} fontSize="10" fill="#666">{fmt(max, format)}</text>

        {rows.map((r, i) => {
          const x0 = leftPad + i * (barW*2 + gap + groupGap)
          const a  = r.actual[field]||0
          const g  = r.goal[field]||0
          const yA = y(a), yG = y(g)
          const hA = H - yA, hG = H - yG
          return (
            <g key={r.label}>
              <text x={x0 + barW + gap/2} y={H+20} textAnchor="middle" fontSize="10" fill="#0f172a">{r.label}</text>

              <rect x={x0} y={yA} width={barW} height={hA} fill="#0b57d0" opacity="0.9" />
              <text x={x0 + barW/2} y={yA-4} textAnchor="middle" fontSize="10" fill="#0f172a">
                {a ? fmt(a, format) : ''}
              </text>

              <rect x={x0+barW+gap} y={yG} width={barW} height={hG} fill="#94a3b8" />
              <text x={x0 + barW+gap + barW/2} y={yG-4} textAnchor="middle" fontSize="10" fill="#334155">
                {g ? fmt(g, format) : ''}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
