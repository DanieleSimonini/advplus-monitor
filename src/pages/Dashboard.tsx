import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * Dashboard.tsx — Funnel + "Lead non contattati" (UX migliorata)
 * - Filtri Advisor (Solo me / Tutti / Team Lead / Junior) e Periodo (mese da / a)
 * - KPI + grafico ad imbuto vero (trapezi SVG con % di conversione)
 * - Riquadro evidenziato "Lead non contattati" (scope-aware)
 */

type Role = 'Admin'|'Team Lead'|'Junior'

type Advisor = { id?: string; user_id: string; full_name: string|null; email: string; role: Role; team_lead_user_id?: string|null }

type Period = { fromMonthKey: string; toMonthKey: string }

// ✅ Nuovo tipo filtro owner
type OwnerFilter =
  | { type: 'me' }
  | { type: 'all' }
  | { type: 'user', userId: string }      // Junior singolo
  | { type: 'teamlead', userId: string }  // Team Lead (TL + junior del TL)

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

// 🔁 Filtro owners aggiornato alle nuove opzioni
function ownersToQuery(sel: OwnerFilter, me: Advisor|null, advisors: Advisor[]): string[]{
  if (!me) return []

  if (sel.type === 'me') return [me.user_id]
  if (sel.type === 'all') return advisors.map(a => a.user_id)
  if (sel.type === 'user') return [sel.userId]
  if (sel.type === 'teamlead') {
    const team = advisors.filter(a => a.user_id === sel.userId || a.team_lead_user_id === sel.userId)
    return team.map(a => a.user_id)
  }
  return []
}

