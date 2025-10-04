import React from 'react'
import { supabase } from '../supabaseClient'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts'

type Role = 'Admin' | 'TeamLead' | 'Advisor'

export default function Dashboard() {
  const [me, setMe] = React.useState<{ id: string; email: string; role: Role } | null>(null)
  const [advisors, setAdvisors] = React.useState<any[]>([])
  const [advisorFilter, setAdvisorFilter] = React.useState<string>('ALL')
  const [startYm, setStartYm] = React.useState<string>(defaultStartYm())
  const [endYm, setEndYm] = React.useState<string>(currentYm())
  const [loading, setLoading] = React.useState<boolean>(true)
  const [error, setError] = React.useState<string>('')
  const [metrics, setMetrics] = React.useState<{leads:number; contacts:number; appointments:number; proposals:number; contracts:number}>({ leads:0, contacts:0, appointments:0, proposals:0, contracts:0 })

  // bootstrap: utente + elenco advisors; default filtro
  React.useEffect(()=>{ (async()=>{
    setLoading(true); setError('')
    const { data: u } = await supabase.auth.getUser()
    const email = u.user?.email
    if (!email){ setError('Utente non autenticato'); setLoading(false); return }
    const { data: meRow, error: meErr } = await supabase.from('advisors').select('id,email,role').eq('email', email).maybeSingle()
    if (meErr || !meRow){ setError(meErr?.message || 'Advisor non trovato'); setLoading(false); return }
    setMe(meRow as any)

    const { data: all } = await supabase.from('advisors').select('id,full_name,role,reports_to')
    setAdvisors(all || [])

    if ((meRow.role as Role) === 'Advisor') setAdvisorFilter(meRow.id)
    else setAdvisorFilter('ALL')

    setLoading(false)
  })() }, [])

  // IDs selezionabili (in base al ruolo)
  const teamIds = React.useMemo(()=>{
    if (!me) return [] as string[]
    if (me.role === 'Admin') return advisors.map(a=>a.id)
    if (me.role === 'TeamLead') return [me.id, ...advisors.filter(a=>a.reports_to===me.id).map(a=>a.id)]
    return [me.id]
  }, [me, advisors])

  const selectableAdvisors = React.useMemo(()=>{
    if (!me) return [] as any[]
    if (me.role === 'Admin') return advisors
    if (me.role === 'TeamLead') return advisors.filter(a=>a.id===me.id || a.reports_to===me.id)
    return advisors.filter(a=>a.id===me.id)
  }, [me, advisors])

  const ymToDate = (ym:string, end:boolean)=>{
    const [y,m] = ym.split('-').map(n=>parseInt(n,10))
    if (!end) return new Date(Date.UTC(y, m-1, 1, 0,0,0))
    return new Date(Date.UTC(y, m, 0, 23,59,59)) // ultimo giorno mese
  }

  const loadMetrics = React.useCallback(async ()=>{
    if (!me) return
    setLoading(true); setError('')
    try{
      const ids = advisorFilter==='ALL' ? teamIds : [advisorFilter]
      if (!ids.length){ setMetrics({leads:0,contacts:0,appointments:0,proposals:0,contracts:0}); setLoading(false); return }

      const start = ymToDate(startYm,false).toISOString()
      const end = ymToDate(endYm,true).toISOString()

      // Leads creati
      const { count: leadsCount, error: e1 } = await supabase
        .from('leads')
        .select('id', { count:'exact', head:true })
        .in('owner_id', ids)
        .gte('created_at', start)
        .lte('created_at', end)
      if (e1) throw e1

      // Recupero lead IDs per il resto dei conteggi
      const { data: leadsForIds, error: e2b } = await supabase
        .from('leads')
        .select('id')
        .in('owner_id', ids)
      if (e2b) throw e2b
      const leadIds = (leadsForIds||[]).map(x=>x.id)
      const safeLeadIds = leadIds.length ? leadIds : ['00000000-0000-0000-0000-000000000000']

      // Contacts (activities.ts)
      const { count: contCount, error: e2c } = await supabase
        .from('activities')
        .select('id',{ count:'exact', head:true })
        .in('lead_id', safeLeadIds)
        .gte('ts', start).lte('ts', end)
      if (e2c) throw e2c

      // Appointments
      const { count: appCount, error: e3 } = await supabase
        .from('appointments')
        .select('id',{ count:'exact', head:true })
        .in('lead_id', safeLeadIds)
        .gte('ts', start).lte('ts', end)
      if (e3) throw e3

      // Proposals / Contracts con colonne data (YYYY-MM-DD)
      const startDate = start.slice(0,10)
      const endDate = end.slice(0,10)

      const { count: propCount, error: e4 } = await supabase
        .from('proposals')
        .select('id',{ count:'exact', head:true })
        .in('lead_id', safeLeadIds)
        .gte('ts', startDate).lte('ts', endDate)
      if (e4) throw e4

      const { count: contrCount, error: e5 } = await supabase
        .from('contracts')
        .select('id',{ count:'exact', head:true })
        .in('lead_id', safeLeadIds)
        .gte('ts', startDate).lte('ts', endDate)
      if (e5) throw e5

      setMetrics({
        leads: leadsCount || 0,
        contacts: contCount || 0,
        appointments: appCount || 0,
        proposals: propCount || 0,
        contracts: contrCount || 0
      })
    }catch(e:any){
      setError(e.message || String(e))
    }finally{
      setLoading(false)
    }
  }, [me, advisorFilter, startYm, endYm, teamIds])

  React.useEffect(()=>{ loadMetrics() }, [loadMetrics])

  const data = React.useMemo(() => [
    { name: 'Leads', value: metrics.leads },
    { name: 'Contatti', value: metrics.contacts },
    { name: 'Appuntamenti', value: metrics.appointments },
    { name: 'Proposte', value: metrics.proposals },
    { name: 'Contratti', value: metrics.contracts }
  ], [metrics])

  return (
    <div style={{ display:'grid', gap:16 }}>
      <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
        <div style={{ fontWeight:700, marginRight:8 }}>Dashboard</div>

        {/* Advisor filter */}
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <label style={{ fontSize:12, color:'#666' }}>Advisor</label>
          <select value={advisorFilter} onChange={e=>setAdvisorFilter(e.target.value)} style={iptMini}>
            {me?.role !== 'Advisor' && <option value="ALL">{me?.role==='Admin' ? 'Tutti' : 'Tutti (mio team)'}</option>}
            {selectableAdvisors.map(a => (
              <option key={a.id} value={a.id}>{a.full_name} — {a.role}</option>
            ))}
          </select>
        </div>

        {/* Period filter */}
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <label style={{ fontSize:12, color:'#666' }}>Periodo</label>
          <input type="month" value={startYm} onChange={e=>setStartYm(e.target.value)} style={iptMini} />
          <span>→</span>
          <input type="month" value={endYm} onChange={e=>setEndYm(e.target.value)} style={iptMini} />
          <button onClick={()=>{ setStartYm(defaultStartYm()); setEndYm(currentYm()) }} style={btnLite}>Ultimi 6 mesi</button>
        </div>

        <button onClick={loadMetrics} style={btnPrimary} disabled={loading}>{loading? 'Aggiorno…':'Aggiorna'}</button>
      </div>

      {error && <div style={{ color:'#c00' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <Stat label="Leads" value={metrics.leads} />
        <Stat label="Contatti" value={metrics.contacts} />
        <Stat label="Appuntamenti" value={metrics.appointments} />
        <Stat label="Proposte" value={metrics.proposals} />
        <Stat label="Contratti" value={metrics.contracts} />
      </div>

      <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 16, padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Funnel</div>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={data}>
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="value" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function defaultStartYm(){
  const d = new Date(); d.setUTCMonth(d.getUTCMonth()-5)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`
}
function currentYm(){
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`
}

const iptMini: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd' }
const btnPrimary: React.CSSProperties = { padding:'8px 12px', borderRadius:10, border:'1px solid #111', background:'#111', color:'#fff', cursor:'pointer' }
const btnLite: React.CSSProperties = { padding:'8px 12px', borderRadius:10, border:'1px solid #ddd', background:'#fff', color:'#111', cursor:'pointer' }

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 16, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800 }}>{value}</div>
    </div>
  )
}
