import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'

/**
 * Obiettivi — pagina unica per Admin / Team Lead / Junior
 *
 * Requisiti implementati:
 * a) Titolo pagina: "Obiettivi"
 * b) "Nr. Consulenze" → "Nr. Appuntamenti" (solo label; dati su stessa colonna target_consulenze)
 * c) Annuale/Mensile: prima riga = Nr. Appuntamenti + Nr. Contratti; seconda riga = produzione
 * d) Junior: possono vedere i propri Obiettivi (campi read-only, Reset/Salva nascosti)
 * e) Team Lead: non può modificare i propri obiettivi (solo quelli dei Junior del proprio team)
 * f) Filtro Advisor: NO Admin tra le opzioni; Admin/TL possono scegliere solo TL e Junior;
 *    i Junior vedono solo se stessi (select disabilitata con singola opzione)
 * g) Default: Admin vede un Team Lead; Team Lead e Junior vedono i propri obiettivi
 */

type Role = 'Admin'|'Team Lead'|'Junior'

type Advisor = {
  id: string
  user_id: string
  full_name: string | null
  email: string
  role: Role
  team_lead_user_id?: string | null
}

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

const box: React.CSSProperties  = { background:'#fff', border:'1px solid #eee', borderRadius:16, padding:16 }
const btn: React.CSSProperties  = { padding:'8px 10px', borderRadius:10, border:'1px solid #ddd', background:'#fff', cursor:'pointer' }
const cta: React.CSSProperties  = { padding:'10px 12px', borderRadius:10, border:'1px solid #111', background:'#111', color:'#fff', cursor:'pointer' }
const ipt: React.CSSProperties  = { padding:'10px 12px', borderRadius:10, border:'1px solid #ddd', width:'100%', boxSizing:'border-box', background:'#fff', color:'#111' }
const gridTwoRows: React.CSSProperties = { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))', gap:12 }
const title: React.CSSProperties = { fontWeight:700, marginBottom:12 }