async function fetchLeadIds(ownerIds: string[]): Promise<string[]>{
  if (!ownerIds.length) return []
  const { data } = await supabase.from('leads').select('id').in('owner_id', ownerIds)
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

// ➕ formattazione percentuali
function formatPercent(n:number){
  return new Intl.NumberFormat('it-IT', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(n) + ' %'
}

/**
 * Funnel a trapezi SVG con % conversione
 */
function Funnel({ steps }:{ steps: { label:string; value:number }[] }) {
  // Allineamento etichette/trapezi: stessa griglia a righe fisse
  const max = Math.max(1, ...steps.map(s => s.value))
  const rowH = 64          // altezza di ogni fascia (etichetta + trapezio)
  const padX = 12
  const labelW = 164
  const width = 560
  const totalH = steps.length * rowH

  const pill: React.CSSProperties = {
    padding: '6px 10px',
    borderRadius: 999,
    border: '1px solid #e5e7eb',
    background: '#f8fafc',
    display: 'inline-flex',
    gap: 6,
    alignItems: 'baseline'
  }

  const conv = steps.map((s, i) => {
    if (i === 0) return 0
    const from = steps[i - 1].value || 0
    const to = s.value || 0
    return from > 0 ? Math.round((to / from) * 100) : 0
  })

  return (
    <div className="brand-card" style={{ background:'#fff', border:'1px solid #eee', borderRadius:16, padding:16 }}>
      <div style={{ fontWeight:700, marginBottom:12 }}>Imbuto di conversione</div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `${labelW}px ${width}px`,
          gridTemplateRows: `repeat(${steps.length}, ${rowH}px)`,
          columnGap: 12,
          rowGap: 0,
          alignItems: 'center'
        }}
      >
        {/* Colonna etichette (una riga = una fascia) */}
        {steps.map((s, i) => (
          <div key={`lbl-${s.label}`} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <div style={{ fontSize:13, fontWeight:600 }}>{s.label}</div>
              <div style={{ fontSize:12, color:'#6b7280' }}>{new Intl.NumberFormat('it-IT').format(s.value)}</div>
            </div>
            {i > 0 && (
              <div style={pill}>
                <span style={{ fontSize:11, color:'#6b7280' }}>→</span>
                <strong style={{ fontSize:14 }}>{conv[i]}%</strong>
              </div>
            )}
          </div>
        ))}

        {/* Colonna funnel: un solo SVG che occupa tutte le righe */}
        <svg
          width={width}
          height={totalH}
          viewBox={`0 0 ${width} ${totalH}`}
          role="img"
          aria-label="Funnel"
          style={{ gridColumn: 2, gridRow: `1 / span ${steps.length}` }}
        >
          <defs>
            <linearGradient id="gFunnel" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0b57d0" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#0b57d0" stopOpacity="0.55" />
            </linearGradient>
          </defs>

          {steps.map((s, i) => {
            // larghezze relative rispetto al massimo
            const topW = i === 0 ? (width - padX * 2)
                                 : (width - padX * 2) * (steps[i - 1].value / max)
            const botW = (width - padX * 2) * (s.value / max)

            // ogni fascia è centrata verticalmente nella sua riga
            const yCenter = i * rowH + rowH / 2
            const bandH = rowH - 14
            const yTop = yCenter - bandH / 2
            const yBot = yCenter + bandH / 2

            const xTop = (width - topW) / 2
            const xBot = (width - botW) / 2

            return (
              <g key={`poly-${s.label}`}>
                <polygon
                  points={`${xTop},${yTop} ${xTop + topW},${yTop} ${xBot + botW},${yBot} ${xBot},${yBot}`}
                  fill="url(#gFunnel)"
                  stroke="#e5e7eb"
                  strokeWidth="1"
                />
                <text
                  x={width / 2}
                  y={yCenter}
                  dominantBaseline="middle"
                  textAnchor="middle"
                  fontSize="13"
                  fill="#0f172a"
                >
                  {new Intl.NumberFormat('it-IT').format(s.value)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

export default function DashboardPage(){
  const [me, setMe] = useState<Advisor|null>(null)
  const [advisors, setAdvisors] = useState<Advisor[]>([])

  // 🔁 nuovo stato filtro
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>({ type:'me' })
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

  // 🔁 helper: parsing e valore stringa della select
  function parseOwnerValue(v: string): OwnerFilter {
    if (v === 'me') return { type:'me' }
    if (v === 'all') return { type:'all' }
    if (v.startsWith('tl:')) return { type:'teamlead', userId: v.slice(3) }
    if (v.startsWith('u:')) return { type:'user', userId: v.slice(2) }
    return { type:'me' }
  }

  const ownerValue = useMemo(() => {
    if (ownerFilter.type==='me') return 'me'
    if (ownerFilter.type==='all') return 'all'
    if (ownerFilter.type==='teamlead') return `tl:${ownerFilter.userId}`
    if (ownerFilter.type==='user') return `u:${ownerFilter.userId}`
    return 'me'
  }, [ownerFilter])

  const teamLeads = useMemo(() => advisors.filter(a => a.role === 'Team Lead'), [advisors])
  const juniors   = useMemo(() => advisors.filter(a => a.role === 'Junior'), [advisors])

  // 🔁 NEW: solo i Junior del mio team (per TL)
  const myTeamJuniors = useMemo(() => {
    if (!me) return []
    return advisors.filter(a => a.team_lead_user_id === me.user_id)
  }, [advisors, me])

  const owners = useMemo(
    () => ownersToQuery(ownerFilter, me, advisors),
    // dipendo da ownerValue per semplicità (è derivato da ownerFilter e cambia insieme)
    [ownerValue, me, advisors]
  )
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

  // ➕ Calcolo tassi percentuali per il pannello a destra
  const activationRate = funnel.leads > 0
    ? (funnel.contracts / funnel.leads) * 100
    : 0

  const closingRate = funnel.appointments > 0
    ? (funnel.contracts / funnel.appointments) * 100
    : 0

  const conversionRate = funnel.contacts > 0
    ? (funnel.contracts / funnel.contacts) * 100
    : 0

  return (
    <div style={{ display:'grid', gap:16 }}>
      {/* Filtri */}
      <div style={{ display:'flex', gap:12, alignItems:'end', flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:12, color:'var(--muted,#666)' }}>Advisor</div>
          <select
            value={ownerValue}
            onChange={e=>setOwnerFilter(parseOwnerValue(e.target.value))}
            style={{ padding:'6px 10px', border:'1px solid #ddd', borderRadius:8 }}
          >
            {/* Sempre visibile */}
            <option value="me">Solo me</option>

            {/* ADMIN → comportamento invariato (opzioni globali) */}
            {(me?.role==='Admin') && <option value="all">Tutti</option>}

            {(me?.role==='Admin') && teamLeads.length > 0 && (
              <optgroup label="Team Lead">
                {teamLeads.map(tl => (
                  <option key={tl.user_id} value={`tl:${tl.user_id}`}>
                    {tl.full_name || tl.email}
                  </option>
                ))}
              </optgroup>
            )}

            {(me?.role==='Admin') && juniors.length > 0 && (
              <optgroup label="Junior">
                {juniors.map(j => (
                  <option key={j.user_id} value={`u:${j.user_id}`}>
                    {j.full_name || j.email}
                  </option>
                ))}
              </optgroup>
            )}

            {/* TEAM LEAD → stesse sezioni ma ristrette al proprio team */}
            {(me?.role==='Team Lead') && (
              <>
                {/* "Totale team" (TL + suoi junior) */}
                <option value={`tl:${me.user_id}`}>Totale team</option>

                {/* Sezione Team Lead (solo se stesso, in scope di team) */}
                <optgroup label="Team Lead">
                  <option value={`tl:${me.user_id}`}>
                    {me.full_name || me.email}
                  </option>
                </optgroup>

                {/* Solo i propri junior */}
                {myTeamJuniors.length > 0 && (
                  <optgroup label="Junior">
                    {myTeamJuniors.map(j => (
                      <option key={j.user_id} value={`u:${j.user_id}`}>
                        {j.full_name || j.email}
                      </option>
                    ))}
                  </optgroup>
                )}
              </>
            )}
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
        <div style={{ background:'#F5FBFF', border:'1px solid #BFE4FF', borderRadius:12, padding:12 }}>
          <div style={{ fontSize:12, color:'#0b57d0' }}>Lead non contattati</div>
          <div style={{ fontSize:24, fontWeight:800, color:'#0b57d0' }}>{formatNumber(notContacted)}</div>
          <div style={{ fontSize:11, color:'#2563eb' }}>Opportunità da lavorare</div>
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

      {/* Funnel + pannello tassi a destra */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
          gap: 12,
          alignItems: 'stretch',
        }}
      >
        <Funnel steps={[
          { label:'Leads', value: funnel.leads },
          { label:'Contatti', value: funnel.contacts },
          { label:'Appuntamenti', value: funnel.appointments },
          { label:'Proposte', value: funnel.proposals },
          { label:'Contratti', value: funnel.contracts },
        ]} />

        {/* Pannello Indicatori di conversione */}
        <div
          style={{
            background: '#F5FBFF',
            border: '1px solid #BFE4FF',
            borderRadius: 16,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14, color: '#0b57d0' }}>
            Indicatori di conversione
          </div>

          {/* Tasso di Attivazione */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: 10,
              border: '1px solid #E0ECFF',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <div style={{ fontSize: 12, color: '#0b57d0', fontWeight: 600 }}>
              Tasso di Attivazione
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#0b57d0' }}>
              {funnel.leads > 0 ? formatPercent(activationRate) : '—'}
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              Contratti / Leads
            </div>
          </div>

          {/* Tasso di Chiusura */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: 10,
              border: '1px solid #E0ECFF',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <div style={{ fontSize: 12, color: '#0b57d0', fontWeight: 600 }}>
              Tasso di Chiusura
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#0b57d0' }}>
              {funnel.appointments > 0 ? formatPercent(closingRate) : '—'}
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              Contratti / Appuntamenti
            </div>
          </div>

          {/* Tasso di Conversione */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: 10,
              border: '1px solid '#E0ECFF',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <div style={{ fontSize: 12, color: '#0b57d0', fontWeight: 600 }}>
              Tasso di Conversione
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#0b57d0' }}>
              {funnel.contacts > 0 ? formatPercent(conversionRate) : '—'}
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              Contratti / Contatti
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
