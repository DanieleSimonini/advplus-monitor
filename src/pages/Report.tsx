// src/pages/Report.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * Report.tsx — Andamento vs Obiettivi (mensile, per Advisor)
 * - Filtri: Advisor (se Admin/TL), periodo Dal mese / Al mese (default: ultimi 6 mesi)
 * - Grafici:
 *    1) Consulenze (bar) vs Obiettivo mensile (line)
 *    2) Consulenze vs Appuntamenti (bar affiancate)
 *    3) Cumulativo periodo: Consulenze (line) vs Obiettivo cumulato (line)
 * - KPI: Obiettivo Annuale e Obiettivo Mensile medio (Consulenze)
 * - Regole visibilità:
 *   • Junior: vede solo i propri dati (advisor selezionato = me, disabilitato)
 *   • Team Lead/Admin: possono scegliere l'advisor dal menu (possono vedere i Junior)
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

type ProgressRow = GoalsRow & {}

const box: React.CSSProperties = { background: 'var(--card, #fff)', border: '1px solid var(--border, #eee)', borderRadius: 16, padding: 16 }
const ipt: React.CSSProperties = { padding: '6px 10px', border: '1px solid var(--border, #ddd)', borderRadius: 8, background:'#fff', color:'var(--text, #111)' }
const th: React.CSSProperties  = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee', background: '#fafafa' }
const td: React.CSSProperties  = { padding: '6px 8px', borderBottom: '1px solid #f5f5f5' }

