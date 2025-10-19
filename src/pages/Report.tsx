import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * Report.tsx — Andamento vs Obiettivi (mensile, per Advisor)
 * - Filtri: Advisor (se Admin/TL), periodo Dal mese / Al mese (default: ultimi 6 mesi)
 * - Grafici: bar chart SVG semplice per ciascun indicatore vs target
 * - Indicatori: consulenze, contratti, prod_danni, prod_vprot, prod_vpr, prod_vpu
 * - Regole visibilità:
 *   • Junior: vede solo i propri dati (advisor selezionato = me, disabilitato)
 *   • Team Lead/Admin: possono scegliere l'advisor dal menu (+ filtro "Il Mio Team" per TL)
 */

type Role = 'Admin' | 'Team Lead' | 'Junior'

type Me = { id: string; user_id: string; email: string; full_name: string | null; role: Role }

type GoalsRow = {
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

type ProgressRow = GoalsRow & { }

const box: React.CSSProperties = { background: 'var(--card, #fff)', border: '1px solid var(--border, #eee)', borderRadius: 16, padding: 16 }
const ipt: React.CSSProperties = { padding: '6px 10px', border: '1px solid var(--border, #ddd)', borderRadius: 8, background:'#fff', color:'var(--text, #111)' }
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee', background: '#fafafa' }
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #f5f5f5' }

export default function ReportPage(){
  const [me, setMe] = useState<Me | null>(null)
  const [advisors, setAdvisors] = useState<{ user_id: string, email: string, full_name: string | null }[]>([])
  const [teamIds, setTeamIds] = useState<string[]>([])  // me + miei junior (solo per TL)

  // Filtri
  const today = new Date()
  const defTo = toMonthKey(today)
  const defFrom = toMonthKey(addMonths(today, -5))
  const [fromKey, setFromKey] = useState<string>(defFrom)
  const [toKey, setToKey] = useState<string>(defTo)
  const [advisorUid, setAdvisorUid] = useState<string>('')

  // Nuovo filtro: Il Mio Team (solo TL)
  const [myTeam, setMyTeam] = useState<boolean>(false)

  // Dati
  const [goals, setGoals] = useState<GoalsRow[]>([])
  const [prog, setProg] = useState<ProgressRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // Bootstrap: me + advisors (per dropdown) + ids del mio team se sono TL
  useEffect(()=>{ (async()=>{
    setLoading(true); setErr('')
    try{
      const { data: auth } = await supabase.auth.getUser()
      const uid = auth.user?.id
      if (!uid){ setErr('Utente non autenticato'); setLoading(false); return }

      // me
      const { data: meRow, error: meErr } = await supabase
        .from('advisors')
        .select('id,user_id,email,full_name,role')
        .eq('user_id', uid)
        .maybeSingle()
      if (meErr) throw meErr
      if (!meRow){ setErr('Profilo non trovato'); setLoading(false); return }
      const meObj: Me = { id: meRow.id, user_id: meRow.user_id, email: meRow.email, full_name: meRow.full_name, role: meRow.role as Role }
      setMe(meObj)

      // lista advisors (solo per Admin/TL)
      if (meRow.role === 'Admin' || meRow.role === 'Team Lead'){
        const { data: list, error: lerr } = await supabase
          .from('advisors')
          .select('user_id,email,full_name,team_lead_user_id')
          .order('full_name', { ascending: true })
        if (lerr) throw lerr
        const arr = (list||[]).filter(x=>!!x.user_id) as any as { user_id:string, email:string, full_name:string|null, team_lead_user_id?:string|null }[]
        setAdvisors(arr.map(({user_id,email,full_name})=>({user_id,email,full_name})))
        setAdvisorUid(uid)

        // Se sono Team Lead: calcola gli user_id del mio team (me + junior)
        if (meRow.role === 'Team Lead'){
          const myJuniors = arr.filter(a => a.team_lead_user_id === uid).map(a => a.user_id)
          const ids = Array.from(new Set([uid, ...myJuniors]))
          setTeamIds(ids)
        }
      } else {
        // Junior → advisor = me, dropdown disabilitato
        setAdvisors([])
        setAdvisorUid(uid)
      }
    } catch(ex:any){ setErr(ex.message || 'Errore bootstrap') }
    finally{ setLoading(false) }
  })() },[])

  // Carica dati quando cambiano filtri
  useEffect(()=>{ (async()=>{
    if (!advisorUid || !me) return
    setLoading(true); setErr('')
    try{
      const rng = monthRange(fromKey, toKey) // array di {y,m}
      const yrs = Array.from(new Set(rng.map(r=>r.y)))

      // === BRANCH: Il Mio Team (solo TL) ===
      if (myTeam && me.role === 'Team Lead') {
        // 1) GOALS TEAM (già aggregati lato DB)
        const teamGoals: GoalsRow[] = []
        for(const y of yrs){
          const months = rng.filter(r=>r.y===y).map(r=>r.m)
          const { data, error } = await supabase
            .from('v_team_goals_monthly_sum')
            .select('year,month,consulenze,contratti,danni_non_auto,vita_protection,vita_ricorrenti,vita_unici')
            .eq('year', y)
            .in('month', months)
          if (error) throw error
          for (const r of (data||[])) {
            teamGoals.push({
              advisor_user_id: 'TEAM', // fittizio per shape
              year: r.year,
              month: r.month,
              consulenze: r.consulenze || 0,
              contratti: r.contratti || 0,
              prod_danni: r.danni_non_auto || 0,
              prod_vprot: r.vita_protection || 0,
              prod_vpr: r.vita_ricorrenti || 0,
              prod_vpu: r.vita_unici || 0,
            })
          }
        }
        setGoals(teamGoals)

        // 2) PROGRESS TEAM (somma lato FE solo sugli advisor del mio team)
        // teamIds contiene me + junior; fallback su [me.user_id] se vuoto
        const ids = (teamIds && teamIds.length>0) ? teamIds : [me.user_id]
        const teamProgMap = new Map<string, ProgressRow>() // key: y-m
        const k = (y:number,m:number)=>`${y}-${m}`
        for(const y of yrs){
          const months = rng.filter(r=>r.y===y).map(r=>r.m)
          const { data, error } = await supabase
            .from('v_progress_monthly')
            .select('advisor_user_id,year,month,consulenze,contratti,prod_danni,prod_vprot,prod_vpr,prod_vpu')
            .eq('year', y)
            .in('month', months)
            .in('advisor_user_id', ids)
          if (error) throw error
          for(const row of (data||[])){
            const key = k(row.year, row.month)
            const acc = teamProgMap.get(key) || {
              advisor_user_id: 'TEAM',
              year: row.year,
              month: row.month,
              consulenze: 0, contratti: 0, prod_danni: 0, prod_vprot: 0, prod_vpr: 0, prod_vpu: 0
            }
            acc.consulenze += row.consulenze || 0
            acc.contratti  += row.contratti  || 0
            acc.prod_danni += row.prod_danni || 0
            acc.prod_vprot += row.prod_vprot || 0
            acc.prod_vpr   += row.prod_vpr   || 0
            acc.prod_vpu   += row.prod_vpu   || 0
            teamProgMap.set(key, acc)
          }
        }
        setProg(Array.from(teamProgMap.values()))
        setLoading(false)
        return
      }

      // === BRANCH: singolo advisor (comportamento attuale) ===
      // goals
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

      // progress (vista v_progress_monthly)
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
      setProg(progRes)
    } catch(ex:any){ setErr(ex.message || 'Errore caricamento dati') }
    finally{ setLoading(false) }
  })() },[advisorUid, fromKey, toKey, myTeam, me, teamIds])

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
          {/* Filtro "Il Mio Team" SOLO per Team Lead */}
          {me?.role === 'Team Lead' && (
            <label style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12 }}>
              <input type="checkbox" checked={myTeam} onChange={e=>setMyTeam(e.target.checked)} />
              Il Mio Team
            </label>
          )}
          {me && (me.role==='Admin' || me.role==='Team Lead') ? (
            <>
              <label style={{ fontSize:12 }}>Advisor</label>
              <select value={advisorUid} onChange={e=>setAdvisorUid(e.target.value)} style={ipt} disabled={me.role==='Team Lead' && myTeam}>
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
        <MetricCard title="Appuntamenti" field="consulenze" rows={rows} format="int" />
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
  field: keyof GoalsRow,
  rows: MergedRow[],
  format:'int'|'currency'
}){
  const totGoal = rows.reduce((s,r)=> s + (r.goal[field]||0), 0)
  const totAct  = rows.reduce((s,r)=> s + (r.actual[field]||0), 0)
  const hasTarget = totGoal > 0
  const pct = hasTarget ? (totAct / totGoal) : 0

  return (
    <div style={{ ...box }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
        <div style={{ fontSize:16, fontWeight:700 }}>{title}</div>
        <div style={{ fontSize:14, minWidth:220, textAlign:'right' }}>
          <span style={{ color:'#666' }}>Totale periodo: </span>
          <b>{fmt(totAct, format)}</b>
          <span> / {fmt(totGoal, format)}</span>
          <span style={{ marginLeft:10, fontWeight:800, color: pct>=1? '#0a0':'#a60' }}>
            {hasTarget ? `${(pct*100).toFixed(0)}%` : '—'}
          </span>
        </div>
      </div>

      <BarChart rows={rows} field={field} format={format} />
    </div>
  )
}

function BarChart({ rows, field, format }:{ rows:MergedRow[], field:keyof GoalsRow, format:'int'|'currency' }){
  const W = Math.max(600, rows.length*60)
  const H = 160
  const pad = { l:40, r:20, t:10, b:30 }
  const maxVal = Math.max(1, ...rows.map(r => Math.max(r.goal[field]||0, r.actual[field]||0)))
  const step = (W - pad.l - pad.r) / Math.max(1, rows.length)
  const barW = Math.max(14, step*0.35)

  return (
    <div style={{ overflowX:'auto' }}>
      <svg width={W} height={H}>
        {/* axis */}
        <line x1={pad.l} y1={H-pad.b} x2={W-pad.r} y2={H-pad.b} stroke="#ddd" />
        {/* bars */}
        {rows.map((r, i) => {
          const x = pad.l + i*step + 8
          const gVal = r.goal[field]||0
          const aVal = r.actual[field]||0
          const gH = (gVal/maxVal) * (H - pad.b - pad.t)
          const aH = (aVal/maxVal) * (H - pad.b - pad.t)
          const baseY = H - pad.b
          return (
            <g key={i}>
              {/* goal bar (light) */}
              <rect x={x} y={baseY - gH} width={barW} height={gH} fill="#eaeaea" />
              {/* actual bar (solid) */}
              <rect x={x + barW + 6} y={baseY - aH} width={barW} height={aH} fill="#888" />
              {/* label month */}
              <text x={x + barW} y={H-10} fontSize={11} textAnchor="middle">{r.label}</text>
              {/* values */}
              <text x={x + barW/2} y={baseY - gH - 4} fontSize={10} textAnchor="middle" fill="#777">{fmt(gVal, format)}</text>
              <text x={x + barW + 6 + barW/2} y={baseY - aH - 4} fontSize={10} textAnchor="middle" fill="#333">{fmt(aVal, format)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function BarChart({ rows, field, format }:{
  rows:MergedRow[], field:keyof GoalsRow, format:'int'|'currency'
}){
  const W = Math.max(600, rows.length*60)
  const H = 180
  const pad = { l:44, r:20, t:12, b:34 }

  // scala verticale in base al massimo tra target (goal) e actual
  const maxVal = Math.max(1, ...rows.map(r => Math.max(r.goal[field]||0, r.actual[field]||0)))
  const step = (W - pad.l - pad.r) / Math.max(1, rows.length)
  const barW = Math.max(16, step*0.35)

  return (
    <div style={{ overflowX:'auto' }}>
      <svg width={W} height={H}>
        {/* asse X */}
        <line x1={pad.l} y1={H-pad.b} x2={W-pad.r} y2={H-pad.b} stroke="#ddd" />

        {rows.map((r, i) => {
          const x = pad.l + i*step + 8
          const goal = r.goal[field]||0
          const act  = r.actual[field]||0
          const gH = (goal/maxVal) * (H - pad.b - pad.t)
          const aH = (act /maxVal) * (H - pad.b - pad.t)
          const baseY = H - pad.b

          // % mensile se abbiamo un target
          const monthPct = goal>0 ? Math.round((act/goal)*100) : null

          return (
            <g key={i}>
              {/* goal bar (chiara) */}
              <rect x={x} y={baseY - gH} width={barW} height={gH} fill="#eaeaea" />
              {/* actual bar (scura) */}
              <rect x={x + barW + 6} y={baseY - aH} width={barW} height={aH} fill="#888" />

              {/* label mese */}
              <text x={x + barW} y={H-12} fontSize={11} textAnchor="middle">{r.label}</text>

              {/* etichette:
                  - mostra SEMPRE il target (anche se 0 viene omesso per pulizia)
                  - evita di stampare "0" sull'actual; mostra solo se > 0
              */}
              {goal>0 && (
                <text x={x + barW/2} y={baseY - gH - 4} fontSize={10} textAnchor="middle" fill="#777">
                  {fmt(goal, format)}
                </text>
              )}
              {act>0 && (
                <text x={x + barW + 6 + barW/2} y={baseY - aH - 4} fontSize={10} textAnchor="middle" fill="#333">
                  {fmt(act, format)}
                </text>
              )}

              {/* percentuale mensile di avanzamento (se esiste target) */}
              {monthPct!==null && (
                <text x={x + barW + 6 + barW/2} y={baseY + 14} fontSize={10} textAnchor="middle" fill={monthPct>=100? '#0a0':'#a60'}>
                  {monthPct}%
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function mergeByMonth(goals: GoalsRow[], prog: ProgressRow[], fromKey:string, toKey:string): MergedRow[]{
  const rng = monthRange(fromKey, toKey)
  const key = (y:number,m:number)=> `${y}-${m}`
  const gmap = new Map<string, GoalsRow>()
  const amap = new Map<string, ProgressRow>()
  for(const g of goals) gmap.set(key(g.year,g.month), g)
  for(const a of prog)  amap.set(key(a.year,a.month), a)
  const fields: (keyof GoalsRow)[] = ['advisor_user_id','year','month','consulenze','contratti','prod_danni','prod_vprot','prod_vpr','prod_vpu']
  const metricFields: (keyof GoalsRow)[] = ['consulenze','contratti','prod_danni','prod_vprot','prod_vpr','prod_vpu']
  const out: MergedRow[] = []
  for(const {y,m} of rng){
    const g = gmap.get(key(y,m))
    const a = amap.get(key(y,m))
    const row: MergedRow = {
      y, m,
      label: `${String(m).padStart(2,'0')}/${String(y).slice(2)}`,
      goal: Object.fromEntries(fields.map(f=>[f, 0])) as any,
      actual: Object.fromEntries(fields.map(f=>[f, 0])) as any,
    }
    for(const f of metricFields){
      row.goal[f] = (g as any)?.[f] || 0
      row.actual[f] = (a as any)?.[f] || 0
    }
    out.push(row)
  }
  return out
}
