import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * Leads.tsx — Elenco (sinistra) + Scheda (destra)
 * Sinistra: paginazione, filtri (assegnatario, stato, contattato/appuntamento/proposta/contratto),
 * ricerca per Cognome+Nome, ordinamenti richiesti, esportazione CSV con aggregati.
 * Destra: invariata rispetto alla tua versione.
 */

// === Opzioni UI ===
const CHANNEL_OPTIONS_UI = [
  { label: 'Telefono', db: 'phone' },
  { label: 'Email', db: 'email' },
  { label: 'WhatsApp', db: 'phone' }, // mapped → phone
  { label: 'SMS', db: 'phone' },       // mapped → phone
  { label: 'Altro', db: 'phone' },     // mapped → phone
] as const

const MODE_OPTIONS_UI = [
  { label: 'In presenza', db: 'inperson' },
  { label: 'Video', db: 'video' },
  { label: 'Telefono', db: 'phone' },
] as const

const OUTCOME_OPTIONS_UI = [
  { label: 'Parlato', db: 'spoke' },
  { label: 'Nessuna risposta', db: 'noanswer' },
  { label: 'Rifiutato', db: 'refused' },
] as const

const CONTRACT_TYPE_OPTIONS = [
  { label: 'Danni Non Auto', value: 'Danni Non Auto' },
  { label: 'Vita Protection', value: 'Vita Protection' },
  { label: 'Vita Premi Ricorrenti', value: 'Vita Premi Ricorrenti' },
  { label: 'Vita Premi Unici', value: 'Vita Premi Unici' },
] as const

// === Mapping UI label -> DB literal ===
function channelDbFromLabel(label: string){
  const o = CHANNEL_OPTIONS_UI.find(x=>x.label===label); return (o? o.db : 'phone') as 'phone'|'email'|'inperson'|'video'
}
function modeDbFromLabel(label: string){
  const o = MODE_OPTIONS_UI.find(x=>x.label===label); return (o? o.db : 'inperson') as 'inperson'|'phone'|'video'
}
function outcomeDbFromLabel(label: string){
  const o = OUTCOME_OPTIONS_UI.find(x=>x.label===label); return (o? o.db : 'spoke') as 'spoke'|'noanswer'|'refused'
}

// === Tipi base ===
type Role = 'Admin' | 'Team Lead' | 'Junior'

type Lead = {
  id?: string
  owner_id?: string | null
  is_agency_client: boolean | null
  first_name?: string | null
  last_name?: string | null
  company_name?: string | null
  email?: string | null
  phone?: string | null
  city?: string | null
  address?: string | null
  source?: 'Provided' | 'Self' | null
  created_at?: string
  is_working?: boolean | null
}

type AdvisorRow = { user_id: string | null, email: string, full_name: string | null, role: Role }

type FormState = {
  id?: string
  owner_id?: string | null
  is_agency_client: boolean | null
  first_name: string
  last_name: string
  company_name: string
  email: string
  phone: string
  city: string
  address: string
  source: 'Provided' | 'Self' | ''
  is_working?: boolean
}

// === UI helpers ===
const box: React.CSSProperties = {
  background:'var(--card, #fff)',
  border:'1px solid var(--border, #eee)',
  borderRadius:16,
  padding:16,
  maxWidth:'100%',
  overflow:'hidden'
}
const ipt: React.CSSProperties = {
  width:'100%',
  padding:'6px 10px',
  border:'1px solid var(--border, #ddd)',
  borderRadius:8,
  background:'#fff',
  boxSizing:'border-box',
  minWidth:0
}
const label: React.CSSProperties = { fontSize:12, color:'var(--muted, #666)' }
const row: React.CSSProperties = { display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:12 }

/* ---- Nuovo: ordinamenti elenco ---- */
type SortKey =
  | 'last_name_az'
  | 'first_name_az'
  | 'created_desc'
  | 'last_activity_desc'
  | 'last_appointment_desc'
  | 'last_proposal_desc'
  | 'last_contract_desc'

/* ---- Aggregati per i filtri/ordinamento/esporta ---- */
type Aggs = {
  contactsCount: number
  lastContactTs?: string
  lastContactNote?: string
  appointmentsCount: number
  lastAppointmentTs?: string
  lastAppointmentNote?: string
  proposalsCount: number
  lastProposalTs?: string
  lastProposalNote?: string
  contractsCount: number
  lastContractTs?: string
  lastContractNote?: string
  contractsSum: number
}