// ===== Utils mese =====
function toMonthKey(d: Date){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` }
function addMonths(d: Date, delta: number){ return new Date(d.getFullYear(), d.getMonth()+delta, 1) }
function monthRange(fromKey: string, toKey: string){
  const [fy,fm] = fromKey.split('-').map(Number)
  const [ty,tm] = toKey.split('-').map(Number)
  const out: { y:number; m:number; key:string }[] = []
  let y = fy, m = fm
  while (y < ty || (y===ty && m<=tm)){
    out.push({ y, m, key:`${y}-${String(m).padStart(2,'0')}` })
    m++; if (m>12){ m=1; y++ }
  }
  return out
}
function labelMonth(y:number,m:number){
  return new Date(y, m-1, 1).toLocaleDateString('it-IT',{ month:'short', year:'2-digit' })
}

// Merge goals+progress per mese (per semplicità solo campi usati qui)
function mergeByMonth(goals: GoalsRow[], prog: ProgressRow[], fromKey: string, toKey: string){
  const rng = monthRange(fromKey, toKey)
  const gmap = new Map(rng.map(r=>[`${r.y}-${r.m}`, { y:r.y, m:r.m, key:r.key, goals_cons:0, prog_cons:0 }]))
  for(const g of goals){
    const k = `${g.year}-${g.month}`
    if (gmap.has(k)) gmap.get(k)!.goals_cons = Number(g.consulenze||0)
  }
  for(const p of prog){
    const k = `${p.year}-${p.month}`
    if (gmap.has(k)) gmap.get(k)!.prog_cons = Number(p.consulenze||0)
  }
  return rng.map(r=> gmap.get(`${r.y}-${r.m}`)!)
}

export default function ReportPage(){
  const [me, setMe] = useState<Me | null>(null)
  const [advisors, setAdvisors] = useState<{ user_id: string, email: string, full_name: string | null }[]>([])

  // Filtri
  const today = new Date()
  const defTo = toMonthKey(today)
  const defFrom = toMonthKey(addMonths(today, -5))
  const [fromKey, setFromKey] = useState<string>(defFrom)
  const [toKey, setToKey] = useState<string>(defTo)
  const [advisorUid, setAdvisorUid] = useState<string>('')

  // Dati
  const [goals, setGoals] = useState<GoalsRow[]>([])
  const [prog, setProg] = useState<ProgressRow[]>([])
  const [apptsByMonth, setApptsByMonth] = useState<Record<string, number>>({}) // key 'YYYY-MM' → count appuntamenti
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // Bootstrap: me + advisors (per dropdown)
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
      setMe({ id: meRow.id, user_id: meRow.user_id, email: meRow.email, full_name: meRow.full_name, role: meRow.role as Role })

      // lista advisors (Admin/TL vedono tutti → possono scegliere Junior)
      if (meRow.role === 'Admin' || meRow.role === 'Team Lead'){
        const { data: list, error: lerr } = await supabase
          .from('advisors')
          .select('user_id,email,full_name')
          .order('full_name', { ascending: true })
        if (lerr) throw lerr
        setAdvisors((list||[]).filter(x=>!!x.user_id) as any)
        setAdvisorUid(uid)
      } else {
        // Junior → advisor = me
        setAdvisors([])
        setAdvisorUid(uid)
      }
    } catch(ex:any){ setErr(ex.message || 'Errore bootstrap') }
    finally{ setLoading(false) }
  })() },[])

  // Carica dati quando cambiano filtri
  useEffect(()=>{ (async()=>{
    if (!advisorUid) return
    setLoading(true); setErr('')
    try{
      const rng = monthRange(fromKey, toKey)
      const yrs = Array.from(new Set(rng.map(r=>r.y)))

      // goals (mensili)
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

      // progress (mensile)
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

      // appuntamenti: conta per mese nello stesso range per i lead dell'advisor
      // 1) prendo tutti i lead dell'advisor
      const { data: leads } = await supabase.from('leads').select('id').eq('owner_id', advisorUid)
      const leadIds = (leads||[]).map(l=>l.id)
      const byMonth: Record<string, number> = {}
      if (leadIds.length){
        // range ISO complessivo (dall'inizio del mese fromKey all'inizio del mese successivo a toKey)
        const [fy,fm] = fromKey.split('-').map(Number)
        const [ty,tm] = toKey.split('-').map(Number)
        const start = new Date(fy, fm-1, 1).toISOString()
        const end = new Date(ty, tm, 1).toISOString() // esclusivo
        const { data: rows } = await supabase
          .from('appointments')
          .select('id, ts, lead_id')
          .in('lead_id', leadIds)
          .gte('ts', start).lt('ts', end)

        for(const r of (rows||[])){
          const d = new Date(r.ts)
          const k = toMonthKey(d)
          byMonth[k] = (byMonth[k]||0) + 1
        }
      }
      setApptsByMonth(byMonth)
    } catch(ex:any){ setErr(ex.message || 'Errore caricamento dati') }
    finally{ setLoading(false) }
  })() },[advisorUid, fromKey, toKey])

  const rows = useMemo(()=> mergeByMonth(goals, prog, fromKey, toKey), [goals, prog, fromKey, toKey])

  // KPI Obiettivo Annuale e Mensile (Consulenze)
  const { kpiAnnualGoal, kpiMonthlyGoalAvg } = useMemo(()=>{
    // annuale: somma goals mensili dell'anno (o degli anni toccati) ma mostriamo per ciascun anno selezionabile
    // qui semplifichiamo: totale goals nel range selezionato → come "obiettivo periodo"
    const gSel = rows.reduce((s,r)=> s + (r?.goals_cons||0), 0)
    // mensile medio (sul range selezionato)
    const months = rows.length || 1
    const mAvg = gSel / months
    return { kpiAnnualGoal: gSel, kpiMonthlyGoalAvg: mAvg }
  }, [rows])

  // Serie grafici
  const seriesMonths = rows.map(r => labelMonth(r.y, r.m))
  const serieCons = rows.map(r => r.prog_cons || 0)
  const serieGoal = rows.map(r => r.goals_cons || 0)
  const serieAppt = rows.map(r => apptsByMonth[r.key] || 0)

  // Cumulativo
  const cumCons = serieCons.reduce<number[]>((acc, v, i)=>{ acc[i]=(i?acc[i-1]:0)+v; return acc },[])
  const cumGoal = serieGoal.reduce<number[]>((acc, v, i)=>{ acc[i]=(i?acc[i-1]:0)+v; return acc },[])

  // ===== RENDER =====
  return (
    <div style={{ display:'grid', gap:16 }}>
      {/* Header + Filtri */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
        <div style={{ fontSize:20, fontWeight:800 }}>Report — Consulenze e Appuntamenti</div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {/* Advisor selector */}
          <div style={{ display:'grid' }}>
            <label style={{ fontSize:12, color:'var(--muted,#666)' }}>Advisor</label>
            <select
              disabled={me?.role==='Junior'}
              value={advisorUid}
              onChange={e=>setAdvisorUid(e.target.value)}
              style={ipt}
            >
              {me && (me.role==='Junior') && <option value={me.user_id}>{me.full_name || me.email}</option>}
              {me && (me.role!=='Junior') && advisors.map(a=>(
                <option key={a.user_id} value={a.user_id}>
                  {(a.full_name && a.full_name.trim()) || a.email}
                </option>
              ))}
            </select>
          </div>

          {/* Periodo Dal / Al */}
          <div style={{ display:'grid' }}>
            <label style={{ fontSize:12, color:'var(--muted,#666)' }}>Dal mese</label>
            <input type="month" value={fromKey} onChange={e=>setFromKey(e.target.value)} style={ipt} />
          </div>
          <div style={{ display:'grid' }}>
            <label style={{ fontSize:12, color:'var(--muted,#666)' }}>Al mese</label>
            <input type="month" value={toKey} onChange={e=>setToKey(e.target.value)} style={ipt} />
          </div>
        </div>
      </div>

      {/* Stato */}
      {loading && <div className="brand-card">Caricamento…</div>}
      {!!err && <div className="brand-card" style={{ color:'#b91c1c' }}>{err}</div>}

      {/* KPI Obiettivi */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(220px, 1fr))', gap:12 }}>
        <div className="brand-card" style={box}>
          <div className="brand-kpi">
            <div>Obiettivo annuale (sul periodo selezionato)</div>
            <strong style={{ fontSize:22 }}>{new Intl.NumberFormat('it-IT').format(Math.round(kpiAnnualGoal))}</strong>
          </div>
          <div style={{ fontSize:12, color:'var(--muted,#666)' }}>
            Somma degli obiettivi mensili di <b>Consulenze</b> nel range scelto.
          </div>
        </div>
        <div className="brand-card" style={box}>
          <div className="brand-kpi">
            <div>Obiettivo mensile medio</div>
            <strong style={{ fontSize:22 }}>{new Intl.NumberFormat('it-IT').format(Math.round(kpiMonthlyGoalAvg))}</strong>
          </div>
          <div style={{ fontSize:12, color:'var(--muted,#666)' }}>
            Media degli obiettivi mensili di <b>Consulenze</b> sul periodo selezionato.
          </div>
        </div>
      </div>

      {/* Grafico 1: Consulenze vs Obiettivo (mensile) */}
      <div className="brand-card" style={box}>
        <div style={{ fontWeight:700, marginBottom:8 }}>Consulenze — mensile (vs obiettivo)</div>
        <MiniBarWithLine months={seriesMonths} bars={serieCons} line={serieGoal} barLabel="Consulenze" lineLabel="Obiettivo" />
      </div>

      {/* Grafico 2: Consulenze vs Appuntamenti */}
      <div className="brand-card" style={box}>
        <div style={{ fontWeight:700, marginBottom:8 }}>Consulenze vs Appuntamenti — mensile</div>
        <TwinBars months={seriesMonths} a={serieCons} b={serieAppt} aLabel="Consulenze" bLabel="Appuntamenti" />
        <div style={{ fontSize:12, color:'var(--muted,#666)', marginTop:8 }}>
          Gli appuntamenti sono conteggiati per i lead dell’advisor nel periodo selezionato.
        </div>
      </div>

      {/* Grafico 3: Cumulativo periodo (andamento vs obiettivo) */}
      <div className="brand-card" style={box}>
        <div style={{ fontWeight:700, marginBottom:8 }}>Cumulativo periodo — Consulenze</div>
        <MiniLines months={seriesMonths} lineA={cumCons} lineALabel="Cumulato Consulenze" lineB={cumGoal} lineBLabel="Cumulato Obiettivo" />
      </div>

      {/* Tabella di servizio (debug/analytics veloce) */}
      <div className="brand-card" style={box}>
        <div style={{ fontWeight:700, marginBottom:8 }}>Dettaglio mensile (Consulenze)</div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Mese</th>
                <th style={th}>Obiettivo (Cons.)</th>
                <th style={th}>Consulenze</th>
                <th style={th}>Appuntamenti</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r,i)=>(
                <tr key={r.key}>
                  <td style={td}>{seriesMonths[i]}</td>
                  <td style={td}>{new Intl.NumberFormat('it-IT').format(r.goals_cons||0)}</td>
                  <td style={td}>{new Intl.NumberFormat('it-IT').format(r.prog_cons||0)}</td>
                  <td style={td}>{new Intl.NumberFormat('it-IT').format(serieAppt[i]||0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/** Grafico barre + linea (SVG semplice) */
function MiniBarWithLine({ months, bars, line, barLabel, lineLabel }:{
  months:string[]; bars:number[]; line:number[]; barLabel:string; lineLabel:string
}){
  const W = Math.max(420, months.length * 56)
  const H = 220
  const pad = { l:48, r:12, t:12, b:24 }
  const max = Math.max(1, ...bars, ...line)
  const xStep = (W - pad.l - pad.r) / Math.max(1, months.length)
  const barW = xStep * 0.56

  function x(i:number){ return pad.l + i*xStep + (xStep - barW)/2 }
  function y(v:number){ return pad.t + (H - pad.t - pad.b) * (1 - (v/max)) }

  const linePts = months.map((_,i)=> `${pad.l + i*xStep + xStep/2},${y(line[i]||0)}`).join(' ')

  return (
    <div style={{ overflowX:'auto' }}>
      <svg width={W} height={H} role="img" aria-label={`${barLabel} vs ${lineLabel}`}>
        {/* Assi Y semplici */}
        <line x1={pad.l} y1={H-pad.b} x2={W-pad.r} y2={H-pad.b} stroke="#e5e7eb" />
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H-pad.b} stroke="#e5e7eb" />

        {/* Barre */}
        {months.map((m,i)=>(
          <g key={m}>
            <rect x={x(i)} y={y(bars[i]||0)} width={barW} height={(H-pad.b) - y(bars[i]||0)} fill="#c7d2fe" />
            {/* tick mese */}
            <text x={pad.l + i*xStep + xStep/2} y={H-6} textAnchor="middle" fontSize="11" fill="#374151">{m}</text>
          </g>
        ))}

        {/* Linea target */}
        <polyline points={linePts} fill="none" stroke="#0ea5e9" strokeWidth={2} />

        {/* Legenda */}
        <g transform={`translate(${pad.l},${pad.t})`}>
          <rect x={0} y={-10} width={12} height={12} fill="#c7d2fe" />
          <text x={18} y={0} fontSize="12"> {barLabel}</text>
          <line x1={110} y1={-4} x2={122} y2={-4} stroke="#0ea5e9" strokeWidth={2} />
          <text x={128} y={0} fontSize="12"> {lineLabel}</text>
        </g>
      </svg>
    </div>
  )
}

/** Grafico barre affiancate (Consulenze vs Appuntamenti) */
function TwinBars({ months, a, b, aLabel, bLabel }:{
  months:string[]; a:number[]; b:number[]; aLabel:string; bLabel:string
}){
  const W = Math.max(420, months.length * 64)
  const H = 220
  const pad = { l:48, r:12, t:12, b:24 }
  const max = Math.max(1, ...a, ...b)
  const xStep = (W - pad.l - pad.r) / Math.max(1, months.length)
  const barW = xStep * 0.36
  function xA(i:number){ return pad.l + i*xStep + (xStep - (barW*2+6))/2 }
  function xB(i:number){ return xA(i) + barW + 6 }
  function y(v:number){ return pad.t + (H - pad.t - pad.b) * (1 - (v/max)) }

  return (
    <div style={{ overflowX:'auto' }}>
      <svg width={W} height={H}>
        <line x1={pad.l} y1={H-pad.b} x2={W-pad.r} y2={H-pad.b} stroke="#e5e7eb" />
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H-pad.b} stroke="#e5e7eb" />

        {months.map((m,i)=>(
          <g key={m}>
            <rect x={xA(i)} y={y(a[i]||0)} width={barW} height={(H-pad.b)-y(a[i]||0)} fill="#a5b4fc" />
            <rect x={xB(i)} y={y(b[i]||0)} width={barW} height={(H-pad.b)-y(b[i]||0)} fill="#93c5fd" />
            <text x={pad.l + i*xStep + xStep/2} y={H-6} textAnchor="middle" fontSize="11" fill="#374151">{m}</text>
          </g>
        ))}

        {/* Legenda */}
        <g transform={`translate(${pad.l},${pad.t})`}>
          <rect x={0} y={-10} width={12} height={12} fill="#a5b4fc" />
          <text x={18} y={0} fontSize="12"> {aLabel}</text>
          <rect x={120} y={-10} width={12} height={12} fill="#93c5fd" />
          <text x={138} y={0} fontSize="12"> {bLabel}</text>
        </g>
      </svg>
    </div>
  )
}

/** Grafico linee cumulative (Consulenze vs Obiettivo cumulato) */
function MiniLines({ months, lineA, lineB, lineALabel, lineBLabel }:{
  months:string[]; lineA:number[]; lineB:number[]; lineALabel:string; lineBLabel:string
}){
  const W = Math.max(420, months.length * 56)
  const H = 220
  const pad = { l:48, r:12, t:12, b:24 }
  const max = Math.max(1, ...lineA, ...lineB)
  const xStep = (W - pad.l - pad.r) / Math.max(1, months.length)
  function x(i:number){ return pad.l + i*xStep + xStep/2 }
  function y(v:number){ return pad.t + (H - pad.t - pad.b) * (1 - (v/max)) }
  const ptsA = months.map((_,i)=> `${x(i)},${y(lineA[i]||0)}`).join(' ')
  const ptsB = months.map((_,i)=> `${x(i)},${y(lineB[i]||0)}`).join(' ')

  return (
    <div style={{ overflowX:'auto' }}>
      <svg width={W} height={H}>
        <line x1={pad.l} y1={H-pad.b} x2={W-pad.r} y2={H-pad.b} stroke="#e5e7eb" />
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H-pad.b} stroke="#e5e7eb" />

        <polyline points={ptsA} fill="none" stroke="#4f46e5" strokeWidth={2}/>
        <polyline points={ptsB} fill="none" stroke="#0ea5e9" strokeWidth={2}/>

        {months.map((m,i)=>(
          <text key={m} x={x(i)} y={H-6} textAnchor="middle" fontSize="11" fill="#374151">{m}</text>
        ))}

        {/* Legenda */}
        <g transform={`translate(${pad.l},${pad.t})`}>
          <line x1={0} y1={-4} x2={14} y2={-4} stroke="#4f46e5" strokeWidth={2} />
          <text x={20} y={0} fontSize="12"> {lineALabel}</text>
          <line x1={140} y1={-4} x2={154} y2={-4} stroke="#0ea5e9" strokeWidth={2} />
          <text x={160} y={0} fontSize="12"> {lineBLabel}</text>
        </g>
      </svg>
    </div>
  )
}
