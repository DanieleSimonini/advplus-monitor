import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * Dashboard.tsx — Funnel + "Lead non contattati" (Step extra)
 * - Filtri Advisor (Me/Team/All) e Periodo (mese da / a)
 * - KPI esistenti + grafico ad imbuto (Leads → Contatti → Appuntamenti → Proposte → Contratti)
 * - Riquadro evidenziato "Lead non contattati" (owner-scope aware; per i Junior mostra solo i propri)
 */

type Role = 'Admin'|'Team Lead'|'Junior'

type Advisor = { id?: string; user_id: string; full_name: string|null; email: string; role: Role; team_lead_user_id?: string|null }

type Period = { fromMonthKey: string; toMonthKey: string }

type Kpi = {
  contacts: number
  appointments: number
  proposals: number
  contracts: number
  prodDanni: number
  prodVProt: number
  prodVPR: number
  prodVPU: number
}

function addMonths(ym: string, delta: number){
  const [y,m] = ym.split('-').map(Number)
  const d = new Date(y, m-1+delta, 1)
  const y2 = d.getFullYear(), m2 = (d.getMonth()+1).toString().padStart(2,'0')
  return `${y2}-${m2}`
}
function defaultPeriod(): Period{
  // ultimi 6 mesi inclusi → from = now-5m; to = now
  const now = new Date()
  const ym = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}`
  return { fromMonthKey: addMonths(ym, -5), toMonthKey: ym }
}
function monthKeyToRange(ym: string){
  const [y,m] = ym.split('-').map(Number)
  const start = new Date(y, m-1, 1)
  const end = new Date(y, m, 1) // esclusivo
  return { start: start.toISOString(), end: end.toISOString() }
}
function periodToRange(p: Period){
  const a = monthKeyToRange(p.fromMonthKey)
  const b = monthKeyToRange(p.toMonthKey)
  // uniamo start del primo e end dell'ultimo mese
  return { start: a.start, end: b.end }
}

function ownersToQuery(scope: 'me'|'team'|'all', me: Advisor|null, advisors: Advisor[]): string[]{
  if (!me) return []
  if (me.role==='Junior') return [me.user_id]
  if (scope==='me') return [me.user_id]
  if (scope==='team'){
    const team = advisors.filter(a=> a.team_lead_user_id===me.user_id || a.user_id===me.user_id)
    return team.map(a=>a.user_id)
  }
  // all
  return advisors.map(a=>a.user_id)
}

async function fetchLeadIds(ownerIds: string[]): Promise<string[]>{
  if (!ownerIds.length) return []
  const { data, error } = await supabase.from('leads').select('id').in('owner_id', ownerIds)
  if (error) return []
  return (data||[]).map(r=>r.id)
}

async function countIn(table: 'activities'|'appointments'|'proposals'|'contracts', leadIds: string[], startIso: string, endIso: string){
  if (!leadIds.length) return 0
  const { count } = await supabase
    .from(table)
    .select('id', { count:'exact', head:true })
    .in('lead_id', leadIds)
    .gte('ts', startIso)
    .lt('ts', endIso)
  return count||0
}

async function sumContractsByType(leadIds: string[], startIso: string, endIso: string, types: string[]){
  if (!leadIds.length) return 0
  const { data, error } = await supabase
    .from('contracts')
    .select('amount, contract_type, ts')
    .in('lead_id', leadIds)
    .in('contract_type', types)
    .gte('ts', startIso).lt('ts', endIso)
  if (error || !data) return 0
  return data.reduce((s,r)=> s + Number(r.amount||0), 0)
}

async function countLeadsCreated(ownerIds: string[], startIso: string, endIso: string){
  if (!ownerIds.length) return 0
  const { count } = await supabase
    .from('leads')
    .select('id', { count:'exact', head:true })
    .in('owner_id', ownerIds)
    .gte('created_at', startIso)
    .lt('created_at', endIso)
  return count||0
}

async function countLeadsNeverContacted(ownerIds: string[]): Promise<number>{
  if (!ownerIds.length) return 0
  // all-time: lead senza alcuna activity
  const { data, error } = await supabase
    .from('leads')
    .select('id')
    .in('owner_id', ownerIds)
  if (error || !data) return 0
  const leadIds = data.map(d=>d.id)
  if (!leadIds.length) return 0
  const { data: acts } = await supabase
    .from('activities')
    .select('lead_id')
    .in('lead_id', leadIds)
  const contacted = new Set((acts||[]).map(a=>a.lead_id))
  return leadIds.filter(id=> !contacted.has(id)).length
}

function formatNumber(n:number){ return new Intl.NumberFormat('it-IT').format(n) }
function formatCurrency(n:number){ return new Intl.NumberFormat('it-IT',{ style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(n) }

function Funnel({ steps }:{ steps: { label:string; value:number }[] }){
  const max = Math.max(1, ...steps.map(s=>s.value))
  return (
    <div style={{ display:'grid', gap:8 }}>
      {steps.map((s,i)=>{
        const w = Math.max(6, Math.round((s.value/max)*100))
        return (
          <div key={s.label} style={{ display:'grid', gap:6 }}>
            <div style={{ fontSize:12, color:'var(--muted,#666)', display:'flex', justifyContent:'space-between' }}>
              <span>{s.label}</span>
              <strong>{formatNumber(s.value)}</strong>
            </div>
            <div style={{ height:18, background:'var(--border,#eee)', borderRadius:10, overflow:'hidden' }}>
              <div style={{ width:`${w}%`, height:'100%', background:'#0b57d0', transition:'width .3s' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function DashboardPage(){
  const [me, setMe] = useState<Advisor|null>(null)
  const [advisors, setAdvisors] = useState<Advisor[]>([])
  const [ownerFilter, setOwnerFilter] = useState<'me'|'team'|'all'>('me')
  const [period, setPeriod] = useState<Period>(defaultPeriod())

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // KPI base
  const [kpi, setKpi] = useState<Kpi|null>(null)
  // Funnel + Not Contacted
  const [funnel, setFunnel] = useState<{leads:number; contacts:number; appointments:number; proposals:number; contracts:number}>({leads:0,contacts:0,appointments:0,proposals:0,contracts:0})
  const [notContacted, setNotContacted] = useState<number>(0)

  // bootstrap me+advisors
  useEffect(()=>{ (async()=>{
    setLoading(true)
    try{
      const u = await supabase.auth.getUser()
      const uid = u.data.user?.id
      if (uid){
        const { data: meRow } = await supabase.from('advisors').select('user_id,email,full_name,role,team_lead_user_id').eq('user_id', uid).maybeSingle()
        if (meRow) setMe(meRow as any)
      }
      const { data: adv } = await supabase.from('advisors').select('user_id,email,full_name,role,team_lead_user_id')
      setAdvisors((adv||[]) as any)
    } finally { setLoading(false) }
  })() },[])

  const owners = useMemo(()=> ownersToQuery(ownerFilter, me, advisors), [ownerFilter, me, advisors])
  const { start, end } = useMemo(()=> periodToRange(period), [period])

  // ricarica KPI + funnel + notContacted quando cambiano filtri
  useEffect(()=>{ (async()=>{
    if (!owners.length) return
    setLoading(true); setError('')
    try{
      const leadIds = await fetchLeadIds(owners)
      // KPI base
      const [contacts, appointments, proposals, contracts] = await Promise.all([
        countIn('activities', leadIds, start, end),
        countIn('appointments', leadIds, start, end),
        countIn('proposals', leadIds, start, end),
        countIn('contracts', leadIds, start, end),
      ])
      const [prodDanni, prodVProt, prodVPR, prodVPU] = await Promise.all([
        sumContractsByType(leadIds, start, end, ['Danni Non Auto']),
        sumContractsByType(leadIds, start, end, ['Vita Protection']),
        sumContractsByType(leadIds, start, end, ['Vita Premi Ricorrenti']),
        sumContractsByType(leadIds, start, end, ['Vita Premi Unici']),
      ])
      setKpi({ contacts, appointments, proposals, contracts, prodDanni, prodVProt, prodVPR, prodVPU })

      // Funnel
      const leadsCreated = await countLeadsCreated(owners, start, end)
      setFunnel({ leads: leadsCreated, contacts, appointments, proposals, contracts })

      // Lead mai contattati (all-time per scope selezionato)
      const nc = await countLeadsNeverContacted(owners)
      setNotContacted(nc)
    } catch(e:any){ setError(e.message||'Errore caricamento KPI') }
    finally{ setLoading(false) }
  })() }, [owners.join(','), start, end])

  return (
    <div style={{ display:'grid', gap:16 }}>
      {/* Filtri */}
      <div style={{ display:'flex', gap:12, alignItems:'end', flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:12, color:'var(--muted,#666)' }}>Advisor</div>
          <select value={ownerFilter} onChange={e=>setOwnerFilter(e.target.value as any)} style={{ padding:'6px 10px', border:'1px solid #ddd', borderRadius:8 }}>
            <option value="me">Solo me</option>
            {(me?.role!=='Junior') && <option value="team">Il mio Team</option>}
            {(me?.role==='Admin') && <option value="all">Tutti</option>}
          </select>
        </div>
        <div>
          <div style={{ fontSize:12, color:'var(--muted,#666)' }}>Dal mese</div>
          <input type="month" value={period.fromMonthKey} onChange={e=>setPeriod(p=>({ ...p, fromMonthKey:e.target.value }))} style={{ padding:'6px 10px', border:'1px solid #ddd', borderRadius:8 }} />
        </div>
        <div>
          <div style={{ fontSize:12, color:'var(--muted,#666)' }}>Al mese</div>
          <input type="month" value={period.toMonthKey} onChange={e=>setPeriod(p=>({ ...p, toMonthKey:e.target.value }))} style={{ padding:'6px 10px', border:'1px solid #ddd', borderRadius:8 }} />
        </div>
      </div>

      {error && <div style={{ padding:10, background:'#fee', border:'1px solid #fbb', borderRadius:8, color:'#900' }}>{error}</div>}

      {/* KPI cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:12 }}>
        <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:12, padding:12 }}>
          <div style={{ fontSize:12, color:'#666' }}>Contatti</div>
          <div style={{ fontSize:24, fontWeight:700 }}>{formatNumber(kpi?.contacts||0)}</div>
        </div>
        <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:12, padding:12 }}>
          <div style={{ fontSize:12, color:'#666' }}>Appuntamenti</div>
          <div style={{ fontSize:24, fontWeight:700 }}>{formatNumber(kpi?.appointments||0)}</div>
        </div>
        <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:12, padding:12 }}>
          <div style={{ fontSize:12, color:'#666' }}>Proposte</div>
          <div style={{ fontSize:24, fontWeight:700 }}>{formatNumber(kpi?.proposals||0)}</div>
        </div>
        <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:12, padding:12 }}>
          <div style={{ fontSize:12, color:'#666' }}>Contratti</div>
          <div style={{ fontSize:24, fontWeight:700 }}>{formatNumber(kpi?.contracts||0)}</div>
        </div>
        {/* KPI speciale: Lead non contattati */}
        <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:12, padding:12 }}>
          <div style={{ fontSize:12, color:'#92400e' }}>Lead non contattati</div>
          <div style={{ fontSize:24, fontWeight:800, color:'#92400e' }}>{formatNumber(notContacted)}</div>
          <div style={{ fontSize:11, color:'#a16207' }}>Opportunità da lavorare</div>
        </div>
      </div>

      {/* Produzione per linee */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
        <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:12, padding:12 }}>
          <div style={{ fontSize:12, color:'#666' }}>Prod. Danni Non Auto</div>
          <div style={{ fontSize:20, fontWeight:700 }}>{formatCurrency(kpi?.prodDanni||0)}</div>
        </div>
        <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:12, padding:12 }}>
          <div style={{ fontSize:12, color:'#666' }}>Prod. Vita Protection</div>
          <div style={{ fontSize:20, fontWeight:700 }}>{formatCurrency(kpi?.prodVProt||0)}</div>
        </div>
        <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:12, padding:12 }}>
          <div style={{ fontSize:12, color:'#666' }}>Prod. Vita Premi Ricorrenti</div>
          <div style={{ fontSize:20, fontWeight:700 }}>{formatCurrency(kpi?.prodVPR||0)}</div>
        </div>
        <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:12, padding:12 }}>
          <div style={{ fontSize:12, color:'#666' }}>Prod. Vita Premi Unici</div>
          <div style={{ fontSize:20, fontWeight:700 }}>{formatCurrency(kpi?.prodVPU||0)}</div>
        </div>
      </div>

      {/* Funnel */}
      <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:12, padding:16 }}>
        <div style={{ fontWeight:700, marginBottom:8 }}>Imbuto di conversione</div>
        <Funnel steps={[
          { label:'Leads', value: funnel.leads },
          { label:'Contatti', value: funnel.contacts },
          { label:'Appuntamenti', value: funnel.appointments },
          { label:'Proposte', value: funnel.proposals },
          { label:'Contratti', value: funnel.contracts },
        ]} />
      </div>
    </div>
  )
}
