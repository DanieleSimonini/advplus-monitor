// src/pages/Report.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * Report — Andamento vs Obiettivi
 * - "Nr. Consulenze" visualizzato come "Nr. Appuntamenti"
 * - Tipi corretti per evitare TS7053 quando si indicizza col campo 'appuntamenti'
 * - Se la vista progress non espone 'appuntamenti', li calcoliamo da appointments per mese
 */

type Role = 'Admin' | 'Team Lead' | 'Junior'
type Me = { id: string; user_id: string; email: string; full_name: string | null; role: Role }
type AdvisorLite = { id: string; user_id: string; email: string; full_name: string | null }

type GoalsRow = {
  advisor_user_id?: string
  advisor_id?: string
  year: number
  month: number
  // NOTE: in DB il target storico era "consulenze" (rinominato in UI come Appuntamenti)
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
  // alcuni ambienti espongono 'consulenze', altri direttamente 'appuntamenti'
  consulenze?: number
  contratti?: number
  prod_danni?: number
  prod_vprot?: number
  prod_vpr?: number
  prod_vpu?: number
  appuntamenti?: number // calcolato se assente
}

// Campi metrica supportati (goal/actual).
// NOTA: 'appuntamenti' NON è in GoalsRow come chiave TypeScript, perciò lo teniamo separato.
type MetricField =
  | 'appuntamenti'
  | 'contratti'
  | 'prod_danni'
  | 'prod_vprot'
  | 'prod_vpr'
  | 'prod_vpu'

type MergedRow = {
  year: number
  month: number
  key: string // YYYY-MM
  goal: Record<MetricField, number>
  actual: Record<MetricField, number>
}

const box: React.CSSProperties = { background: 'var(--card, #fff)', border: '1px solid var(--border, #eee)', borderRadius: 16, padding: 16 }
const ipt: React.CSSProperties = { padding: '6px 10px', border: '1px solid var(--border, #ddd)', borderRadius: 8, background:'#fff', color:'var(--text, #111)' }

/* ========== Utils data/tempo ========== */
function toMonthKey(d: Date){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` }
function addMonths(d: Date, delta: number){ return new Date(d.getFullYear(), d.getMonth()+delta, 1) }
function monthRange(fromKey: string, toKey: string){
  const [fy,fm] = fromKey.split('-').map(Number)
  const [ty,tm] = toKey.split('-').map(Number)
  const start = new Date(fy, fm-1, 1)
  const end   = new Date(ty, tm-1, 1)
  const out: { y:number, m:number }[] = []
  let cur = new Date(start)
  while (cur <= end){
    out.push({ y: cur.getFullYear(), m: cur.getMonth()+1 })
    cur = addMonths(cur, 1)
  }
  return out
}

/* ========== Query helpers ========== */
async function countAppointmentsByMonth(advisorUserId: string, monthKeys: string[]){
  // Conta appuntamenti per mese su tutti i lead di owner_id = advisorUserId
  const map = new Map<string, number>()
  if (!advisorUserId || monthKeys.length===0) return map

  // Trova i lead dell'advisor
  const { data: leads } = await supabase
    .from('leads')
    .select('id')
    .eq('owner_id', advisorUserId)

  const leadIds = (leads||[]).map(l=>l.id)
  if (!leadIds.length) return map

  // Per comodità calcolo su una finestra ampia, poi raggruppo client-side
  const first = monthKeys[0]
  const last  = monthKeys[monthKeys.length-1]
  const [fy,fm] = first.split('-').map(Number)
  const [ty,tm] = last.split('-').map(Number)
  const startIso = new Date(fy, fm-1, 1).toISOString()
  const endIso   = new Date(ty, tm,   1).toISOString()

  const { data: apps } = await supabase
    .from('appointments')
    .select('id, lead_id, ts')
    .in('lead_id', leadIds)
    .gte('ts', startIso)
    .lt('ts', endIso)

  for(const a of (apps||[])){
    const dt = new Date(a.ts)
    const k = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`
    map.set(k, (map.get(k)||0)+1)
  }
  return map
}

