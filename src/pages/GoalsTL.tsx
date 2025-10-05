import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'

/**
 * GoalsTL.tsx — Schermata Team Lead per assegnare obiettivi
 * - Selettore Advisor (solo il tuo team) + mese (YYYY-MM)
 * - Pannello Obiettivi Annuali + Mensili
 * - Pulsanti Reset/Salva (con conferma)
 * - Mini-grafico di andamento mensile (consulenze/contratti/produzione)
 *
 * Requisiti DB: tabelle public.goals, public.goals_monthly, viste v_progress_monthly / v_progress_annual
 * RLS: Team Lead può scrivere sugli advisor del proprio team; Admin ovunque; Junior lettura (ma non accede qui)
 */

type Advisor = { id: string; user_id: string; full_name: string | null; email: string; role: 'Admin'|'Team Lead'|'Junior'; team_lead_user_id?: string | null }

type AnnualGoals = {
  advisor_user_id: string
  year: number
  target_consulenze: number
  target_contratti: number
  target_prod_danni: number
  target_prod_vprot: number
  target_prod_vpr: number
  target_prod_vpu: number
}

type MonthlyGoals = AnnualGoals & { month: number }

type MonthlyProgress = { month:number; consulenze:number; contratti:number; prod_danni:number; prod_vprot:number; prod_vpr:number; prod_vpu:number }

const box: React.CSSProperties = { background:'#fff', border:'1px solid #eee', borderRadius:16, padding:16 }
const btn: React.CSSProperties = { padding:'8px 10px', borderRadius:10, border:'1px solid #ddd', background:'#fff', cursor:'pointer' }
const cta: React.CSSProperties = { padding:'10px 12px', borderRadius:10, border:'1px solid #111', background:'#111', color:'#fff', cursor:'pointer' }
const ipt: React.CSSProperties = { padding:'10px 12px', borderRadius:10, border:'1px solid #ddd', width:'100%', boxSizing:'border-box' }
const grid: React.CSSProperties = { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12 }
const title: React.CSSProperties = { fontWeight:700, marginBottom:12 }

