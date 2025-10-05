import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'
/**
 * Dashboard.tsx — Step 2 (fix TS, user_id based)
 * Filtri: Advisor / Periodo (mese da - mese a, default ultimi 6 mesi)
 * KPI: contatti, appuntamenti, proposte, contratti, produzione per linee
 * Sparkline mensili sui KPI principali.
 */

type Advisor = { id: string; user_id: string; full_name: string | null; email: string; role: 'Admin'|'Team Lead'|'Junior'; team_lead_user_id?: string | null }

type Period = { fromMonthKey: string; toMonthKey: string }

type Buckets = string[]

type MonthAgg = { contacts:number; appointments:number; proposals:number; contracts:number; prod:number }

type Kpi = {
  contacts: number
  appointments: number
  proposals: number
  contracts: number
  prod_danni: number
  prod_vprot: number
  prod_vpr: number
  prod_vpu: number
  byMonth: Record<string, MonthAgg>
}

const box: React.CSSProperties = { background:'#fff', border:'1px solid #eee', borderRadius:16, padding:16 }
const btn: React.CSSProperties = { padding:'8px 10px', borderRadius:10, border:'1px solid #ddd', background:'#fff', cursor:'pointer' }
const ipt: React.CSSProperties = { padding:'10px 12px', borderRadius:10, border:'1px solid #ddd' }
const title: React.CSSProperties = { fontWeight:700, marginBottom:12 }
const grid: React.CSSProperties = { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12 }

export default function DashboardPage(){
  const [me, setMe] = useState<Advisor | null>(null)
  const [advisors, setAdvisors] = useState<Advisor[]>([])
  const [ownerFilter, setOwnerFilter] = useState<string>('me') // 'me' | 'team' | 'all' | user_id

  const defaultPeriod = useMemo(()=>makeDefaultPeriod(6), [])
  const [period, setPeriod] = useState<Period>(defaultPeriod)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')

  const [kpi, setKpi] = useState<Kpi|null>(null)

  useEffect(()=>{ (async()=>{
    setLoading(true); setError('')
    // utente corrente -> advisor
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

    // elenco advisors per filtro
    let advList: Advisor[] = []
    if (meAdv.role === 'Admin'){
      const { data, error } = await supabase.from('advisors').select('id,user_id,full_name,email,role,team_lead_user_id').order('full_name', { ascending:true })
      if (error){ setError(error.message); setLoading(false); return }
      advList = (data||[]) as any
    } else if (meAdv.role === 'Team Lead'){
      // me + i miei junior (user-based)
      const { data, error } = await supabase
        .from('advisors')
        .select('id,user_id,full_name,email,role,team_lead_user_id')
        .or(`user_id.eq.${meAdv.user_id},team_lead_user_id.eq.${meAdv.user_id}`)
        .order('full_name', { ascending:true })
      if (error){ setError(error.message); setLoading(false); return }
      advList = (data||[]) as any
      setOwnerFilter('team')
    } else {
      // Junior -> solo se stesso
      advList = [meAdv]
      setOwnerFilter('me')
    }
    setAdvisors(advList)
    setLoading(false)
  })() },[])

  // ricarica KPI quando cambiano filtri
  useEffect(()=>{ (async()=>{
    if (!me) return
    setLoading(true); setError('')
    try{
      const owners = ownersToQuery(ownerFilter, me, advisors)
      const leadIds = await fetchLeadIds(owners)
      const [acts, apps, props, ctrs] = await Promise.all([
        fetchActivities(leadIds, period),
        fetchAppointments(leadIds, period),
        fetchProposals(leadIds, period),
        fetchContracts(leadIds, period),
      ])
      const buckets = makeBuckets(period)
      const k = computeKpi(acts, apps, props, ctrs, buckets)
      setKpi(k)
    } catch(e:any){ setError(e.message || String(e)) }
    setLoading(false)
  })() }, [ownerFilter, period.fromMonthKey, period.toMonthKey, me?.user_id, advisors.length])

  const canSeeTeam = me?.role === 'Admin' || me?.role === 'Team Lead'

  return (
    <div style={{ display:'grid', gap:16 }}>
      <div style={title}>Dashboard</div>

      {/* FILTRI */}
      <div style={{ ...box }}>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
          {/* Advisor */}
          <div>
            <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Advisor</div>
            <select value={ownerFilter} onChange={e=>setOwnerFilter(e.target.value)} style={ipt}>
              <option value={'me'}>Solo me</option>
              {canSeeTeam && <option value={'team'}>Tutto il mio team</option>}
              {me?.role==='Admin' && <option value={'all'}>Tutti (azienda)</option>}
              {/* elenco singoli */}
              {advisors.map(a=> (
                <option key={a.user_id} value={a.user_id}>{a.full_name || a.email}</option>
              ))}
            </select>
          </div>
          {/* Periodo dal - al (mese) */}
          <div>
            <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Dal mese</div>
            <input type="month" value={period.fromMonthKey} onChange={e=>setPeriod(p=>({...p, fromMonthKey:e.target.value}))} style={ipt} />
          </div>
          <div>
            <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Al mese</div>
            <input type="month" value={period.toMonthKey} onChange={e=>setPeriod(p=>({...p, toMonthKey:e.target.value}))} style={ipt} />
          </div>
          <div style={{ alignSelf:'end' }}>
            <button style={btn} onClick={()=>setPeriod(makeDefaultPeriod(6))}>Reset ultimi 6 mesi</button>
          </div>
        </div>
        {me?.role==='Junior' && (
          <div style={{ marginTop:8, fontSize:12, color:'#888' }}>Nota: come Junior vedi solo i tuoi dati per le policy di sicurezza (RLS).</div>
        )}
      </div>

      {/* KPI CARDS */}
      <div style={grid}>
        <KpiCard label="Contatti" value={kpi?.contacts ?? 0} series={seriesFromKpi(kpi,'contacts')} />
        <KpiCard label="Appuntamenti (consulenze)" value={kpi?.appointments ?? 0} series={seriesFromKpi(kpi,'appointments')} />
        <KpiCard label="Proposte" value={kpi?.proposals ?? 0} series={seriesFromKpi(kpi,'proposals')} />
        <KpiCard label="Contratti" value={kpi?.contracts ?? 0} series={seriesFromKpi(kpi,'contracts')} />
      </div>

      {/* PRODUZIONE per linee */}
      <div style={grid}>
        <KpiCard label="Produzione Danni Non Auto" value={kpi?.prod_danni ?? 0} fmt="€" />
        <KpiCard label="Produzione Vita Protection" value={kpi?.prod_vprot ?? 0} fmt="€" />
        <KpiCard label="Produzione Vita Premi Ricorrenti" value={kpi?.prod_vpr ?? 0} fmt="€" />
        <KpiCard label="Produzione Vita Premi Unici" value={kpi?.prod_vpu ?? 0} fmt="€" />
      </div>

      {loading && <div>Caricamento…</div>}
      {error && <div style={{ color:'#c00' }}>{error}</div>}
    </div>
  )
}