/* ========== Merge goals+progress ========== */
function emptyMetricRecord(): Record<MetricField, number>{
  return { appuntamenti:0, contratti:0, prod_danni:0, prod_vprot:0, prod_vpr:0, prod_vpu:0 }
}
function mergeByMonth(
  goals: GoalsRow[],
  prog: ProgressRow[],
  fromKey: string,
  toKey: string,
  selUid: string,
  selAid: string
): MergedRow[]{
  const rng = monthRange(fromKey, toKey)
  const rows: MergedRow[] = []
  for(const {y,m} of rng){
    const key = `${y}-${String(m).padStart(2,'0')}`
    const g = goals.filter(r => r.year===y && r.month===m && ((r.advisor_user_id && r.advisor_user_id===selUid) || (r.advisor_id && r.advisor_id===selAid)))
    const p = prog.filter(r => r.year===y && r.month===m && ((r.advisor_user_id && r.advisor_user_id===selUid) || (r.advisor_id && r.advisor_id===selAid)))

    const goalRec = emptyMetricRecord()
    const actRec  = emptyMetricRecord()

    // GOAL: consulenze = appuntamenti (solo UI rename)
    const gRow = g[0]
    if (gRow){
      goalRec.appuntamenti = Number(gRow.consulenze||0)
      goalRec.contratti    = Number(gRow.contratti||0)
      goalRec.prod_danni   = Number(gRow.prod_danni||0)
      goalRec.prod_vprot   = Number(gRow.prod_vprot||0)
      goalRec.prod_vpr     = Number(gRow.prod_vpr||0)
      goalRec.prod_vpu     = Number(gRow.prod_vpu||0)
    }

    // ACTUAL: usa 'appuntamenti' se esiste; altrimenti 'consulenze'
    const pRow = p[0]
    if (pRow){
      actRec.appuntamenti = Number(
        typeof pRow.appuntamenti !== 'undefined'
          ? pRow.appuntamenti
          : (pRow.consulenze || 0)
      )
      actRec.contratti  = Number(pRow.contratti||0)
      actRec.prod_danni = Number(pRow.prod_danni||0)
      actRec.prod_vprot = Number(pRow.prod_vprot||0)
      actRec.prod_vpr   = Number(pRow.prod_vpr||0)
      actRec.prod_vpu   = Number(pRow.prod_vpu||0)
    }

    rows.push({ year:y, month:m, key, goal: goalRec, actual: actRec })
  }
  return rows
}