export default function GoalsTLPage(){
  const [me, setMe] = useState<Advisor | null>(null)
  const [team, setTeam] = useState<Advisor[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const [advisorUserId, setAdvisorUserId] = useState<string>('')
  const [monthKey, setMonthKey] = useState<string>(toMonthKey(new Date())) // YYYY-MM

  const year = useMemo(()=> Number(monthKey.slice(0,4)), [monthKey])
  const month = useMemo(()=> Number(monthKey.slice(5,7)), [monthKey])

  const [annual, setAnnual] = useState<AnnualGoals | null>(null)
  const [monthly, setMonthly] = useState<MonthlyGoals | null>(null)
  const [progress, setProgress] = useState<MonthlyProgress[]>([])

  const [saving, setSaving] = useState(false)

  // bootstrap: utente corrente + team
  useEffect(()=>{ (async()=>{
    setLoading(true); setError('')
    const u = await supabase.auth.getUser()
    const email = u.data.user?.email
    if (!email){ setError('Utente non autenticato'); setLoading(false); return }

    const { data: arow, error: aerr } = await supabase
      .from('advisors')
      .select('id,user_id,full_name,email,role,team_lead_user_id')
      .eq('email', email)
      .maybeSingle()
    if (aerr || !arow){ setError(aerr?.message || 'Advisor non trovato'); setLoading(false); return }
    const meAdv: Advisor = { id: arow.id, user_id: arow.user_id, full_name: arow.full_name, email: arow.email, role: arow.role as any, team_lead_user_id: arow.team_lead_user_id }
    setMe(meAdv)

    if (meAdv.role === 'Team Lead'){
      const { data, error } = await supabase
        .from('advisors')
        .select('id,user_id,full_name,email,role,team_lead_user_id')
        .or(`user_id.eq.${meAdv.user_id},team_lead_user_id.eq.${meAdv.user_id}`)
        .order('role', { ascending:false })
        .order('full_name', { ascending:true })
      if (error){ setError(error.message); setLoading(false); return }
      const list = (data||[]) as Advisor[]
      setTeam(list)
      setAdvisorUserId(meAdv.user_id) // default su TL stesso
    } else if (meAdv.role === 'Admin'){
      const { data, error } = await supabase
        .from('advisors')
        .select('id,user_id,full_name,email,role,team_lead_user_id')
        .order('full_name', { ascending:true })
      if (error){ setError(error.message); setLoading(false); return }
      const list = (data||[]) as Advisor[]
      setTeam(list)
      setAdvisorUserId(list[0]?.user_id || '')
    } else {
      setError('Accesso negato: solo Admin/Team Lead possono impostare obiettivi.')
    }
    setLoading(false)
  })() },[])

  // carica obiettivi/progresso quando cambiano advisor o mese
  useEffect(()=>{ (async()=>{
    if (!advisorUserId || !year) return
    setError('')
    const ann = await getAnnual(advisorUserId, year)
    const mon = await getMonthly(advisorUserId, year, month)
    const prog = await getProgress(advisorUserId, year)
    setAnnual(ann)
    setMonthly(mon)
    setProgress(prog)
  })() }, [advisorUserId, year, month])

  const canEdit = me?.role === 'Admin' || me?.role === 'Team Lead'

  const onReset = async ()=>{
    if (!advisorUserId) return
    if (!window.confirm('Sicuro di voler resettare i campi alla situazione attuale in DB?')) return
    const ann = await getAnnual(advisorUserId, year)
    const mon = await getMonthly(advisorUserId, year, month)
    setAnnual(ann)
    setMonthly(mon)
  }

  const onSave = async ()=>{
    try{
      if (!canEdit) { alert('Non autorizzato'); return }
      if (!advisorUserId) { alert('Seleziona un advisor'); return }
      setSaving(true)
      // annual
      if (annual){ await upsertAnnual(annual) }
      // monthly
      if (monthly){ await upsertMonthly(monthly) }
      alert('Obiettivi salvati')
    }catch(e:any){
      setError(e.message || String(e))
    }finally{ setSaving(false) }
  }

  const selectedAdv = useMemo(()=> team.find(t=>t.user_id===advisorUserId) || null, [team, advisorUserId])

  return (
    <div style={{ display:'grid', gap:16 }}>
      <div style={title}>Obiettivi — Team Lead</div>
      {error && <div style={{ color:'#c00' }}>{error}</div>}

      {/* FILTRI */}
      <div style={{ ...box }}>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'end' }}>
          <div>
            <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Advisor</div>
            <select value={advisorUserId} onChange={e=>setAdvisorUserId(e.target.value)} style={ipt}>
              <option value="">—</option>
              {team.map(a=> (
                <option key={a.user_id} value={a.user_id}>{a.full_name || a.email} {a.role!=='Junior' ? `(${a.role})` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Mese</div>
            <input type="month" value={monthKey} onChange={(e)=>setMonthKey(e.target.value)} style={ipt} />
          </div>
          <div>
            <button style={btn} onClick={()=>setMonthKey(toMonthKey(new Date()))}>Mese corrente</button>
          </div>
        </div>
      </div>

      {/* ANNUALE */}
      <div style={box}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <div style={{ fontWeight:700 }}>Obiettivi Annuali — {selectedAdv ? (selectedAdv.full_name || selectedAdv.email) : '—'} — {year}</div>
          <div style={{ display:'flex', gap:8 }}>
            <button style={btn} onClick={onReset}>Reset</button>
            <button style={cta} onClick={onSave} disabled={!canEdit || saving}>{saving?'Salvataggio…':'Salva'}</button>
          </div>
        </div>
        <div style={grid}>
          {annualInput('Nr. consulenze', annual?.target_consulenze ?? 0, v=>setAnnual(p=>p?{...p,target_consulenze:v}:makeAnnual(advisorUserId,year,{target_consulenze:v})))}
          {annualInput('Nr. contratti', annual?.target_contratti ?? 0, v=>setAnnual(p=>p?{...p,target_contratti:v}:makeAnnual(advisorUserId,year,{target_contratti:v})))}
          {annualInput('Produzione Danni Non Auto (€)', annual?.target_prod_danni ?? 0, v=>setAnnual(p=>p?{...p,target_prod_danni:v}:makeAnnual(advisorUserId,year,{target_prod_danni:v})))}
          {annualInput('Produzione Vita Protection (€)', annual?.target_prod_vprot ?? 0, v=>setAnnual(p=>p?{...p,target_prod_vprot:v}:makeAnnual(advisorUserId,year,{target_prod_vprot:v})))}
          {annualInput('Produzione Vita Premi Ricorrenti (€)', annual?.target_prod_vpr ?? 0, v=>setAnnual(p=>p?{...p,target_prod_vpr:v}:makeAnnual(advisorUserId,year,{target_prod_vpr:v})))}
          {annualInput('Produzione Vita Premi Unici (€)', annual?.target_prod_vpu ?? 0, v=>setAnnual(p=>p?{...p,target_prod_vpu:v}:makeAnnual(advisorUserId,year,{target_prod_vpu:v})))}
        </div>
      </div>

      {/* MENSILE */}
      <div style={box}>
        <div style={{ fontWeight:700, marginBottom:12 }}>Obiettivi Mensili — {monthKey}</div>
        <div style={grid}>
          {monthlyInput('Nr. consulenze', monthly?.target_consulenze ?? 0, v=>setMonthly(p=>p?{...p,target_consulenze:v}:makeMonthly(advisorUserId,year,month,{target_consulenze:v})))}
          {monthlyInput('Nr. contratti', monthly?.target_contratti ?? 0, v=>setMonthly(p=>p?{...p,target_contratti:v}:makeMonthly(advisorUserId,year,month,{target_contratti:v})))}
          {monthlyInput('Produzione Danni Non Auto (€)', monthly?.target_prod_danni ?? 0, v=>setMonthly(p=>p?{...p,target_prod_danni:v}:makeMonthly(advisorUserId,year,month,{target_prod_danni:v})))}
          {monthlyInput('Produzione Vita Protection (€)', monthly?.target_prod_vprot ?? 0, v=>setMonthly(p=>p?{...p,target_prod_vprot:v}:makeMonthly(advisorUserId,year,month,{target_prod_vprot:v})))}
          {monthlyInput('Produzione Vita Premi Ricorrenti (€)', monthly?.target_prod_vpr ?? 0, v=>setMonthly(p=>p?{...p,target_prod_vpr:v}:makeMonthly(advisorUserId,year,month,{target_prod_vpr:v})))}
          {monthlyInput('Produzione Vita Premi Unici (€)', monthly?.target_prod_vpu ?? 0, v=>setMonthly(p=>p?{...p,target_prod_vpu:v}:makeMonthly(advisorUserId,year,month,{target_prod_vpu:v})))}
        </div>
      </div>

      {/* PROGRESSO ANNO (mini grafico) */}
      <div style={box}>
        <div style={{ fontWeight:700, marginBottom:8 }}>Andamento {year}</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(240px,1fr))', gap:12 }}>
          <SparkCard label="Consulenze" data={progress.map(p=>p.consulenze)} />
          <SparkCard label="Contratti" data={progress.map(p=>p.contratti)} />
          <SparkCard label="Produzione (€)" data={progress.map(p=> (p.prod_danni+p.prod_vprot+p.prod_vpr+p.prod_vpu))} fmt="€" />
        </div>
      </div>
    </div>
  )
}

function annualInput(label:string, value:number, onChange:(v:number)=>void){
  return (
    <div>
      <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>{label}</div>
      <input type="number" value={value} onChange={e=>onChange(Number(e.target.value||0))} style={ipt} />
    </div>
  )
}
function monthlyInput(label:string, value:number, onChange:(v:number)=>void){
  return (
    <div>
      <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>{label}</div>
      <input type="number" value={value} onChange={e=>onChange(Number(e.target.value||0))} style={ipt} />
    </div>
  )
}

function toMonthKey(d: Date){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); return `${y}-${m}` }

async function getAnnual(advisor_user_id:string, year:number): Promise<AnnualGoals>{
  const { data, error } = await supabase
    .from('goals')
    .select('advisor_user_id,year,target_consulenze,target_contratti,target_prod_danni,target_prod_vprot,target_prod_vpr,target_prod_vpu')
    .eq('advisor_user_id', advisor_user_id)
    .eq('year', year)
    .maybeSingle()
  if (error && error.code!=='PGRST116') throw error // ignora no rows
  if (!data) return { advisor_user_id, year, target_consulenze:0, target_contratti:0, target_prod_danni:0, target_prod_vprot:0, target_prod_vpr:0, target_prod_vpu:0 }
  return data as AnnualGoals
}

async function getMonthly(advisor_user_id:string, year:number, month:number): Promise<MonthlyGoals>{
  const { data, error } = await supabase
    .from('goals_monthly')
    .select('advisor_user_id,year,month,target_consulenze,target_contratti,target_prod_danni,target_prod_vprot,target_prod_vpr,target_prod_vpu')
    .eq('advisor_user_id', advisor_user_id)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle()
  if (error && error.code!=='PGRST116') throw error
  if (!data) return { advisor_user_id, year, month, target_consulenze:0, target_contratti:0, target_prod_danni:0, target_prod_vprot:0, target_prod_vpr:0, target_prod_vpu:0 }
  return data as MonthlyGoals
}

async function getProgress(advisor_user_id:string, year:number): Promise<MonthlyProgress[]>{
  const { data, error } = await supabase
    .from('v_progress_monthly')
    .select('month,consulenze,contratti,prod_danni,prod_vprot,prod_vpr,prod_vpu')
    .eq('advisor_user_id', advisor_user_id)
    .eq('year', year)
    .order('month', { ascending:true })
  if (error) throw error
  const arr = (data||[]) as any[]
  // garantisce 12 mesi
  const byMonth: Record<number, MonthlyProgress> = {}
  for(let m=1;m<=12;m++) byMonth[m] = { month:m, consulenze:0, contratti:0, prod_danni:0, prod_vprot:0, prod_vpr:0, prod_vpu:0 }
  for(const r of arr){ byMonth[r.month] = { month:r.month, consulenze:r.consulenze, contratti:r.contratti, prod_danni:r.prod_danni, prod_vprot:r.prod_vprot, prod_vpr:r.prod_vpr, prod_vpu:r.prod_vpu } }
  return Object.values(byMonth).sort((a,b)=>a.month-b.month)
}

async function upsertAnnual(g: AnnualGoals){
  const { error } = await supabase.from('goals').upsert({ ...g }, { onConflict:'advisor_user_id,year' })
  if (error) throw error
}
async function upsertMonthly(g: MonthlyGoals){
  const { error } = await supabase.from('goals_monthly').upsert({ ...g }, { onConflict:'advisor_user_id,year,month' })
  if (error) throw error
}

function makeAnnual(advisor_user_id:string, year:number, patch:Partial<AnnualGoals>): AnnualGoals{
  return { advisor_user_id, year, target_consulenze:0, target_contratti:0, target_prod_danni:0, target_prod_vprot:0, target_prod_vpr:0, target_prod_vpu:0, ...patch }
}
function makeMonthly(advisor_user_id:string, year:number, month:number, patch:Partial<MonthlyGoals>): MonthlyGoals{
  return { advisor_user_id, year, month, target_consulenze:0, target_contratti:0, target_prod_danni:0, target_prod_vprot:0, target_prod_vpr:0, target_prod_vpu:0, ...patch }
}

function SparkCard({ label, data, fmt }:{ label:string; data:number[]; fmt?:'€' }){
  return (
    <div style={{ ...box }}>
      <div style={{ fontSize:12, color:'#666' }}>{label}</div>
      <Sparkline data={data} />
      <div style={{ marginTop:8, fontWeight:700 }}>{fmt==='€' ? formatCurrency(sum(data)) : sum(data)}</div>
    </div>
  )
}

function Sparkline({ data }:{ data:number[] }){
  if (!data || data.length===0) return null
  const max = Math.max(1, ...data)
  const pts = data.map((v,i)=>({ x: i*(100/(data.length-1||1)), y: 30 - (v/max)*30 }))
  const d = pts.map((p,i)=> (i===0?`M ${p.x},${p.y}`:` L ${p.x},${p.y}`)).join('')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width:'100%', height:40, marginTop:8 }}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  )
}

function sum(arr:number[]){ return arr.reduce((a,b)=>a+b,0) }
function formatCurrency(n:number){ try{ return new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n) }catch{ return `€ ${n.toFixed(0)}` } }
