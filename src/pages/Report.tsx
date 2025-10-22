// ReportPage.tsx — Patch layout + obiettivi da "pagina obiettivi" con % (owner_id mapping fix)
// NOTE: mantiene tutte le funzionalità esistenti; aggiunge solo:
// - mirror panel allineato nello stile (spaziature, altezze, label)
// - lettura obiettivi dalla tabella `goals` (pagina Obiettivi) con fallback sulle viste
// - percentuali mostrate sia nelle carte a sinistra (totali) che nelle carte specchio
// - FIX: supporto owner_id salvato come advisors.id OPPURE advisors.user_id

import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

// ===== Tipi base (immutati rispetto alla tua struttura) =====
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

// Obiettivi “interni” usati dai grafici (mappa i nomi della pagina Obiettivi)
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

// ===== Stili coerenti su entrambe le colonne =====
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
  // ===== Stato & filtri =====
  const [me, setMe] = useState<Me | null>(null)
  const [advisors, setAdvisors] = useState<{ user_id: string, email: string, full_name: string | null }[]>([])
  const today = new Date()
  const [fromKey, setFromKey] = useState(toMonthKey(addMonths(today, -5)))
  const [toKey, setToKey] = useState(toMonthKey(today))
  const [advisorUid, setAdvisorUid] = useState<string>('')
  const [myTeam, setMyTeam] = useState<boolean>(false)

  // ===== Dati =====
  const [goals, setGoals] = useState<GoalsRow[]>([])
  const [prog, setProg] = useState<ProgressRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // ===== Bootstrap utente & lista advisors =====
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

  // ===== Caricamento dati su cambio filtri =====
  useEffect(()=>{ (async()=>{
    if (!advisorUid || !me) return
    setLoading(true); setErr('')
    try{
      const rng = monthRange(fromKey, toKey)
      const years = Array.from(new Set(rng.map(r=>r.y)))

      // --- elenco user_id del perimetro (singolo advisor o team)
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

      // --- PROGRESS (immutato: lettura dalla vista esistente)
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
        // se team → sommo per mese
        if (myTeam){
          const acc = groupSumByYM(data||[])
          progRows.push(...acc)
        } else {
          progRows.push(...(data||[]))
        }
      }
      setProg(progRows)

      // === FIX: mappa advisors.user_id -> advisors.id (owner_id può contenere uno dei due)
      const { byUserId, allAdvisorIds } = await fetchAdvisorIdMap(scopeUserIds)

      // --- GOALS dalla "pagina obiettivi" (tabella `goals`) con fallback alle viste
      const goalsRows = await loadGoalsMonthlyFromGoalsTable({ rng, years, scopeUserIds, scopeAdvisorIds: allAdvisorIds, isTeam: myTeam })
        .catch(async ()=> await loadGoalsMonthlyFromViews({ rng, years, scopeUserIds, isTeam: myTeam }))

      setGoals(goalsRows)
    } catch(ex:any){ setErr(ex.message || 'Errore caricamento dati') }
    finally{ setLoading(false) }
  })() }, [advisorUid, fromKey, toKey, myTeam, me])

  // ===== Merge & Totali per grafici =====
  const rows = useMemo(()=> mergeByMonth(goals, prog, fromKey, toKey), [goals, prog, fromKey, toKey])
  const totals = useMemo(()=> aggregateTotals(rows), [rows])

  return (
    <div style={{ display:'grid', gap:16 }}>
      {/* Header & filtri */}
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

      {/* GRID 2 colonne — colonne visivamente in linea */}
      <div style={{
        display:'grid',
        gap:16,
        gridTemplateColumns: typeof window !== 'undefined' && window.innerWidth < 1024
          ? '1fr'
          : 'minmax(0,1.25fr) minmax(300px,0.75fr)'
      }}>
        {/* Sinistra: grafici esistenti (con % in intestazione) */}
        <div style={{ display:'grid', gap:16 }}>
          <MetricCard title="Appuntamenti" field="consulenze" rows={rows} format="int" />
          <MetricCard title="Contratti" field="contratti" rows={rows} format="int" />
          <MetricCard title="Produzione Danni Non Auto" field="prod_danni" rows={rows} format="currency" />
          <MetricCard title="Vita Protection" field="prod_vprot" rows={rows} format="currency" />
          <MetricCard title="Vita Premi Ricorrenti" field="prod_vpr" rows={rows} format="currency" />
          <MetricCard title="Vita Premi Unici" field="prod_vpu" rows={rows} format="currency" />
        </div>

        {/* Destra: specchio obiettivi — stile allineato alle carte di sinistra */}
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

/* ===================== Componenti UI ===================== */

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

function Bars({ rows, field, format }:{
  rows:MergedRow[], field:keyof GoalsRow, format:'int'|'currency'
}){
  const W = Math.max(640, rows.length*64)
  const H = 160
  const pad = { l:40, r:20, t:10, b:30 }
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
              <text x={x + barW/2} y={baseY - gH - 4} fontSize={10} textAnchor="middle" fill="#667085">{fmt(gVal, format)}</text>
              <text x={x + barW + 6 + barW/2} y={baseY - aH - 4} fontSize={10} textAnchor="middle" fill="#111827">{fmt(aVal, format)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ——— Specchio: una carta per metrica, stessa altezza e gerarchia tipografica
function MirrorCard({
  title, goal, actual, format
}:{ title:string, goal:number, actual:number, format:'int'|'currency' }){
  const pct = goal>0 ? Math.min(100, Math.round((actual/goal)*1000)/10) : 0
  const H = 120, pad = { t:10, b:24 }
  const maxVal = Math.max(1, goal)
  const gH = (goal/maxVal) * (H - pad.t - pad.b)

  return (
    <div style={{ ...card, minHeight: 220, display:'grid', gap:10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
        <div style={headerTitle}>{title}</div>
        <div style={{ fontSize:13, fontWeight:700, color: pct>=100? '#067647' : pct>=70? '#B54708' : '#B42318' }}>{pct}%</div>
      </div>
      <div style={meta}>
        Attuale: <b>{fmt(actual, format)}</b> · Obiettivo: {fmt(goal, format)}
      </div>
      <div style={{ height:H }}>
        <svg width="100%" height={H} viewBox={`0 0 200 ${H}`} preserveAspectRatio="none">
          <rect x="90" y={H - pad.b - gH} width="20" height={gH} fill="#EEF2F6" rx="6" />
          <text x="100" y={H - pad.b - gH - 4} fontSize="10" textAnchor="middle" fill="#667085">{fmt(goal, format)}</text>
          <text x="100" y={H - 6} fontSize="10" textAnchor="middle" fill="#667085">Obiettivo periodo</text>
        </svg>
      </div>
    </div>
  )
}

/* ===================== Logica dati ===================== */

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

// ===== Helper: mappa advisors.user_id -> advisors.id
async function fetchAdvisorIdMap(userIds: string[]): Promise<{ byUserId: Record<string,string>, allAdvisorIds: string[] }> {
  if (!userIds.length) return { byUserId: {}, allAdvisorIds: [] }
  const { data, error } = await supabase
    .from('advisors')
    .select('id,user_id')
    .in('user_id', userIds)
  if (error) throw error
  const byUserId: Record<string,string> = {}
  for (const r of (data||[])) byUserId[r.user_id] = r.id
  return { byUserId, allAdvisorIds: Object.values(byUserId) }
}

// ====== LETTURA OBIETTIVI DALLA PAGINA "OBIETTIVI" ======
// Tabella prevista: `goals` con colonne mensili:
//  year, month, owner_id (facoltativo), appointments_target, contracts_target,
//  danni_non_auto_target, vita_protection_target, vita_premi_ricorrenti_target, vita_premi_unici_target
async function loadGoalsMonthlyFromGoalsTable({
  rng, years, scopeUserIds, scopeAdvisorIds, isTeam
}:{ rng: YM[], years:number[], scopeUserIds:string[], scopeAdvisorIds:string[], isTeam:boolean }): Promise<GoalsRow[]>{
  const rows: GoalsRow[] = []
  const monthsByYear: Record<number, number[]> = {}
  for (const {y,m} of rng) { (monthsByYear[y] ||= []).push(m) }

  for (const y of years){
    const months = monthsByYear[y]

    // 1) tenta match su owner_id = advisors.id (ID interno tabella advisors)
    const { data: byAdvisorId, error: e1 } = await supabase
      .from('goals')
      .select('year,month,owner_id,appointments_target,contracts_target,danni_non_auto_target,vita_protection_target,vita_premi_ricorrenti_target,vita_premi_unici_target')
      .eq('year', y)
      .in('month', months)
      .in('owner_id', scopeAdvisorIds.length ? scopeAdvisorIds : ['__nope__'])
    if (e1) throw e1

    // 2) se non trovate righe, tenta match su owner_id = advisors.user_id
    let byUserOwner: any[] = []
    if (!byAdvisorId?.length){
      const { data: byUserId, error: e2 } = await supabase
        .from('goals')
        .select('year,month,owner_id,appointments_target,contracts_target,danni_non_auto_target,vita_protection_target,vita_premi_ricorrenti_target,vita_premi_unici_target')
        .eq('year', y)
        .in('month', months)
        .in('owner_id', scopeUserIds.length ? scopeUserIds : ['__nope__'])
      if (e2) throw e2
      byUserOwner = byUserId || []
    }

    // 3) opzionale: righe GLOBALI (senza owner) che vuoi sempre sommare
    const { data: noOwner, error: e3 } = await supabase
      .from('goals')
      .select('year,month,owner_id,appointments_target,contracts_target,danni_non_auto_target,vita_protection_target,vita_premi_ricorrenti_target,vita_premi_unici_target')
      .eq('year', y)
      .in('month', months)
      .is('owner_id', null)
    if (e3) throw e3

    // merge sorgenti valide
    const source = (byAdvisorId?.length ? byAdvisorId : byUserOwner)
    const merged = [...(source||[]), ...(noOwner||[])]  // rimuovi noOwner se non vuoi obiettivi globali

    if (isTeam){
      // somma per mese (team)
      const map = new Map<string, GoalsRow>()
      for(const g of merged){
        const k = `${g.year}-${g.month}`
        const acc = map.get(k) || {
          advisor_user_id: 'TEAM',
          year: g.year, month: g.month,
          consulenze: 0, contratti: 0,
          prod_danni: 0, prod_vprot: 0, prod_vpr: 0, prod_vpu: 0
        }
        acc.consulenze += g.appointments_target || 0
        acc.contratti  += g.contracts_target || 0
        acc.prod_danni += Number(g.danni_non_auto_target || 0)
        acc.prod_vprot += Number(g.vita_protection_target || 0)
        acc.prod_vpr   += Number(g.vita_premi_ricorrenti_target || 0)
        acc.prod_vpu   += Number(g.vita_premi_unici_target || 0)
        map.set(k, acc)
      }
      rows.push(...map.values())
    } else {
      // singolo advisor: prendi solo le righe del selezionato (preferendo ID interni)
      const ownersWanted = scopeAdvisorIds.length ? scopeAdvisorIds : scopeUserIds
      for(const g of merged){
        if (g.owner_id && !ownersWanted.includes(g.owner_id)) continue
        rows.push({
          advisor_user_id: ownersWanted[0] || 'TEAM',
          year: g.year, month: g.month,
          consulenze: g.appointments_target || 0,
          contratti: g.contracts_target || 0,
          prod_danni: Number(g.danni_non_auto_target || 0),
          prod_vprot: Number(g.vita_protection_target || 0),
          prod_vpr: Number(g.vita_premi_ricorrenti_target || 0),
          prod_vpu: Number(g.vita_premi_unici_target || 0),
        })
      }
    }
  }
  return rows
}

// ====== FALLBACK: viste legacy se la tabella goals non c'è / è vuota ======
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

/* ===================== Utility ===================== */

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

// Somma progress per mese quando in modalità Team
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