export default function GoalsTLPage(){
  const [me, setMe] = useState<Advisor | null>(null)
  const [list, setList] = useState<Advisor[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const [advisorUserId, setAdvisorUserId] = useState<string>('')
  const [monthKey, setMonthKey] = useState<string>(toMonthKey(new Date())) // YYYY-MM

  const year  = useMemo(()=> Number(monthKey.slice(0,4)), [monthKey])
  const month = useMemo(()=> Number(monthKey.slice(5,7)), [monthKey])

  const [annual, setAnnual]   = useState<AnnualGoals | null>(null)
  const [monthly, setMonthly] = useState<MonthlyGoals | null>(null)
  const [progress, setProgress] = useState<MonthlyProgress[]>([])
  const [saving, setSaving] = useState(false)

  // ===== Bootstrap: me + lista advisors filtrata per ruolo (no Admin in lista selezionabile) =====
  useEffect(()=>{ (async()=>{
    setLoading(true); setError('')
    try{
      const u = await supabase.auth.getUser()
      const email = u.data.user?.email
      if (!email) throw new Error('Utente non autenticato')

      const { data: meRow, error: meErr } = await supabase
        .from('advisors')
        .select('id,user_id,full_name,email,role,team_lead_user_id')
        .eq('email', email)
        .maybeSingle()
      if (meErr || !meRow) throw new Error(meErr?.message || 'Advisor non trovato')

      const meAdv: Advisor = {
        id: meRow.id, user_id: meRow.user_id, full_name: meRow.full_name,
        email: meRow.email, role: meRow.role as Role, team_lead_user_id: meRow.team_lead_user_id
      }
      setMe(meAdv)

      let selectable: Advisor[] = []

      if (meAdv.role === 'Admin'){
        // Solo Team Lead + Junior, no Admin
        const { data, error } = await supabase
          .from('advisors')
          .select('id,user_id,full_name,email,role,team_lead_user_id')
          .in('role', ['Team Lead','Junior'] as Role[])
          .order('role', { ascending:false }) // TL prima
          .order('full_name', { ascending:true })
        if (error) throw error
        selectable = (data||[]) as Advisor[]

        // Default: mostra un Team Lead (se c'è), altrimenti un Junior
        const firstTL = selectable.find(a=>a.role==='Team Lead')
        setAdvisorUserId(firstTL?.user_id || selectable[0]?.user_id || '')
      }
      else if (meAdv.role === 'Team Lead'){
        // TL può vedere se stesso + i Junior del suo team; no Admin
        const { data, error } = await supabase
          .from('advisors')
          .select('id,user_id,full_name,email,role,team_lead_user_id')
          .or(`user_id.eq.${meAdv.user_id},team_lead_user_id.eq.${meAdv.user_id}`)
          .not('role','eq','Admin')
          .order('role', { ascending:false })
          .order('full_name', { ascending:true })
        if (error) throw error
        selectable = (data||[]) as Advisor[]

        // Default: i propri obiettivi
        setAdvisorUserId(meAdv.user_id)
      }
      else {
        // Junior: solo se stesso (read-only)
        selectable = [meAdv]
        setAdvisorUserId(meAdv.user_id)
      }

      setList(selectable)
    } catch(e:any){ setError(e.message || 'Errore inizializzazione') }
    finally{ setLoading(false) }
  })() },[])

  // ===== Caricamento dati (annual/monthly/progress) =====
  useEffect(()=>{ (async()=>{
    if (!advisorUserId || !year) return
    setError('')
    const ann = await getAnnual(advisorUserId, year)
    const mon = await getMonthly(advisorUserId, year, month)
    const prog = await getProgress(advisorUserId, year)
    setAnnual(ann); setMonthly(mon); setProgress(prog)
  })() }, [advisorUserId, year, month])

  // ===== Permessi =====
  const canEdit = useMemo(()=>{
    if (!me) return false
    if (me.role === 'Admin') return true
    if (me.role === 'Team Lead') return advisorUserId !== me.user_id // non può modificare i propri
    return false // Junior solo lettura
  }, [me, advisorUserId])

  const isJuniorView = me?.role === 'Junior'
  const advisorSelectDisabled = isJuniorView // i Junior vedono solo se stessi

  // ===== Azioni =====
  const onReset = async ()=>{
    if (!advisorUserId) return
    if (!canEdit) return
    if (!window.confirm('Resettare i campi alla situazione salvata?')) return
    const ann = await getAnnual(advisorUserId, year)
    const mon = await getMonthly(advisorUserId, year, month)
    setAnnual(ann); setMonthly(mon)
  }

  const onSave = async ()=>{
    try{
      if (!canEdit) return alert('Non autorizzato')
      if (!advisorUserId) return alert('Seleziona un advisor')
      setSaving(true)
      if (annual)  await upsertAnnual(annual)
      if (monthly) await upsertMonthly(monthly)
      alert('Obiettivi salvati')
    }catch(e:any){ setError(e.message || String(e)) }
    finally{ setSaving(false) }
  }

  const selectedAdv = useMemo(()=> list.find(t=>t.user_id===advisorUserId) || null, [list, advisorUserId])
  const ro = !canEdit ? { disabled:true, readOnly:true, style:{ ...ipt, background:'#f8fafc', color:'#555', cursor:'not-allowed' } as React.CSSProperties } : {}

  return (
    <div style={{ display:'grid', gap:16 }}>
      <div style={title}>Obiettivi</div>

      {error && <div style={{ color:'#c00' }}>{error}</div>}

      {/* FILTRI */}
      <div style={{ ...box }}>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'end' }}>
          <div>
            <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Advisor</div>
            <select value={advisorUserId} onChange={e=>setAdvisorUserId(e.target.value)} style={ipt} disabled={advisorSelectDisabled}>
              {isJuniorView ? (
                <option value={me?.user_id || ''}>{me?.full_name || me?.email}</option>
              ) : (
                <>
                  <option value="">—</option>
                  {list
                    .filter(a => a.role !== 'Admin') // sicurezza extra
                    .map(a => (
                      <option key={a.user_id} value={a.user_id}>
                        {a.full_name || a.email} {a.role!=='Junior' ? `(${a.role})` : ''}
                      </option>
                    ))
                  }
                </>
              )}
            </select>
          </div>

          <div>
            <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Mese</div>
            <input type="month" value={monthKey} onChange={(e)=>setMonthKey(e.target.value)} style={ipt} />
          </div>

          {!isJuniorView && (
            <div>
              <button style={btn} onClick={()=>setMonthKey(toMonthKey(new Date()))}>Mese corrente</button>
            </div>
          )}
        </div>
      </div>

      {/* ANNUALE */}
      <div style={box}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <div style={{ fontWeight:700 }}>
            Obiettivi Annuali — {selectedAdv ? (selectedAdv.full_name || selectedAdv.email) : '—'} — {year}
          </div>
          {canEdit && (
            <div style={{ display:'flex', gap:8 }}>
              <button style={btn} onClick={onReset}>Reset</button>
              <button style={cta} onClick={onSave} disabled={saving}>{saving?'Salvataggio…':'Salva'}</button>
            </div>
          )}
        </div>

        {/* Riga 1: Nr. Appuntamenti + Nr. Contratti */}
        <div style={gridTwoRows}>
          {annualInput('Nr. Appuntamenti', annual?.target_consulenze ?? 0, v=>setAnnual(p=>p?{...p,target_consulenze:v}:makeAnnual(advisorUserId,year,{target_consulenze:v})), ro)}
          {annualInput('Nr. Contratti',   annual?.target_contratti ?? 0, v=>setAnnual(p=>p?{...p,target_contratti:v}:makeAnnual(advisorUserId,year,{target_contratti:v})), ro)}
        </div>

        {/* Riga 2: Produzione */}
        <div style={{ ...gridTwoRows, marginTop:12 }}>
          {annualInput('Produzione Danni Non Auto (€)',      annual?.target_prod_danni ?? 0, v=>setAnnual(p=>p?{...p,target_prod_danni:v}:makeAnnual(advisorUserId,year,{target_prod_danni:v})), ro)}
          {annualInput('Produzione Vita Protection (€)',     annual?.target_prod_vprot ?? 0, v=>setAnnual(p=>p?{...p,target_prod_vprot:v}:makeAnnual(advisorUserId,year,{target_prod_vprot:v})), ro)}
          {annualInput('Produzione Vita Premi Ricorrenti (€)', annual?.target_prod_vpr ?? 0, v=>setAnnual(p=>p?{...p,target_prod_vpr:v}:makeAnnual(advisorUserId,year,{target_prod_vpr:v})), ro)}
          {annualInput('Produzione Vita Premi Unici (€)',    annual?.target_prod_vpu ?? 0, v=>setAnnual(p=>p?{...p,target_prod_vpu:v}:makeAnnual(advisorUserId,year,{target_prod_vpu:v})), ro)}
        </div>
      </div>

      {/* MENSILE */}
      <div style={box}>
        <div style={{ fontWeight:700, marginBottom:12 }}>Obiettivi Mensili — {monthKey}</div>

        {/* Riga 1: Nr. Appuntamenti + Nr. Contratti */}
        <div style={gridTwoRows}>
          {monthlyInput('Nr. Appuntamenti', monthly?.target_consulenze ?? 0, v=>setMonthly(p=>p?{...p,target_consulenze:v}:makeMonthly(advisorUserId,year,month,{target_consulenze:v})), ro)}
          {monthlyInput('Nr. Contratti',   monthly?.target_contratti ?? 0, v=>setMonthly(p=>p?{...p,target_contratti:v}:makeMonthly(advisorUserId,year,month,{target_contratti:v})), ro)}
        </div>

        {/* Riga 2: Produzione */}
        <div style={{ ...gridTwoRows, marginTop:12 }}>
          {monthlyInput('Produzione Danni Non Auto (€)',      monthly?.target_prod_danni ?? 0, v=>setMonthly(p=>p?{...p,target_prod_danni:v}:makeMonthly(advisorUserId,year,month,{target_prod_danni:v})), ro)}
          {monthlyInput('Produzione Vita Protection (€)',     monthly?.target_prod_vprot ?? 0, v=>setMonthly(p=>p?{...p,target_prod_vprot:v}:makeMonthly(advisorUserId,year,month,{target_prod_vprot:v})), ro)}
          {monthlyInput('Produzione Vita Premi Ricorrenti (€)', monthly?.target_prod_vpr ?? 0, v=>setMonthly(p=>p?{...p,target_prod_vpr:v}:makeMonthly(advisorUserId,year,month,{target_prod_vpr:v})), ro)}
          {monthlyInput('Produzione Vita Premi Unici (€)',    monthly?.target_prod_vpu ?? 0, v=>setMonthly(p=>p?{...p,target_prod_vpu:v}:makeMonthly(advisorUserId,year,month,{target_prod_vpu:v})), ro)}
        </div>
      </div>

      {/* PROGRESSO ANNO (spark) */}
      <div style={box}>
        <div style={{ fontWeight:700, marginBottom:8 }}>Andamento {year}</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(240px,1fr))', gap:12 }}>
          <SparkCard label="Appuntamenti" data={progress.map(p=>p.consulenze)} />
          <SparkCard label="Contratti"    data={progress.map(p=>p.contratti)} />
          <SparkCard label="Produzione (€)" data={progress.map(p=> (p.prod_danni+p.prod_vprot+p.prod_vpr+p.prod_vpu))} fmt="€" />
        </div>
      </div>
    </div>
  )
}