export default function LeadsPage(){
  // auth/ruolo corrente
  const [meRole, setMeRole] = useState<Role>('Junior')
  const [meUid, setMeUid] = useState<string>('')

  // elenco lead
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // advisors per assegnazione owner
  const [advisors, setAdvisors] = useState<AdvisorRow[]>([])

  // selezione + edit
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // form lead (destra)
  const emptyForm: FormState = {
    is_agency_client: null,
    owner_id: null,
    first_name: '', last_name: '', company_name: '',
    email: '', phone: '', city: '', address: '',
    source: '',
    is_working: true
  }
  const [form, setForm] = useState<FormState>(emptyForm)

  // tabelle collegate (destra)
  const [activities, setActivities] = useState<any[]>([])
  const [editingActId, setEditingActId] = useState<string|null>(null)
  const [actDraft, setActDraft] = useState<any>({ ts:'', channel_label:'Telefono', outcome_label:'Parlato', notes:'' })

  const [appointments, setAppointments] = useState<any[]>([])
  const [editingAppId, setEditingAppId] = useState<string|null>(null)
  const [appDraft, setAppDraft] = useState<any>({ ts:'', mode_label:'In presenza', notes:'' })

  const [proposals, setProposals] = useState<any[]>([])
  const [editingPropId, setEditingPropId] = useState<string|null>(null)
  const [propDraft, setPropDraft] = useState<any>({ ts:'', line:'', amount:0, notes:'' })

  const [contracts, setContracts] = useState<any[]>([])
  const [editingCtrId, setEditingCtrId] = useState<string|null>(null)
  const [ctrDraft, setCtrDraft] = useState<any>({ ts:'', contract_type:CONTRACT_TYPE_OPTIONS[0].value, amount:0, notes:'' })

  const [activeTab, setActiveTab] = useState<'contatti'|'appuntamenti'|'proposte'|'contratti'>('contatti')

  // ---- Nuovo: filtri elenco + ricerca + ordinamento + paginazione ----
  const [assigneeFilter, setAssigneeFilter] = useState<string>('') // vuoto = tutti
  const [onlyWorking, setOnlyWorking] = useState<boolean>(true)     // default: selezionato
  const [onlyContacted, setOnlyContacted] = useState<boolean>(false)
  const [onlyAppointment, setOnlyAppointment] = useState<boolean>(false)
  const [onlyProposal, setOnlyProposal] = useState<boolean>(false)
  const [onlyContract, setOnlyContract] = useState<boolean>(false)

  const [q, setQ] = useState<string>('')
  const [sortBy, setSortBy] = useState<SortKey>('last_name_az')

  const PAGE_SIZE = 10
  const [page, setPage] = useState<number>(1)

  // aggregati per leadId
  const [aggs, setAggs] = useState<Record<string, Aggs>>({})

  // bootstrap
  useEffect(()=>{ (async()=>{
    setLoading(true); setErr('')
    try{
      const { data: s } = await supabase.auth.getUser()
      const uid = s.user?.id || ''
      setMeUid(uid)
      if (uid){
        const { data: me } = await supabase.from('advisors').select('role').eq('user_id', uid).maybeSingle()
        if (me?.role) {
          // 👇 Elevazione locale: in questa pagina il Team Lead ha i permessi dell'Admin
          const elevated = (me.role === 'Team Lead') ? 'Admin' : me.role
          setMeRole(elevated as Role)
        }
      }
      await Promise.all([loadLeads(), loadAdvisors()])
    } catch(ex:any){ setErr(ex.message || 'Errore inizializzazione') }
    finally{ setLoading(false) }
  })() },[])

  // carica leads
  async function loadLeads(){
    const { data, error } = await supabase
      .from('leads')
      .select('id,owner_id,is_agency_client,first_name,last_name,company_name,email,phone,city,address,source,created_at,is_working')
      .order('created_at', { ascending:false })
    if (error){ setErr(error.message); return }
    const arr = (data || []) as Lead[]
    setLeads(arr)
    // carica aggregati per tutti i lead correnti
    await loadAggregates(arr.map(x=>x.id!).filter(Boolean))
  }

  async function loadAdvisors(){
    const { data } = await supabase
      .from('advisors')
      .select('user_id,email,full_name,role')
      .order('full_name', { ascending:true })
    setAdvisors((data||[]) as AdvisorRow[])
  }

  // ---- Aggregazioni: contatti/appuntamenti/proposte/contratti per lead ----
  async function loadAggregates(leadIds: string[]){
    if (!leadIds.length){ setAggs({}); return }
    const [acts, apps, props, ctrs] = await Promise.all([
      supabase.from('activities').select('lead_id, ts, notes').in('lead_id', leadIds),
      supabase.from('appointments').select('lead_id, ts, notes').in('lead_id', leadIds),
      supabase.from('proposals').select('lead_id, ts, notes').in('lead_id', leadIds),
      supabase.from('contracts').select('lead_id, ts, notes, amount').in('lead_id', leadIds),
    ])

    const map: Record<string, Aggs> = {}

    function ensure(id:string){ if (!map[id]) map[id] = { contactsCount:0, appointmentsCount:0, proposalsCount:0, contractsCount:0, contractsSum:0 } }

    // activities
    ;(acts.data||[]).forEach((r:any)=>{
      const id = r.lead_id; ensure(id)
      map[id].contactsCount += 1
      if (!map[id].lastContactTs || r.ts > map[id].lastContactTs!){
        map[id].lastContactTs = r.ts
        map[id].lastContactNote = r.notes || ''
      }
    })
    // appointments
    ;(apps.data||[]).forEach((r:any)=>{
      const id = r.lead_id; ensure(id)
      map[id].appointmentsCount += 1
      if (!map[id].lastAppointmentTs || r.ts > map[id].lastAppointmentTs!){
        map[id].lastAppointmentTs = r.ts
        map[id].lastAppointmentNote = r.notes || ''
      }
    })
    // proposals
    ;(props.data||[]).forEach((r:any)=>{
      const id = r.lead_id; ensure(id)
      map[id].proposalsCount += 1
      if (!map[id].lastProposalTs || r.ts > map[id].lastProposalTs!){
        map[id].lastProposalTs = r.ts
        map[id].lastProposalNote = r.notes || ''
      }
    })
    // contracts
    ;(ctrs.data||[]).forEach((r:any)=>{
      const id = r.lead_id; ensure(id)
      map[id].contractsCount += 1
      map[id].contractsSum += Number(r.amount||0)
      if (!map[id].lastContractTs || r.ts > map[id].lastContractTs!){
        map[id].lastContractTs = r.ts
        map[id].lastContractNote = r.notes || ''
      }
    })

    setAggs(map)
  }

  // loader tabelle collegate (destra)
  async function loadActivities(leadId:string){
    const { data } = await supabase
      .from('activities')
      .select('id,ts,channel,outcome,notes')
      .eq('lead_id', leadId)
      .order('ts', { ascending:false })
    setActivities(data||[])
  }
  async function loadAppointments(leadId:string){
    const { data } = await supabase
      .from('appointments')
      .select('id,ts,mode,notes')
      .eq('lead_id', leadId)
      .order('ts', { ascending:false })
    setAppointments(data||[])
  }
  async function loadProposals(leadId:string){
    const { data } = await supabase
      .from('proposals')
      .select('id,ts,line,amount,notes')
      .eq('lead_id', leadId)
      .order('ts', { ascending:false })
    setProposals(data||[])
  }
  async function loadContracts(leadId:string){
    const { data } = await supabase
      .from('contracts')
      .select('id,ts,contract_type,amount,notes')
      .eq('lead_id', leadId)
      .order('ts', { ascending:false })
    setContracts(data||[])
  }
  async function reloadAllChildren(leadId:string){
    await Promise.all([
      loadActivities(leadId),
      loadAppointments(leadId),
      loadProposals(leadId),
      loadContracts(leadId)
    ])
    // aggiorna aggregati solo per questo lead
    await loadAggregates([leadId])
  }

  // helpers (destra)
  function leadLabel(l: Partial<Lead>){
    const n = [l.last_name||'', l.first_name||''].join(' ').trim()
    return n || (l.company_name||l.email||l.phone||'Lead')
  }
  function clearForm(){
    setForm(emptyForm)
    setEditingLeadId(null)
    setActiveTab('contatti')
  }
  function loadLeadIntoForm(l: Lead){
    setForm({
      id: l.id,
      owner_id: l.owner_id||null,
      is_agency_client: l.is_agency_client,
      first_name: l.first_name||'', last_name: l.last_name||'', company_name: l.company_name||'',
      email: l.email||'', phone: l.phone||'', city: l.city||'', address: l.address||'',
      source: (l.source||'') as any,
      is_working: (l as any).is_working ?? true,
    })
    if (l.id) { void reloadAllChildren(l.id) }
  }
  function validateForm(f: FormState): string | null{
    if (f.is_agency_client === null) return 'Indicare se gia cliente di agenzia'
    if (!(f.email?.trim() || f.phone?.trim())) return 'Inserire email oppure telefono'
    const hasPerson = (f.first_name.trim() && f.last_name.trim())
    const hasCompany = !!f.company_name.trim()
    if (!hasPerson && !hasCompany) return 'Inserire Nome+Cognome oppure Ragione Sociale'
    return null
  }

  async function saveLead(){
    const msg = validateForm(form)
    if (msg){ alert(msg); return }
    const payload = {
      owner_id: form.owner_id || meUid || null,
      is_agency_client: form.is_agency_client,
      first_name: form.first_name||null,
      last_name: form.last_name||null,
      company_name: form.company_name||null,
      email: form.email||null,
      phone: form.phone||null,
      city: form.city||null,
      address: form.address||null,
      source: (form.source||null) as any,
      is_working: form.is_working ?? true,
    }
    if (editingLeadId){
      const { error } = await supabase.from('leads').update(payload).eq('id', editingLeadId)
      if (error){ alert(error.message); return }
    } else {
      const { error } = await supabase.from('leads').insert(payload)
      if (error){ alert(error.message); return }
    }
    await loadLeads()
    clearForm()
  }

  async function deleteLead(id: string){
    const ok = confirm('Eliminare definitivamente il lead?')
    if (!ok) return
    const { error } = await supabase.from('leads').delete().eq('id', id)
    if (error){ alert(error.message); return }
    if (selectedId===id) setSelectedId(null)
    if (editingLeadId===id) setEditingLeadId(null)
    await loadLeads()
  }

  // filtro owners per select (solo Junior per assegnazione – usata a destra)
  const juniorOptions = useMemo(()=>
    advisors.filter(a=>a.role==='Junior' && !!a.user_id)
  ,[advisors])

  // ====== ELENCO SINISTRA: filtri + ricerca + sort + paginazione ======
  const filteredSorted = useMemo(()=>{
    let arr = [...leads]

    // i. filtro assegnatario (solo se impostato)
    if (assigneeFilter) arr = arr.filter(l => l.owner_id === assigneeFilter)

    // ii. toggle In Lavorazione (default true)
    if (onlyWorking) arr = arr.filter(l => (l.is_working ?? true) === true)

    // ii. Contattato / Appuntamento / Proposta / Contratto
    arr = arr.filter(l=>{
      const A = aggs[l.id!]
      if (onlyContacted && !(A && A.contactsCount>0)) return false
      if (onlyAppointment && !(A && A.appointmentsCount>0)) return false
      if (onlyProposal && !(A && A.proposalsCount>0)) return false
      if (onlyContract && !(A && A.contractsCount>0)) return false
      return true
    })

    // iii. ricerca in Cognome+Nome (case-insensitive, contiene)
    if (q.trim()){
      const s = q.trim().toLowerCase()
      arr = arr.filter(l=>{
        const name = `${l.last_name||''} ${l.first_name||''}`.trim().toLowerCase()
        return name.includes(s)
      })
    }

    // iv. ordinamenti
    arr.sort((a,b)=>{
      switch (sortBy){
        case 'first_name_az': {
          const A = (a.first_name||'').localeCompare(b.first_name||'')
          if (A!==0) return A
          return (a.last_name||'').localeCompare(b.last_name||'')
        }
        case 'created_desc':
          return (b.created_at||'').localeCompare(a.created_at||'')
        case 'last_activity_desc': {
          const ta = aggs[a.id!]?.lastContactTs||''
          const tb = aggs[b.id!]?.lastContactTs||''
          return tb.localeCompare(ta)
        }
        case 'last_appointment_desc': {
          const ta = aggs[a.id!]?.lastAppointmentTs||''
          const tb = aggs[b.id!]?.lastAppointmentTs||''
          return tb.localeCompare(ta)
        }
        case 'last_proposal_desc': {
          const ta = aggs[a.id!]?.lastProposalTs||''
          const tb = aggs[b.id!]?.lastProposalTs||''
          return tb.localeCompare(ta)
        }
        case 'last_contract_desc': {
          const ta = aggs[a.id!]?.lastContractTs||''
          const tb = aggs[b.id!]?.lastContractTs||''
          return tb.localeCompare(ta)
        }
        case 'last_name_az':
        default:
          return (a.last_name||'').localeCompare(b.last_name||'')
      }
    })

    return arr
  }, [leads, assigneeFilter, onlyWorking, onlyContacted, onlyAppointment, onlyProposal, onlyContract, q, sortBy, aggs])

  // paginazione: 10 per pagina
  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filteredSorted.slice((safePage-1)*PAGE_SIZE, safePage*PAGE_SIZE)

  // reset pagina quando cambiano i filtri/ricerca
  useEffect(()=>{ setPage(1) }, [assigneeFilter, onlyWorking, onlyContacted, onlyAppointment, onlyProposal, onlyContract, q, sortBy])

  // ====== EXPORT CSV ======
  function exportCsv(){
    const rows = filteredSorted.map(l=>{
      const A = aggs[l.id!]
      return {
        ID: l.id||'',
        Assegnatario: advisors.find(a=>a.user_id===l.owner_id)?.full_name || advisors.find(a=>a.user_id===l.owner_id)?.email || '',
        'Gia cliente agenzia': l.is_agency_client ? 'Sì' : 'No',
        Nome: l.first_name||'',
        Cognome: l.last_name||'',
        'Ragione sociale': l.company_name||'',
        Email: l.email||'',
        Telefono: l.phone||'',
        Citta: l.city||'',
        Indirizzo: l.address||'',
        Fonte: l.source||'',
        'In lavorazione': (l.is_working??true) ? 'Sì' : 'No',
        'Creato il': l.created_at||'',

        // Aggregati
        'Numero Contatti': A?.contactsCount || 0,
        'Data Ultimo Contatto': A?.lastContactTs || '',
        'Note Ultimo Contatto': A?.lastContactNote || '',
        'Numero Appuntamenti': A?.appointmentsCount || 0,
        'Data Ultimo Appuntamento': A?.lastAppointmentTs || '',
        'Note Ultimo Appuntamento': A?.lastAppointmentNote || '',
        'Numero Proposte': A?.proposalsCount || 0,
        'Data Ultima Proposta': A?.lastProposalTs || '',
        'Note Ultima Proposta': A?.lastProposalNote || '',
        'Numero Contratti': A?.contractsCount || 0,
        'Data Ultimo Contratto': A?.lastContractTs || '',
        'Note Ultimo Contratto': A?.lastContractNote || '',
        'Somma Premi Contratti': A?.contractsSum || 0,
      }
    })

    const headers = Object.keys(rows[0] || {a:''})
    const csv = [
      headers.join(';'),
      ...rows.map(r => headers.map(h => {
        let v:any = (r as any)[h]
        if (typeof v === 'string'){
          // escape doppi apici + separatore ;  → uso apici doppi + rimpiazzo
          v = `"${v.replace(/"/g,'""')}"`
        }
        return v
      }).join(';'))
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads_export_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display:'grid', gridTemplateColumns:'420px minmax(0,0.9fr)', gap:20 }}>
      {/* ===================== LISTA / FILTRI / PAGINAZIONE ===================== */}
      <div className="brand-card" style={{ ...box }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <div style={{ fontSize:16, fontWeight:700 }}>Leads</div>
          <div style={{ display:'flex', gap:6 }}>
            <button className="brand-btn" onClick={()=>{ setSelectedId(null); clearForm() }}>+ Nuovo</button>
            <button className="brand-btn" onClick={exportCsv}>Esporta</button>
          </div>
        </div>

        {/* Filtri */}
<div style={{ display:'grid', gap:8, marginBottom:10 }}>

  {/* RIGA 1: Assegnatario (select compatta) + In Lavorazione affiancato */}
  <div
    style={{
      display:'grid',
      gridTemplateColumns: (meRole==='Admin' || meRole==='Team Lead')
        ? 'minmax(180px,1fr) 170px'
        : '1fr 170px',               // se non Admin/TL lo lasciamo vuoto a sinistra per allineare il bottone
      alignItems:'end',
      gap:8
    }}
  >
    {(meRole==='Admin' || meRole==='Team Lead') ? (
      <div>
        <div style={label}>Assegnatario</div>
        <select
          style={ipt}
          value={assigneeFilter}
          onChange={e=>setAssigneeFilter(e.target.value)}
        >
          <option value="">Tutti</option>
          {/* 👇 TL/Admin possono filtrare su TUTTI gli advisor */}
          {advisors
            .filter(a=>a.user_id)
            .map(a => (
              <option key={a.user_id!} value={a.user_id!}>
                {(a.full_name || a.email) + (a.role ? ` — ${a.role}` : '')}
              </option>
            ))}
        </select>
      </div>
    ) : (
      <div /> /* placeholder per mantenere l'allineamento */
    )}

    <div>
      <div style={{ visibility:'hidden', height:14 }}>.</div>
      <button
        className="brand-btn"
        onClick={()=>setOnlyWorking(v=>!v)}
        style={ onlyWorking
          ? { background:'var(--brand-primary-600, #0029ae)', color:'#fff' }
          : {} }
      >
        In Lavorazione
      </button>
    </div>
  </div>

  {/* RIGA 2: Contattato + Fissato/Fatto Appuntamento */}
  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
    <button
      className="brand-btn"
      onClick={()=>setOnlyContacted(v=>!v)}
      style={ onlyContacted ? { background:'var(--brand-primary-600, #0029ae)', color:'#fff' } : {} }
    >
      Contattato
    </button>
    <button
      className="brand-btn"
      onClick={()=>setOnlyAppointment(v=>!v)}
      style={ onlyAppointment ? { background:'var(--brand-primary-600, #0029ae)', color:'#fff' } : {} }
    >
      Fissato/Fatto Appuntamento
    </button>
  </div>

  {/* RIGA 3: Presentata Proposta + Firmato Contratto */}
  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
    <button
      className="brand-btn"
      onClick={()=>setOnlyProposal(v=>!v)}
      style={ onlyProposal ? { background:'var(--brand-primary-600, #0029ae)', color:'#fff' } : {} }
    >
      Presentata Proposta
    </button>
    <button
      className="brand-btn"
      onClick={()=>setOnlyContract(v=>!v)}
      style={ onlyContract ? { background:'var(--brand-primary-600, #0029ae)', color:'#fff' } : {} }
    >
      Firmato Contratto
    </button>
  </div>

  {/* Ricerca */}
  <div>
    <div style={label}>Cerca (Cognome + Nome)</div>
    <input
      style={ipt}
      placeholder="es. Rossi Ma"
      value={q}
      onChange={e=>setQ(e.target.value)}
    />
  </div>

  {/* Ordina per */}
  <div>
    <div style={label}>Ordina per</div>
    <select
      style={ipt}
      value={sortBy}
      onChange={e=>setSortBy(e.target.value as SortKey)}
    >
      <option value="last_name_az">Cognome A→Z</option>
      <option value="first_name_az">Nome A→Z</option>
      <option value="created_desc">Data Caricamento (recenti)</option>
      <option value="last_activity_desc">Data Contatto (recenti)</option>
      <option value="last_appointment_desc">Data Appuntamento (recenti)</option>
      <option value="last_proposal_desc">Data Proposta (recenti)</option>
      <option value="last_contract_desc">Data Contratto (recenti)</option>
    </select>
  </div>
</div>

        {/* Lista + paginazione */}
        {loading ? 'Caricamento...' : (
          <>
            <div style={{ display:'grid', gap:8, minHeight:200 }}>
              {pageItems.map(l => (
                <div
                  key={l.id}
                  style={{
                    border:'1px solid',
                    borderColor: selectedId===l.id ? 'var(--brand-primary-600, #0029ae)' : 'var(--border, #eee)',
                    background: selectedId===l.id ? '#F0F6FF' : '#fff'