function ownersToQuery(filter: string, me: Advisor, advisors: Advisor[]): string[] {
  if (filter==='me') return [me.user_id]
  if (filter==='all') return advisors.map(a=>a.user_id)
  if (filter==='team'){
    if (me.role==='Admin') return advisors.map(a=>a.user_id)
    if (me.role==='Team Lead') return advisors.filter(a=>a.user_id===me.user_id || a.team_lead_user_id===me.user_id).map(a=>a.user_id)
    return [me.user_id]
  }
  // singolo advisor (value è già un user_id)
  return [filter]
}

function makeDefaultPeriod(monthsBack: number): Period {
  const end = new Date()
  const endKey = toMonthKey(end)
  const start = new Date(end.getFullYear(), end.getMonth() - (monthsBack-1), 1)
  const startKey = toMonthKey(start)
  return { fromMonthKey: startKey, toMonthKey: endKey }
}

function toMonthKey(d: Date){
  const y = d.getFullYear()
  const m = (d.getMonth()+1).toString().padStart(2,'0')
  return `${y}-${m}`
}

function monthKeyRange(fromKey: string, toKey: string): { fromDateISO: string; toDateExclusiveISO: string }{
  const [fy,fm] = fromKey.split('-').map(Number)
  const [ty,tm] = toKey.split('-').map(Number)
  const from = new Date(fy, fm-1, 1)
  const toExclusive = new Date(ty, tm, 1) // primo giorno del mese successivo
  return { fromDateISO: from.toISOString(), toDateExclusiveISO: toExclusive.toISOString() }
}

function makeBuckets(p: Period): Buckets {
  const out: string[] = []
  const [fy,fm] = p.fromMonthKey.split('-').map(Number)
  const [ty,tm] = p.toMonthKey.split('-').map(Number)
  let y = fy, m = fm
  while (y < ty || (y===ty && m<=tm)){
    out.push(`${y}-${String(m).padStart(2,'0')}`)
    m++; if (m>12){ m=1; y++ }
  }
  return out
}

