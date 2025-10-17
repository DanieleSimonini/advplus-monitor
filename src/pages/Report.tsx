// src/pages/Report.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

type Role = 'Admin' | 'Team Lead' | 'Junior'
type Me = { id: string; user_id: string; email: string; full_name: string | null; role: Role }
type AdvisorLite = { id: string; user_id: string; email: string; full_name: string | null }

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
  appuntamenti?: number // calcolato se assente
}

/* ===== UI ===== */
const box: React.CSSProperties = { background:'var(--card, #fff)', border:'1px solid var(--border, #eee)', borderRadius:16, padding:16 }
const ipt: React.CSSProperties = { padding:'6px 10px', border:'1px solid var(--border, #ddd)', borderRadius:8, background:'#fff', color:'var(--text, #111)' }

/* ===== Utils data/periodo ===== */
function toMonthKey(d: Date){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` }
function addMonths(d: Date, delta: number){ return new Date(d.getFullYear(), d.getMonth()+delta, 1) }
function monthRange(fromKey: string, toKey: string){
  const [fy,fm] = fromKey.split('-').map(Number)
  const [ty,tm] = toKey.split('-').map(Number)
  const out: { y:number, m:number }[] = []
  const start = new Date(fy, fm-1, 1)
  const end = new Date(ty, tm-1, 1)
  for (let cur = new Date(start); cur <= end; cur = addMonths(cur, 1)){
    out.push({ y: cur.getFullYear(), m: cur.getMonth()+1 })
  }
  return out
}
function fmt(n:number, type:'int'|'currency'){
  if (type==='int') return new Intl.NumberFormat('it-IT').format(n||0)
  return new Intl.NumberFormat('it-IT',{ style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(n||0)
}

/* ===== Merge goals + progress filtrando advisor selezionato ===== */
type MergedRow = {
  year:number; month:number; key:string;
  goal: Record<string, number>;
  actual: Record<string, number>;
}
function sameAdvisor(r:{advisor_user_id?:string, advisor_id?:string}, selUid:string, selAid:string){
  // compatibilità viste: alcune espondono advisor_user_id (auth uid), altre advisor_id (pk advisors)
  return (r.advisor_user_id && r.advisor_user_id===selUid)
      || (r.advisor_id && r.advisor_id===selAid)
}
function mergeByMonth(
  goals: GoalsRow[],
  prog: ProgressRow[],
  fromKey: string,
  toKey: string,
  selUid: string,
  selAid: string
): MergedRow[] {
  const rng = monthRange(fromKey, toKey)
  const rows: MergedRow[] = []

  for (const { y, m } of rng){
    const g = goals.find(r => r.year===y && r.month===m && sameAdvisor(r, selUid, selAid)) || {}
    const p = prog .find(r => r.year===y && r.month===m && sameAdvisor(r, selUid, selAid)) || {}

    const goal = {
      appuntamenti: Number((g as any).consulenze||0),
      contratti: Number((g as any).contratti||0),
      prod_danni: Number((g as any).prod_danni||0),
      prod_vprot: Number((g as any).prod_vprot||0),
      prod_vpr  : Number((g as any).prod_vpr||0),
      prod_vpu  : Number((g as any).prod_vpu||0),
    }
    const actual = {
      appuntamenti: Number((p as any).appuntamenti||0),
      contratti: Number((p as any).contratti||0),
      prod_danni: Number((p as any).prod_danni||0),
      prod_vprot: Number((p as any).prod_vprot||0),
      prod_vpr  : Number((p as any).prod_vpr||0),
      prod_vpu  : Number((p as any).prod_vpu||0),
    }

    rows.push({ year:y, month:m, key:`${y}-${String(m).padStart(2,'0')}`, goal, actual })
  }
  return rows
}

/* ===== Conteggio appuntamenti per mese (fallback) ===== */
async function countAppointmentsByMonth(selUid: string, monthKeys: string[]){
  // prendo tutti i lead dell'advisor selezionato
  const { data: leads } = await supabase.from('leads').select('id').eq('owner_id', selUid)
  const leadIds = (leads||[]).map(l=>l.id)
  const map = new Map<string, number>()
  if (!leadIds.length){ monthKeys.forEach(k=>map.set(k,0)); return map }

  // scarico appuntamenti nell’intervallo coperto dai monthKeys e raggruppo client-side
  const first = monthKeys[0]
  const last  = monthKeys[monthKeys.length-1]
  const [fy,fm] = first.split('-').map(Number)
  const [ly,lm] = last .split('-').map(Number)
  const startIso = new Date(fy, fm-1, 1).toISOString()
  const endIso   = new Date(ly, lm   , 1).toISOString() // esclusivo

  const { data: apps } = await supabase
    .from('appointments')
    .select('id, ts, lead_id')
    .in('lead_id', leadIds)
    .gte('ts', startIso)
    .lt('ts', endIso)

  for (const k of monthKeys) map.set(k, 0)
  for (const a of (apps||[])){
    const d = new Date(a.ts)
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
    if (map.has(key)) map.set(key, (map.get(key)||0) + 1)
  }
  return map
}

/* ====== Pagina ====== */
export default function ReportPage(){
  const [me, setMe] = useState<Me | null>(null)
  const [advisors, setAdvisors] = useState<AdvisorLite[]>([])

  const today = new Date()
  const [fromKey, setFromKey] = useState(toMonthKey(addMonths(today, -5)))
  const [toKey, setToKey] = useState(toMonthKey(today))

  // Advisor selezionato (uid auth + id advisors)
  const [selUid, setSelUid] = useState('')   // advisor_user_id scelto
  const [selAid, setSelAid] = useState('')   // advisor_id (tabella advisors) del selezionato

  const [goals, setGoals] = useState<GoalsRow[]>([])
  const [prog, setProg] = useState<ProgressRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // Bootstrap profilo + elenco advisors (con id + user_id)
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
        // default: me
        setSelUid(meObj.user_id)
        setSelAid(meObj.id)
      } else {
        // Junior → solo sé stesso
        setAdvisors([])
        setSelUid(meObj.user_id)
        setSelAid(meObj.id)
      }
    } catch(ex:any){ setErr(ex.message || 'Errore bootstrap') }
    finally{ setLoading(false) }
  })() },[])

  // quando cambia l'UID selezionato, aggiorno anche l'advisor_id coerente
  useEffect(()=>{
    if (!selUid) return
    if (me && selUid === me.user_id) { setSelAid(me.id); return }
    const found = advisors.find(a => a.user_id === selUid)
    setSelAid(found?.id || '')
  }, [selUid, advisors, me?.id])

  // Caricamento dati per range + advisor selezionato
  useEffect(()=>{ (async()=>{
    if (!selUid) return
    setLoading(true); setErr('')
    try{
      const rng = monthRange(fromKey, toKey)
      const yrs = Array.from(new Set(rng.map(r=>r.y)))

      // GOALS: carico per gli anni coinvolti, filtro client-side sul selezionato
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

      // PROGRESS: idem
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

      // se la vista non espone 'appuntamenti' → calcolo su tabella appointments
      const anyAppField = progRes.some(r => typeof r.appuntamenti !== 'undefined')
      if (!anyAppField){
        const monthKeys = rng.map(r=>`${r.y}-${String(r.m).padStart(2,'0')}`)
        const byMonth = await countAppointmentsByMonth(selUid, monthKeys)
        for(const row of progRes){
          const key = `${row.year}-${String(row.month).padStart(2,'0')}`
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
      {/* Header + filtri */}
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
              <select
                value={selUid}
                onChange={e=>setSelUid(e.target.value)}
                style={ipt}
              >
                {/* Me sempre in cima */}
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
            <div style={{ fontSize:12, color:'#666' }}>Advisor: solo me</div>
          )}
        </div>
      </div>

      {err && <div style={{ ...box, color:'#c00' }}>{err}</div>}

      {/* KPI/Grafici */}
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

/* ====== Render helpers ====== */

function MetricCard({ title, field, rows, format }:{
  title:string,
  field: keyof GoalsRow | 'appuntamenti',
  rows: MergedRow[],
  format:'int'|'currency'
}){
  const totGoal = rows.reduce((s,r)=> s + (r.goal[field]||0), 0)
  const totAct  = rows.reduce((s,r)=> s + (r.actual[field]||0), 0)
  const pct = totGoal>0 ? (totAct / totGoal) : 0

  return (
    <div style={{ ...box }}>
      {/* Header con Totale periodo ben visibile */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
        <div style={{ fontSize:16, fontWeight:700 }}>{title}</div>
        <div style={{ fontSize:14, minWidth:220, textAlign:'right' }}>
          <span style={{ color:'#666' }}>Totale periodo: </span>
          <b>{fmt(totAct, format)}</b>
          <span> / {fmt(totGoal, format)}</span>
          <span style={{ marginLeft:10, fontWeight:800, color: pct>=1? '#0a0':'#a60' }}>
            {(pct*100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Grafico mensile: Goal vs Actual */}
      <BarChart rows={rows} field={field} format={format} />

      {/* Obiettivo di periodo (layout anti-sovrapposizione) */}
      <div style={{ marginTop:12, display:'grid', gap:6 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:12, color:'#666' }}>Obiettivo di periodo</div>
          <div style={{ fontSize:12, color:'#666' }}>{fmt(totAct, format)} / {fmt(totGoal, format)}</div>
        </div>
        <div style={{ height:8, borderRadius:999, background:'#eef2f7', overflow:'hidden' }}>
          <div style={{
            width: `${Math.min(100, Math.round((pct||0)*100))}%`,
            height:'100%',
            background: 'linear-gradient(90deg, #0b57d0, #26c2a9)'
          }} />
        </div>
      </div>
    </div>
  )
}

function BarChart({ rows, field, format }:{
  rows: MergedRow[],
  field: keyof GoalsRow | 'appuntamenti',
  format:'int'|'currency'
}){
  // chart semplice (no lib): colonne affiancate Goal/Actual
  const max = Math.max(1, ...rows.map(r => Math.max(r.goal[field]||0, r.actual[field]||0)))
  const H = 180
  const padX = 12
  const colW = 22
  const gap = 12
  const totalW = rows.length * (colW*2 + gap) + padX*2

  return (
    <svg width="100%" viewBox={`0 0 ${totalW} ${H+30}`} role="img" aria-label={`${String(field)} mensile`}>
      {/* assi */}
      <line x1={padX} y1={H} x2={totalW-padX} y2={H} stroke="#e5e7eb" />
      {rows.map((r, i) => {
        const x0 = padX + i*(colW*2+gap)
        const g = r.goal[field] || 0
        const a = r.actual[field] || 0
        const gh = Math.round((g / max) * (H-10))
        const ah = Math.round((a / max) * (H-10))
        const gx = x0
        const ax = x0 + colW

        return (
          <g key={r.key}>
            {/* Goal */}
            <rect x={gx} y={H-gh} width={colW} height={gh} fill="#e5e7eb" stroke="#cbd5e1" />
            {/* Actual */}
            <rect x={ax} y={H-ah} width={colW} height={ah} fill="#0b57d0" opacity={0.85} />
            {/* label mese */}
            <text x={x0 + colW} y={H+12} fontSize="10" textAnchor="middle" fill="#374151">{r.key.slice(2)}</text>
            {/* valori */}
            <text x={gx+colW/2} y={H-gh-4} fontSize="9" textAnchor="middle" fill="#64748b">{fmt(g, format)}</text>
            <text x={ax+colW/2} y={H-ah-4} fontSize="9" textAnchor="middle" fill="#0f172a">{fmt(a, format)}</text>
          </g>
        )
      })}
      {/* legenda */}
      <g transform={`translate(${totalW - 160}, 8)`}>
        <rect x={0} y={0} width={10} height={10} fill="#e5e7eb" stroke="#cbd5e1" />
        <text x={14} y={9} fontSize="11" fill="#374151">Goal</text>
        <rect x={64} y={0} width={10} height={10} fill="#0b57d0" opacity={0.85}/>
        <text x={78} y={9} fontSize="11" fill="#374151">Actual</text>
      </g>
    </svg>
  )
}