/* ====== UI helpers ====== */

function annualInput(label:string, value:number, onChange:(v:number)=>void, ro:any){
  return (
    <div>
      <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>{label}</div>
      <input type="number" value={value} onChange={e=>onChange(Number(e.target.value||0))} style={ro.style||ipt} disabled={ro.disabled} readOnly={ro.readOnly}/>
    </div>
  )
}
function monthlyInput(label:string, value:number, onChange:(v:number)=>void, ro:any){
  return (
    <div>
      <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>{label}</div>
      <input type="number" value={value} onChange={e=>onChange(Number(e.target.value||0))} style={ro.style||ipt} disabled={ro.disabled} readOnly={ro.readOnly}/>
    </div>
  )
}

function toMonthKey(d: Date){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); return `${y}-${m}` }

/* ====== Data access (uguali alla versione precedente) ====== */
async function getAnnual(advisor_user_id:string, year:number): Promise<AnnualGoals>{
  const { data, error } = await supabase
    .from('goals')
    .select('advisor_user_id,year,target_consulenze,target_contratti,target_prod_danni,target_prod_vprot,target_prod_vpr,target_prod_vpu')
    .eq('advisor_user_id', advisor_user_id)
    .eq('year', year)
    .maybeSingle()
  if (error && error.code!=='PGRST116') throw error
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

/* Spark mini-chart */
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