/* ========== Mini chart + formatter ========== */
function fmt(n:number, as:'int'|'currency'){
  if (as==='currency') return new Intl.NumberFormat('it-IT', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(n)
  return new Intl.NumberFormat('it-IT').format(n)
}

function BarChart({ rows, field, format }:{
  rows: MergedRow[]
  field: MetricField
  format: 'int'|'currency'
}){
  // semplice barchart orizzontale (CSS) — evita lib terze
  const max = Math.max(1, ...rows.map(r => Math.max(r.goal[field], r.actual[field])))
  return (
    <div style={{ display:'grid', gap:6 }}>
      {rows.map(r=>{
        const goal = r.goal[field]||0
        const act  = r.actual[field]||0
        const gW = Math.round((goal/max)*100)
        const aW = Math.round((act /max)*100)
        const ym = `${r.year}-${String(r.month).padStart(2,'0')}`
        return (
          <div key={ym} style={{ display:'grid', gridTemplateColumns:'76px 1fr', alignItems:'center', gap:8 }}>
            <div style={{ fontSize:12, color:'#666' }}>{ym}</div>
            <div style={{ display:'grid', gap:4 }}>
              <div title={`Actual ${fmt(act, format)}`} style={{ height:8, background:'#0b57d0', width:`${aW}%`, borderRadius:4 }} />
              <div title={`Goal ${fmt(goal, format)}`} style={{ height:6, background:'#d1d5db', width:`${gW}%`, borderRadius:3 }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* =================================== PAGE =================================== */
export default function ReportPage(){
  const [me, setMe] = useState<Me | null>(null)
  const [advisors, setAdvisors] = useState<AdvisorLite[]>([])

  const today = new Date()
  const [fromKey, setFromKey] = useState(toMonthKey(addMonths(today, -5)))
  const [toKey, setToKey] = useState(toMonthKey(today))

  const [selUid, setSelUid] = useState('') // advisor_user_id
  const [selAid, setSelAid] = useState('') // advisors.id

  const [goals, setGoals] = useState<GoalsRow[]>([])
  const [prog, setProg] = useState<ProgressRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // Bootstrap profilo + elenco advisors
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
        setAdvisors(((list||[]) as AdvisorLite[]).filter(a=>a.user_id))
        setSelUid(meObj.user_id); setSelAid(meObj.id)
      } else {
        setAdvisors([])
        setSelUid(meObj.user_id); setSelAid(meObj.id)
      }
    } catch(ex:any){ setErr(ex.message || 'Errore bootstrap') }
    finally{ setLoading(false) }
  })() },[])

  // sincronia selAid con selUid
  useEffect(()=>{
    if (!selUid) return
    if (me && selUid === me.user_id){ setSelAid(me.id); return }
    const found = advisors.find(a => a.user_id === selUid)
    setSelAid(found?.id || '')
  }, [selUid, advisors, me?.id])

  // carico dati su range/advisor
  useEffect(()=>{ (async()=>{
    if (!selUid) return
    setLoading(true); setErr('')
    try{
      const rng = monthRange(fromKey, toKey)
      const yrs = Array.from(new Set(rng.map(r=>r.y)))

      // GOALS
      const goalsRes: GoalsRow[] = []
      for (const y of yrs){
        const months = rng.filter(r=>r.y===y).map(r=>r.m)
        const { data, error } = await supabase
          .from('v_goals_monthly')
          .select('*')
          .eq('year', y)
          .in('month', months)
        if (error) throw error
        goalsRes.push(...(data||[]) as GoalsRow[])
      }
      setGoals(goalsRes)

      // PROGRESS
      const progRes: ProgressRow[] = []
      for (const y of yrs){
        const months = rng.filter(r=>r.y===y).map(r=>r.m)
        const { data, error } = await supabase
          .from('v_progress_monthly')
          .select('*')
          .eq('year', y)
          .in('month', months)
        if (error) throw error
        progRes.push(...(data||[]) as ProgressRow[])
      }

      // se manca 'appuntamenti' nella vista → calcolo
      const anyApp = progRes.some(r => typeof r.appuntamenti !== 'undefined')
      if (!anyApp){
        const monthKeys = rng.map(r=>`${r.y}-${String(r.m).padStart(2,'0')}`)
        const byMonth = await countAppointmentsByMonth(selUid, monthKeys)
        for(const row of progRes){
          const key = `${row.year}-${String(row.month).padStart(2,'0')}`
          row.appuntamenti = byMonth.get(key)||0
        }
      }

      setProg(progRes)
    } catch(ex:any){ setErr(ex.message || 'Errore caricamento dati') }
    finally{ setLoading(false) }
  })() }, [selUid, fromKey, toKey])

  const rows = useMemo(
    ()=> mergeByMonth(goals, prog, fromKey, toKey, selUid, selAid),
    [goals, prog, fromKey, toKey, selUid, selAid]
  )

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
              <select value={selUid} onChange={e=>setSelUid(e.target.value)} style={ipt}>
                <option value={me.user_id}>— {me.full_name || me.email} (me)</option>
                {advisors
                  .filter(a=>a.user_id!==me.user_id)
                  .map(a=> <option key={a.user_id} value={a.user_id}>{a.full_name || a.email}</option>)}
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

/* ========== Render helpers ========== */
function MetricCard({ title, field, rows, format }:{
  title:string,
  field: MetricField,
  rows: MergedRow[],
  format:'int'|'currency'
}){
  const totGoal = rows.reduce((s,r)=> s + (r.goal[field]||0), 0)
  const totAct  = rows.reduce((s,r)=> s + (r.actual[field]||0), 0)
  const pct = totGoal>0 ? (totAct / totGoal) : 0

  return (
    <div style={{ ...box }}>
      {/* Header con Totale periodo */}
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

      {/* Grafico mensile */}
      <BarChart rows={rows} field={field} format={format} />

      {/* Obiettivo di periodo */}
      <div style={{ marginTop:12, display:'grid', gap:6, fontSize:12, color:'#666' }}>
        <div>Obiettivo di periodo: <b>{fmt(totGoal, format)}</b></div>
        <div>Realizzato: <b>{fmt(totAct, format)}</b></div>
      </div>
    </div>
  )
}