async function fetchLeadIds(ownerIds: string[]): Promise<string[]>{
  if (ownerIds.length===0) return []
  const { data, error } = await supabase.from('leads').select('id').in('owner_id', ownerIds)
  if (error) throw error
  return (data||[]).map((r:any)=>r.id)
}

async function fetchActivities(leadIds: string[], period: Period){
  if (leadIds.length===0) return []
  const { fromDateISO, toDateExclusiveISO } = monthKeyRange(period.fromMonthKey, period.toMonthKey)
  const { data, error } = await supabase.from('activities')
    .select('id,lead_id,ts')
    .in('lead_id', leadIds)
    .gte('ts', fromDateISO)
    .lt('ts', toDateExclusiveISO)
  if (error) throw error
  return data||[]
}
async function fetchAppointments(leadIds: string[], period: Period){
  if (leadIds.length===0) return []
  const { fromDateISO, toDateExclusiveISO } = monthKeyRange(period.fromMonthKey, period.toMonthKey)
  const { data, error } = await supabase.from('appointments')
    .select('id,lead_id,ts')
    .in('lead_id', leadIds)
    .gte('ts', fromDateISO)
    .lt('ts', toDateExclusiveISO)
  if (error) throw error
  return data||[]
}
async function fetchProposals(leadIds: string[], period: Period){
  if (leadIds.length===0) return []
  const { fromDateISO, toDateExclusiveISO } = monthKeyRange(period.fromMonthKey, period.toMonthKey)
  const { data, error } = await supabase.from('proposals')
    .select('id,lead_id,ts')
    .in('lead_id', leadIds)
    .gte('ts', fromDateISO)
    .lt('ts', toDateExclusiveISO)
  if (error) throw error
  return data||[]
}
async function fetchContracts(leadIds: string[], period: Period){
  if (leadIds.length===0) return []
  const { fromDateISO, toDateExclusiveISO } = monthKeyRange(period.fromMonthKey, period.toMonthKey)
  const { data, error } = await supabase.from('contracts')
    .select('id,lead_id,ts,contract_type,amount')
    .in('lead_id', leadIds)
    .gte('ts', fromDateISO)
    .lt('ts', toDateExclusiveISO)
  if (error) throw error
  return data||[]
}

function computeKpi(acts:any[], apps:any[], props:any[], ctrs:any[], buckets:Buckets): Kpi{
  const k: Kpi = {
    contacts: acts.length,
    appointments: apps.length,
    proposals: props.length,
    contracts: ctrs.length,
    prod_danni: 0, prod_vprot: 0, prod_vpr: 0, prod_vpu: 0,
    byMonth: {}
  }
  for(const b of buckets){ k.byMonth[b] = { contacts:0, appointments:0, proposals:0, contracts:0, prod:0 } }
  const monthOf = (iso: string)=> iso.slice(0,7)

  acts.forEach(a=>{ const m = monthOf(a.ts); if(k.byMonth[m]) k.byMonth[m].contacts++ })
  apps.forEach(a=>{ const m = monthOf(a.ts); if(k.byMonth[m]) k.byMonth[m].appointments++ })
  props.forEach(p=>{ const m = monthOf(p.ts); if(k.byMonth[m]) k.byMonth[m].proposals++ })
  ctrs.forEach(c=>{
    const m = monthOf(c.ts); if(k.byMonth[m]) k.byMonth[m].contracts++
    const amt = Number(c.amount||0)
    switch(c.contract_type){
      case 'Danni Non Auto': k.prod_danni += amt; break;
      case 'Vita Protection': k.prod_vprot += amt; break;
      case 'Vita Premi Ricorrenti': k.prod_vpr += amt; break;
      case 'Vita Premi Unici': k.prod_vpu += amt; break;
      default: break;
    }
    if (k.byMonth[m]) k.byMonth[m].prod += amt
  })
  return k
}

function KpiCard({ label, value, fmt, series }:{ label:string; value:number; fmt?:'€'; series?: number[] }){
  return (
    <div style={box}>
      <div style={{ fontSize:12, color:'#666' }}>{label}</div>
      <div style={{ fontSize:28, fontWeight:700, marginTop:4 }}>{fmt==='€' ? formatCurrency(value) : value}</div>
      {series && series.length>0 && <Sparkline data={series} />}
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

function seriesFromKpi(k: Kpi|null, key: keyof MonthAgg){
  if (!k) return [] as number[]
  const months = Object.keys(k.byMonth).sort()
  return months.map(m=> (k.byMonth[m] as any)[key] as number)
}

function formatCurrency(n:number){
  try{ return new Intl.NumberFormat('it-IT', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(n) }catch{ return `€ ${n.toFixed(0)}` }
}
