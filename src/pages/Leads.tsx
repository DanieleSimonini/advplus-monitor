import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * Leads.tsx — CRUD completo (Lead + Contatti/Appunt./Proposte/Contratti)
 * (LEFT) Lista lead con filtri, ricerca, ordinamento, paginazione (10), export CSV
 * (RIGHT) Form + tab invariati
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
const brandBlue = 'var(--brand-primary-600, #0029ae)'
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

// ====== NOVITÀ LISTA SINISTRA: stati aggregati/filtri/paging ======
type Agg = { count: number, lastTs?: string | null, lastNotes?: string | null, sumAmount?: number }
type AggMap = Record<string, Agg>

type SortKey =
  | 'last_name_az'
  | 'first_name_az'
  | 'created_desc'
  | 'last_contact_desc'
  | 'last_appointment_desc'
  | 'last_proposal_desc'
  | 'last_contract_desc'

function ensureAgg(a?: Agg): Agg { return a || { count: 0, lastTs: null, lastNotes: null, sumAmount: 0 } }

export default function LeadsPage(){
  // auth/ruolo corrente
  const [meRole, setMeRole] = useState<Role>('Junior')
  const [meUid, setMeUid] = useState<string>('')

  // elenco lead
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // advisors
  const [advisors, setAdvisors] = useState<AdvisorRow[]>([])

  // selezione + edit
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // form lead
  const emptyForm: FormState = {
    is_agency_client: null,
    owner_id: null,
    first_name: '', last_name: '', company_name: '',
    email: '', phone: '', city: '', address: '',
    source: '',
    is_working: true
  }
  const [form, setForm] = useState<FormState>(emptyForm)

  // STEP 2: tabelle collegate (per la scheda a destra – invariato)
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

  // ===== Aggregati per la LISTA SINISTRA =====
  const [aggActivities, setAggActivities] = useState<AggMap>({})
  const [aggAppointments, setAggAppointments] = useState<AggMap>({})
  const [aggProposals, setAggProposals] = useState<AggMap>({})
  const [aggContracts, setAggContracts] = useState<AggMap>({})

  // Filtri / ricerca / ordine
  const [assigneeFilter, setAssigneeFilter] = useState<string>('') // user_id
  const [fltWorking, setFltWorking] = useState<boolean>(true)       // default ON
  const [fltContacted, setFltContacted] = useState<boolean>(false)
  const [fltAppointment, setFltAppointment] = useState<boolean>(false)
  const [fltProposal, setFltProposal] = useState<boolean>(false)
  const [fltContract, setFltContract] = useState<boolean>(false)
  const [search, setSearch] = useState<string>('')
  const [sortBy, setSortBy] = useState<SortKey>('last_name_az')

  // Paginazione
  const PAGE_SIZE = 10
  const [page, setPage] = useState<number>(1)

  // bootstrap
  useEffect(()=>{ (async()=>{
    setLoading(true); setErr('')
    try{
      const { data: s } = await supabase.auth.getUser()
      const uid = s.user?.id || ''
      setMeUid(uid)
      if (uid){
        const { data: me } = await supabase.from('advisors').select('role').eq('user_id', uid).maybeSingle()
        if (me?.role) setMeRole(me.role as Role)
      }
      await Promise.all([loadLeads(), loadAdvisors()])
    } catch(ex:any){ setErr(ex.message || 'Errore inizializzazione') }
    finally{ setLoading(false) }
  })() },[])

  async function loadLeads(){
    const { data, error } = await supabase
      .from('leads')
      .select('id,owner_id,is_agency_client,first_name,last_name,company_name,email,phone,city,address,source,created_at,is_working')
      .order('created_at', { ascending:false })
    if (error){ setErr(error.message); return }
    const rows = (data||[]) as Lead[]
    setLeads(rows)
    // carico aggregati per i lead presenti
    const ids = rows.map(r=>r.id!).filter(Boolean)
    await loadAggregates(ids)
  }

  async function loadAggregates(leadIds: string[]){
    if (!leadIds.length) { setAggActivities({}); setAggAppointments({}); setAggProposals({}); setAggContracts({}); return }
    // Activities
    const { data: acts } = await supabase
      .from('activities')
      .select('lead_id, ts, notes')
      .in('lead_id', leadIds)
    const aMap: AggMap = {}
    ;(acts||[]).forEach(r=>{
      const key = r.lead_id as string
      const cur = ensureAgg(aMap[key])
      cur.count += 1
      if (!cur.lastTs || (r.ts && r.ts > cur.lastTs)) { cur.lastTs = r.ts; cur.lastNotes = r.notes||null }
      aMap[key] = cur
    })
    setAggActivities(aMap)

    // Appointments
    const { data: apps } = await supabase
      .from('appointments')
      .select('lead_id, ts, notes')
      .in('lead_id', leadIds)
    const appMap: AggMap = {}
    ;(apps||[]).forEach(r=>{
      const key = r.lead_id as string
      const cur = ensureAgg(appMap[key])
      cur.count += 1
      if (!cur.lastTs || (r.ts && r.ts > cur.lastTs)) { cur.lastTs = r.ts; cur.lastNotes = r.notes||null }
      appMap[key] = cur
    })
    setAggAppointments(appMap)

    // Proposals
    const { data: props } = await supabase
      .from('proposals')
      .select('lead_id, ts, notes')
      .in('lead_id', leadIds)
    const propMap: AggMap = {}
    ;(props||[]).forEach(r=>{
      const key = r.lead_id as string
      const cur = ensureAgg(propMap[key])
      cur.count += 1
      if (!cur.lastTs || (r.ts && r.ts > cur.lastTs)) { cur.lastTs = r.ts; cur.lastNotes = r.notes||null }
      propMap[key] = cur
    })
    setAggProposals(propMap)

    // Contracts
    const { data: ctrs } = await supabase
      .from('contracts')
      .select('lead_id, ts, notes, amount')
      .in('lead_id', leadIds)
    const ctrMap: AggMap = {}
    ;(ctrs||[]).forEach((r:any)=>{
      const key = r.lead_id as string
      const cur = ensureAgg(ctrMap[key])
      cur.count += 1
      cur.sumAmount = (cur.sumAmount || 0) + Number(r.amount||0)
      if (!cur.lastTs || (r.ts && r.ts > cur.lastTs)) { cur.lastTs = r.ts; cur.lastNotes = r.notes||null }
      ctrMap[key] = cur
    })
    setAggContracts(ctrMap)
  }

  async function loadAdvisors(){
    const { data, error } = await supabase
      .from('advisors')
      .select('user_id,email,full_name,role')
      .order('full_name', { ascending:true })
    if (!error) setAdvisors((data||[]) as AdvisorRow[])
  }

  // loader tabelle collegate (per la scheda a destra – invariato)
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
  }

  // helpers
  function leadLabel(l: Partial<Lead>){
    const n = [l.first_name||'', l.last_name||''].join(' ').trim()
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

  // filtro owners per select (solo Junior per assegnazione form destra)
  const juniorOptions = useMemo(()=>
    advisors.filter(a=>a.role==='Junior' && !!a.user_id)
  ,[advisors])

  // ======= DERIVAZIONI LISTA (filtri/ricerca/ordinamento/paginazione) =======
  const filteredSortedLeads = useMemo(()=>{
    let arr = [...leads]

    // filtro assegnatario (solo se scelto)
    if (assigneeFilter) arr = arr.filter(l => (l.owner_id||'') === assigneeFilter)

    // bottoni stato
    if (fltWorking) arr = arr.filter(l => !!(l as any).is_working)

    // ciascun “stato” richiede presenza di almeno un record collegato
    if (fltContacted)   arr = arr.filter(l => ensureAgg(aggActivities[l.id!]).count > 0)
    if (fltAppointment) arr = arr.filter(l => ensureAgg(aggAppointments[l.id!]).count > 0)
    if (fltProposal)    arr = arr.filter(l => ensureAgg(aggProposals[l.id!]).count > 0)
    if (fltContract)    arr = arr.filter(l => ensureAgg(aggContracts[l.id!]).count > 0)

    // ricerca su Cognome + Nome
    const q = search.trim().toLowerCase()
    if (q){
      arr = arr.filter(l => {
        const full = `${l.last_name||''} ${l.first_name||''}`.trim().toLowerCase()
        return full.includes(q)
      })
    }

    // ordinamento
    const getDate = (s?: string|null) => s ? new Date(s).getTime() : -1
    arr.sort((a,b)=>{
      switch (sortBy){
        case 'last_name_az':
          return (a.last_name||'').localeCompare(b.last_name||'') || (a.first_name||'').localeCompare(b.first_name||'')
        case 'first_name_az':
          return (a.first_name||'').localeCompare(b.first_name||'') || (a.last_name||'').localeCompare(b.last_name||'')
        case 'created_desc':
          return getDate(b.created_at) - getDate(a.created_at)
        case 'last_contact_desc':
          return getDate(ensureAgg(aggActivities[b.id!]).lastTs) - getDate(ensureAgg(aggActivities[a.id!]).lastTs)
        case 'last_appointment_desc':
          return getDate(ensureAgg(aggAppointments[b.id!]).lastTs) - getDate(ensureAgg(aggAppointments[a.id!]).lastTs)
        case 'last_proposal_desc':
          return getDate(ensureAgg(aggProposals[b.id!]).lastTs) - getDate(ensureAgg(aggProposals[a.id!]).lastTs)
        case 'last_contract_desc':
          return getDate(ensureAgg(aggContracts[b.id!]).lastTs) - getDate(ensureAgg(aggContracts[a.id!]).lastTs)
        default:
          return 0
      }
    })
    return arr
  }, [leads, assigneeFilter, fltWorking, fltContacted, fltAppointment, fltProposal, fltContract, search, sortBy, aggActivities, aggAppointments, aggProposals, aggContracts])

  const total = filteredSortedLeads.length
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageSafe = Math.min(Math.max(1, page), lastPage)
  const pageSlice = filteredSortedLeads.slice((pageSafe-1)*PAGE_SIZE, pageSafe*PAGE_SIZE)

  useEffect(()=>{ setPage(1) }, [assigneeFilter, fltWorking, fltContacted, fltAppointment, fltProposal, fltContract, search, sortBy])

  // ======= EXPORT CSV dei lead filtrati (tutti i filtrati, non solo la pagina) =======
  function toCsvValue(v:any){ if (v===null || v===undefined) return ''; const s = String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  function fmtDate(s?:string|null){ return s ? new Date(s).toLocaleString('it-IT') : '' }

  function exportCsv(){
    const rows = filteredSortedLeads
    const headers = [
      'ID','Assegnatario','Cliente Agenzia','Nome','Cognome','Ragione Sociale',
      'Email','Telefono','Citta','Indirizzo','Fonte','Data Caricamento','In Lavorazione',
      'Numero Contatti','Data Ultimo Contatto','Note Ultimo Contatto',
      'Numero Appuntamenti','Data Ultimo Appuntamento','Note Ultimo Appuntamento',
      'Numero Proposte','Data Ultima Proposta','Note Ultima Proposta',
      'Numero Contratti','Data Ultimo Contratto','Note Ultimo Contratto','Somma Premi Contratti'
    ]
    const lines = [headers.map(toCsvValue).join(';')]

    rows.forEach(l=>{
      const a = ensureAgg(aggActivities[l.id!])
      const ap = ensureAgg(aggAppointments[l.id!])
      const p = ensureAgg(aggProposals[l.id!])
      const c = ensureAgg(aggContracts[l.id!])
      const ownerName = advisors.find(x=>x.user_id===l.owner_id)?.full_name || advisors.find(x=>x.user_id===l.owner_id)?.email || ''
      const line = [
        l.id||'',
        ownerName,
        l.is_agency_client? 'Si':'No',
        l.first_name||'',
        l.last_name||'',
        l.company_name||'',
        l.email||'',
        l.phone||'',
        l.city||'',
        l.address||'',
        l.source||'',
        fmtDate(l.created_at),
        (l as any).is_working ? 'Si':'No',
        a.count, fmtDate(a.lastTs||null), a.lastNotes||'',
        ap.count, fmtDate(ap.lastTs||null), ap.lastNotes||'',
        p.count, fmtDate(p.lastTs||null), p.lastNotes||'',
        c.count, fmtDate(c.lastTs||null), c.lastNotes||'', Number(c.sumAmount||0).toLocaleString('it-IT',{style:'currency',currency:'EUR'})
      ]
      lines.push(line.map(toCsvValue).join(';'))
    })

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const aEl = document.createElement('a')
    aEl.href = url
    aEl.download = `leads_filtrati_${new Date().toISOString().slice(0,19).replaceAll(':','-')}.csv`
    document.body.appendChild(aEl)
    aEl.click()
    document.body.removeChild(aEl)
    URL.revokeObjectURL(url)
  }

  // ===================== RENDER =====================
  return (
    <div style={{ display:'grid', gridTemplateColumns:'340px minmax(0,1fr)', gap:16 }}>
      {/* ==================== Lista Lead (SINISTRA) — AGGIORNATA ==================== */}
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
          {(meRole==='Admin' || meRole==='Team Lead') && (
            <div>
              <div style={label}>Assegnatario</div>
              <select value={assigneeFilter} onChange={e=>setAssigneeFilter(e.target.value)} style={ipt}>
                <option value="">— Tutti —</option>
                {advisors.filter(a=>!!a.user_id).map(a=>(
                  <option key={a.user_id||a.email} value={a.user_id||''}>{a.full_name || a.email}</option>
                ))}
              </select>
            </div>
          )}

          {/* Bottoni stato */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            <Toggle label="In Lavorazione"  active={fltWorking}    onClick={()=>setFltWorking(v=>!v)} />
            <Toggle label="Contattato"       active={fltContacted}  onClick={()=>setFltContacted(v=>!v)} />
            <Toggle label="Fissato/Fatto Appuntamento" active={fltAppointment} onClick={()=>setFltAppointment(v=>!v)} />
            <Toggle label="Presentata Proposta" active={fltProposal} onClick={()=>setFltProposal(v=>!v)} />
            <Toggle label="Firmato Contratto" active={fltContract} onClick={()=>setFltContract(v=>!v)} />
          </div>

          {/* Ricerca e Ordina per */}
          <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:8 }}>
            <div>
              <div style={label}>Cerca (Cognome + Nome)</div>
              <input placeholder="es. Rossi Mario" value={search} onChange={e=>setSearch(e.target.value)} style={ipt} />
            </div>
            <div>
              <div style={label}>Ordina per</div>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value as SortKey)} style={ipt}>
                <option value="last_name_az">Cognome A→Z (default)</option>
                <option value="first_name_az">Nome A→Z</option>
                <option value="created_desc">Data Caricamento (↓)</option>
                <option value="last_contact_desc">Data Contatto (↓)</option>
                <option value="last_appointment_desc">Data Appuntamento (↓)</option>
                <option value="last_proposal_desc">Data Proposta (↓)</option>
                <option value="last_contract_desc">Data Contratto (↓)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Elenco + paginazione */}
        {loading ? 'Caricamento...' : (
          <>
            <div style={{ display:'grid', gap:8 }}>
              {pageSlice.map(l => (
                <div
                  key={l.id}
                  style={{
                    border:'1px solid',
                    borderColor: selectedId===l.id ? brandBlue : 'var(--border, #eee)',
                    background: selectedId===l.id ? '#F0F6FF' : '#fff',
                    borderRadius:12,
                    padding:10
                  }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                    <div
                      onClick={()=>{ setSelectedId(l.id!); setEditingLeadId(l.id!); loadLeadIntoForm(l) }}
                      style={{ cursor:'pointer' }}>
                      <div style={{ fontWeight:600 }}>{leadLabel(l)}</div>
                      <div style={{ fontSize:12, color:'var(--muted, #666)' }}>
                        {l.email || l.phone || '—'} {l.is_agency_client? ' · Gia cliente' : ''}
                      </div>
                      {/* Pill di stato rapida (facoltativa, utile in lista) */}
                      <div style={{ display:'flex', gap:6, marginTop:4, flexWrap:'wrap' }}>
                        {ensureAgg(aggActivities[l.id!]).count>0 && <Pill>Contattato</Pill>}
                        {ensureAgg(aggAppointments[l.id!]).count>0 && <Pill>Appuntamento</Pill>}
                        {ensureAgg(aggProposals[l.id!]).count>0 && <Pill>Proposta</Pill>}
                        {ensureAgg(aggContracts[l.id!]).count>0 && <Pill>Contratto</Pill>}
                      </div>
                    </div>
                    <div style={{ display:'inline-flex', gap:6 }}>
                      <button title="Modifica" onClick={()=>{ setEditingLeadId(l.id!); setSelectedId(l.id!); loadLeadIntoForm(l) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>✏️</button>
                      <button title="Elimina" onClick={()=>{ setConfirmDeleteId(l.id!); }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
                    </div>
                  </div>
                </div>
              ))}
              {pageSlice.length===0 && (
                <div style={{ fontSize:13, color:'#666' }}>Nessun lead con i filtri impostati.</div>
              )}
            </div>

            {/* Pagination controls */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:10 }}>
              <div style={{ fontSize:12, color:'#666' }}>
                {total} risultati · Pagina {pageSafe} di {lastPage}
              </div>
              <div style={{ display:'inline-flex', gap:6 }}>
                <button className="brand-btn" disabled={pageSafe<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Prec.</button>
                <button className="brand-btn" disabled={pageSafe>=lastPage} onClick={()=>setPage(p=>Math.min(lastPage,p+1))}>Succ.</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ==================== Form Lead + TAB (DESTRA) — INVARIATO ==================== */}
      <div className="brand-card" style={{ ...box }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, gap:8 }}>
          {/* i) Titolo dinamico con nome lead */}
          <div style={{ fontSize:16, fontWeight:700 }}>
            {editingLeadId ? `Modifica — ${leadLabel(form as any)}` : 'Nuovo Lead'}
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button className="brand-btn" onClick={saveLead}>{editingLeadId? 'Salva' : 'Crea'}</button>
            <button className="brand-btn" onClick={()=>clearForm()}>Reset</button>
            {/* v) In Lavorazione / Stop Lavorazione */}
            <button
              className="brand-btn"
              onClick={()=> setForm(f=>({ ...f, is_working: !f.is_working }))}
              style={
                form?.is_working
                  ? { background:brandBlue, color:'#fff', borderColor:brandBlue }
                  : { background:'#c1121f', color:'#fff', borderColor:'#c1121f' }
              }>
              {form?.is_working ? 'In Lavorazione' : 'Stop Lavorazione'}
            </button>
          </div>
        </div>

        {/* ======= (tutto il resto della parte destra rimane IDENTICO al tuo codice) ======= */}

        <div style={{ display:'grid', gap:12 }}>
          {(meRole==='Admin' || meRole==='Team Lead') && (
            <div>
              <div style={label}>Assegna a Junior</div>
              <select value={form.owner_id||''} onChange={e=>setForm(f=>({ ...f, owner_id: e.target.value || null }))} style={ipt}>
                <option value="">— Scegli —</option>
                {juniorOptions.map(a => (
                  <option key={a.user_id||a.email} value={a.user_id||''}>{a.full_name || a.email}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <div style={label}>Gia cliente di agenzia?</div>
            <div style={{ display:'flex', gap:12 }}>
              <label><input type="radio" checked={form.is_agency_client===true} onChange={()=>setForm(f=>({ ...f, is_agency_client:true }))}/> Si</label>
              <label><input type="radio" checked={form.is_agency_client===false} onChange={()=>setForm(f=>({ ...f, is_agency_client:false }))}/> No</label>
            </div>
          </div>

          <div style={row}>
            <div>
              <div style={label}>Nome</div>
              <input style={ipt} value={form.first_name} onChange={e=>setForm(f=>({ ...f, first_name:e.target.value }))} />
            </div>
            <div>
              <div style={label}>Cognome</div>
              <input style={ipt} value={form.last_name} onChange={e=>setForm(f=>({ ...f, last_name:e.target.value }))} />
            </div>
          </div>

          <div>
            <div style={label}>Ragione Sociale</div>
            <input style={ipt} value={form.company_name} onChange={e=>setForm(f=>({ ...f, company_name:e.target.value }))} />
          </div>

          <div style={row}>
            <div>
              <div style={label}>Email</div>
              <input style={ipt} value={form.email} onChange={e=>setForm(f=>({ ...f, email:e.target.value }))} />
            </div>
            <div>
              <div style={label}>Telefono</div>
              <input style={ipt} value={form.phone} onChange={e=>setForm(f=>({ ...f, phone:e.target.value }))} />
            </div>
          </div>

          <div style={row}>
            <div>
              <div style={label}>Citta</div>
              <input style={ipt} value={form.city} onChange={e=>setForm(f=>({ ...f, city:e.target.value }))} />
            </div>
            <div>
              <div style={label}>Indirizzo</div>
              <input style={ipt} value={form.address} onChange={e=>setForm(f=>({ ...f, address:e.target.value }))} />
            </div>
          </div>

          <div>
            <div style={label}>Fonte</div>
            <select style={ipt} value={form.source} onChange={e=>setForm(f=>({ ...f, source: e.target.value as any }))}>
              <option value="">—</option>
              <option value="Provided">Fornito</option>
              <option value="Self">Autonomo</option>
            </select>
          </div>
        </div>

        {/* TAB */}
        <div style={{ marginTop:16 }}>
          <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
            <button className="brand-btn" style={{ ...(activeTab==='contatti'? { background:brandBlue, color:'#fff' } : {}) }} onClick={()=>setActiveTab('contatti')}>Contatti</button>
            <button className="brand-btn" style={{ ...(activeTab==='appuntamenti'? { background:brandBlue, color:'#fff' } : {}) }} onClick={()=>setActiveTab('appuntamenti')}>Appuntamenti</button>
            <button className="brand-btn" style={{ ...(activeTab==='proposte'? { background:brandBlue, color:'#fff' } : {}) }} onClick={()=>setActiveTab('proposte')}>Proposte</button>
            <button className="brand-btn" style={{ ...(activeTab==='contratti'? { background:brandBlue, color:'#fff' } : {}) }} onClick={()=>setActiveTab('contratti')}>Contratti</button>
          </div>

          {/* (SEZIONI CONTATTI / APPUNTAMENTI / PROPOSTE / CONTRATTI) — lasciate identiche al tuo codice */}
          {/* -------- CONTATTI -------- */}
          {activeTab==='contatti' && (
            <div style={{ display:'grid', gap:12 }}>
              <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)', gap:12 }}>
                <div>
                  <div style={label}>Data/Ora</div>
                  <input type="datetime-local" style={ipt} value={actDraft.ts} onChange={e=>setActDraft((d:any)=>({ ...d, ts: e.target.value }))} />
                </div>
                <div>
                  <div style={label}>Canale</div>
                  <select style={ipt} value={actDraft.channel_label} onChange={e=>setActDraft((d:any)=>({ ...d, channel_label:e.target.value }))}>
                    {CHANNEL_OPTIONS_UI.map(o=> <option key={o.label} value={o.label}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <div style={label}>Esito</div>
                  <select style={ipt} value={actDraft.outcome_label} onChange={e=>setActDraft((d:any)=>({ ...d, outcome_label:e.target.value }))}>
                    {OUTCOME_OPTIONS_UI.map(o=> <option key={o.db} value={o.label}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn:'1 / span 4' }}>
                  <div style={label}>Note</div>
                  <textarea rows={2} maxLength={240} style={{ ...ipt, width:'100%' }} value={actDraft.notes||''} onChange={e=>setActDraft((d:any)=>({ ...d, notes:e.target.value }))} />
                </div>
              </div>
              <div>
                {editingActId ? (
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    <button className="brand-btn" onClick={async()=>{
                      if (!selectedId) return
                      const payload = { ts: actDraft.ts || new Date().toISOString(), channel: channelDbFromLabel(actDraft.channel_label), outcome: outcomeDbFromLabel(actDraft.outcome_label), notes: actDraft.notes||null }
                      const { error } = await supabase.from('activities').update(payload).eq('id', editingActId)
                      if (error) alert(error.message); else { setEditingActId(null); setActDraft({ ts:'', channel_label:'Telefono', outcome_label:'Parlato', notes:'' }); await loadActivities(selectedId); await loadLeads() }
                    }}>Salva</button>
                    <button className="brand-btn" onClick={()=>{ setEditingActId(null); setActDraft({ ts:'', channel_label:'Telefono', outcome_label:'Parlato', notes:'' }) }}>Annulla</button>
                  </div>
                ) : (
                  <button className="brand-btn" onClick={async()=>{
                    if (!selectedId){ alert('Seleziona prima un Lead'); return }
                    const payload = { lead_id: selectedId, ts: actDraft.ts || new Date().toISOString(), channel: channelDbFromLabel(actDraft.channel_label), outcome: outcomeDbFromLabel(actDraft.outcome_label), notes: actDraft.notes||null }
                    const { error } = await supabase.from('activities').insert(payload)
                    if (error) alert(error.message); else { setActDraft({ ts:'', channel_label:'Telefono', outcome_label:'Parlato', notes:'' }); await loadActivities(selectedId); await loadLeads() }
                  }}>Aggiungi contatto</button>
                )}
              </div>

              <div>
                {activities.map(r=> (
                  <div key={r.id} style={{ border:'1px solid var(--border, #eee)', borderRadius:10, padding:10, marginBottom:8, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                    <div>
                      <div style={{ fontWeight:600 }}>{new Date(r.ts).toLocaleString()}</div>
                      <div style={{ fontSize:12, color:'var(--muted, #666)' }}>Canale: {CHANNEL_OPTIONS_UI.find(o=>o.db===r.channel)?.label || r.channel} · Esito: {OUTCOME_OPTIONS_UI.find(o=>o.db===r.outcome)?.label || r.outcome}</div>
                      {r.notes && <div style={{ fontSize:12 }}>{r.notes}</div>}
                    </div>
                    <div style={{ display:'inline-flex', gap:6 }}>
                      <button title="Modifica" onClick={()=>{ setEditingActId(r.id); setActDraft({ ts: r.ts? r.ts.slice(0,16):'', channel_label: CHANNEL_OPTIONS_UI.find(o=>o.db===r.channel)?.label || 'Telefono', outcome_label: OUTCOME_OPTIONS_UI.find(o=>o.db===r.outcome)?.label || 'Parlato', notes: r.notes||'' }) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>✏️</button>
                      <button title="Elimina" onClick={async()=>{ if (!selectedId) return; const ok = confirm('Eliminare il contatto?'); if (!ok) return; const { error } = await supabase.from('activities').delete().eq('id', r.id); if (error) alert(error.message); else { await loadActivities(selectedId); await loadLeads() } }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* -------- APPUNTAMENTI -------- */}
          {activeTab==='appuntamenti' && (
            <div style={{ display:'grid', gap:12 }}>
              <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr) minmax(0,2fr)', gap:12 }}>
                <div>
                  <div style={label}>Data/Ora</div>
                  <input type="datetime-local" style={ipt} value={appDraft.ts} onChange={e=>setAppDraft((d:any)=>({ ...d, ts: e.target.value }))} />
                </div>
                <div>
                  <div style={label}>Modalita</div>
                  <select style={ipt} value={appDraft.mode_label} onChange={e=>setAppDraft((d:any)=>({ ...d, mode_label:e.target.value }))}>
                    {MODE_OPTIONS_UI.map(o=> <option key={o.db} value={o.label}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn:'1 / span 3' }}>
                  <div style={label}>Note</div>
                  <textarea rows={2} maxLength={240} style={{ ...ipt, width:'100%' }} value={appDraft.notes||''} onChange={e=>setAppDraft((d:any)=>({ ...d, notes:e.target.value }))} />
                </div>
              </div>
              <div>
                {editingAppId ? (
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    <button className="brand-btn" onClick={async()=>{
                      if (!selectedId) return
                      const payload = { ts: appDraft.ts || new Date().toISOString(), mode: modeDbFromLabel(appDraft.mode_label), notes: appDraft.notes||null }
                      const { error } = await supabase.from('appointments').update(payload).eq('id', editingAppId)
                      if (error) alert(error.message); else { setEditingAppId(null); setAppDraft({ ts:'', mode_label:'In presenza', notes:'' }); await loadAppointments(selectedId); await loadLeads() }
                    }}>Salva</button>
                    <button className="brand-btn" onClick={()=>{ setEditingAppId(null); setAppDraft({ ts:'', mode_label:'In presenza', notes:'' }) }}>Annulla</button>
                  </div>
                ) : (
                  <button className="brand-btn" onClick={async()=>{
                    if (!selectedId){ alert('Seleziona prima un Lead'); return }
                    const payload = { lead_id: selectedId, ts: appDraft.ts || new Date().toISOString(), mode: modeDbFromLabel(appDraft.mode_label), notes: appDraft.notes||null }
                    const { error } = await supabase.from('appointments').insert(payload)
                    if (error) alert(error.message); else { setAppDraft({ ts:'', mode_label:'In presenza', notes:'' }); await loadAppointments(selectedId); await loadLeads() }
                  }}>Aggiungi appuntamento</button>
                )}
              </div>

              <div>
                {appointments.map(r=> (
                  <div key={r.id} style={{ border:'1px solid var(--border, #eee)', borderRadius:10, padding:10, marginBottom:8, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                    <div>
                      <div style={{ fontWeight:600 }}>{new Date(r.ts).toLocaleString()}</div>
                      <div style={{ fontSize:12, color:'var(--muted, #666)' }}>Modalita: {MODE_OPTIONS_UI.find(o=>o.db===r.mode)?.label || r.mode}</div>
                      {r.notes && <div style={{ fontSize:12 }}>{r.notes}</div>}
                    </div>
                    <div style={{ display:'inline-flex', gap:6 }}>
                      <button title="Modifica" onClick={()=>{ setEditingAppId(r.id); setAppDraft({ ts: r.ts? r.ts.slice(0,16):'', mode_label: MODE_OPTIONS_UI.find(o=>o.db===r.mode)?.label || 'In presenza', notes: r.notes||'' }) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>✏️</button>
                      <button title="Elimina" onClick={async()=>{ if (!selectedId) return; const ok = confirm('Eliminare l\'appuntamento?'); if (!ok) return; const { error } = await supabase.from('appointments').delete().eq('id', r.id); if (error) alert(error.message); else { await loadAppointments(selectedId); await loadLeads() } }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* -------- PROPOSTE -------- */}
          {activeTab==='proposte' && (
            <div style={{ display:'grid', gap:12 }}>
              <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,2fr) minmax(0,1fr)', gap:12 }}>
                <div>
                  <div style={label}>Data/Ora</div>
                  <input type="datetime-local" style={ipt} value={propDraft.ts} onChange={e=>setPropDraft((d:any)=>({ ...d, ts: e.target.value }))} />
                </div>
                <div>
                  <div style={label}>Linea/Descrizione</div>
                  <input style={ipt} value={propDraft.line} onChange={e=>setPropDraft((d:any)=>({ ...d, line:e.target.value }))} />
                </div>
                <div>
                  <div style={label}>Importo (EUR)</div>
                  <input type="number" style={ipt} value={propDraft.amount||0} onChange={e=>setPropDraft((d:any)=>({ ...d, amount: Number(e.target.value||0) }))} />
                </div>
                <div style={{ gridColumn:'1 / span 3' }}>
                  <div style={label}>Note</div>
                  <textarea rows={2} maxLength={240} style={{ ...ipt, width:'100%' }} value={propDraft.notes||''} onChange={e=>setPropDraft((d:any)=>({ ...d, notes:e.target.value }))} />
                </div>
              </div>

              <div>
                {editingPropId ? (
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    <button className="brand-btn" onClick={async()=>{
                      if (!selectedId) return
                      const payload = { ts: propDraft.ts || new Date().toISOString(), line: propDraft.line, amount: propDraft.amount||0, notes: propDraft.notes||null }
                      const { error } = await supabase.from('proposals').update(payload).eq('id', editingPropId)
                      if (error) alert(error.message); else { setEditingPropId(null); setPropDraft({ ts:'', line:'', amount:0, notes:'' }); await loadProposals(selectedId); await loadLeads() }
                    }}>Salva</button>
                    <button className="brand-btn" onClick={()=>{ setEditingPropId(null); setPropDraft({ ts:'', line:'', amount:0, notes:'' }) }}>Annulla</button>
                  </div>
                ) : (
                  <button className="brand-btn" onClick={async()=>{
                    if (!selectedId){ alert('Seleziona prima un Lead'); return }
                    const payload = { lead_id: selectedId, ts: propDraft.ts || new Date().toISOString(), line: propDraft.line, amount: propDraft.amount||0, notes: propDraft.notes||null }
                    const { error } = await supabase.from('proposals').insert(payload)
                    if (error) alert(error.message); else { setPropDraft({ ts:'', line:'', amount:0, notes:'' }); await loadProposals(selectedId); await loadLeads() }
                  }}>Aggiungi proposta</button>
                )}
              </div>

              <div>
                {proposals.map(r=> (
                  <div key={r.id} style={{ border:'1px solid var(--border, #eee)', borderRadius:10, padding:10, marginBottom:8, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                    <div>
                      <div style={{ fontWeight:600 }}>{new Date(r.ts).toLocaleString()}</div>
                      <div style={{ fontSize:12, color:'var(--muted, #666)' }}>Linea: {r.line} · Importo: {Number(r.amount||0).toLocaleString('it-IT',{ style:'currency', currency:'EUR' })}</div>
                      {r.notes && <div style={{ fontSize:12 }}>{r.notes}</div>}
                    </div>
                    <div style={{ display:'inline-flex', gap:6 }}>
                      <button title="Modifica" onClick={()=>{ setEditingPropId(r.id); setPropDraft({ ts: r.ts? r.ts.slice(0,16):'', line: r.line||'', amount: Number(r.amount||0), notes: r.notes||'' }) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>✏️</button>
                      <button title="Elimina" onClick={async()=>{ if (!selectedId) return; const ok = confirm('Eliminare la proposta?'); if (!ok) return; const { error } = await supabase.from('proposals').delete().eq('id', r.id); if (error) alert(error.message); else { await loadProposals(selectedId); await loadLeads() } }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* -------- CONTRATTI -------- */}
          {activeTab==='contratti' && (
            <div style={{ display:'grid', gap:12 }}>
              <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)', gap:12 }}>
                <div>
                  <div style={label}>Data/Ora</div>
                  <input type="datetime-local" style={ipt} value={ctrDraft.ts} onChange={e=>setCtrDraft((d:any)=>({ ...d, ts: e.target.value }))} />
                </div>
                <div>
                  <div style={label}>Tipo contratto</div>
                  <select style={ipt} value={ctrDraft.contract_type} onChange={e=>setCtrDraft((d:any)=>({ ...d, contract_type: e.target.value }))}>
                    {CONTRACT_TYPE_OPTIONS.map(o=> <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <div style={label}>Importo (EUR)</div>
                  <input type="number" style={ipt} value={ctrDraft.amount||0} onChange={e=>setCtrDraft((d:any)=>({ ...d, amount: Number(e.target.value||0) }))} />
                </div>
                <div style={{ gridColumn:'1 / span 3' }}>
                  <div style={label}>Note</div>
                  <textarea rows={2} maxLength={240} style={{ ...ipt, width:'100%' }} value={ctrDraft.notes||''} onChange={e=>setCtrDraft((d:any)=>({ ...d, notes:e.target.value }))} />
                </div>
              </div>

              <div>
                {editingCtrId ? (
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    <button className="brand-btn" onClick={async()=>{
                      if (!selectedId) return
                      const payload = { ts: ctrDraft.ts || new Date().toISOString(), contract_type: ctrDraft.contract_type, amount: Number(ctrDraft.amount||0), notes: ctrDraft.notes||null }
                      const { error } = await supabase.from('contracts').update(payload).eq('id', editingCtrId)
                      if (error) alert(error.message); else { setEditingCtrId(null); setCtrDraft({ ts:'', contract_type: CONTRACT_TYPE_OPTIONS[0].value, amount:0, notes:'' }); await loadContracts(selectedId); await loadLeads() }
                    }}>Salva</button>
                    <button className="brand-btn" onClick={()=>{ setEditingCtrId(null); setCtrDraft({ ts:'', contract_type: CONTRACT_TYPE_OPTIONS[0].value, amount:0, notes:'' }) }}>Annulla</button>
                  </div>
                ) : (
                  <button className="brand-btn" onClick={async()=>{
                    if (!selectedId){ alert('Seleziona prima un Lead'); return }
                    const payload = { lead_id: selectedId, ts: ctrDraft.ts || new Date().toISOString(), contract_type: ctrDraft.contract_type, amount: Number(ctrDraft.amount||0), notes: ctrDraft.notes||null }
                    const { error } = await supabase.from('contracts').insert(payload)
                    if (error) alert(error.message); else { setCtrDraft({ ts:'', contract_type: CONTRACT_TYPE_OPTIONS[0].value, amount:0, notes:'' }); await loadContracts(selectedId); await loadLeads() }
                  }}>Aggiungi contratto</button>
                )}
              </div>

              <div>
                {contracts.map(r=> (
                  <div key={r.id} style={{ border:'1px solid var(--border, #eee)', borderRadius:10, padding:10, marginBottom:8, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                    <div>
                      <div style={{ fontWeight:600 }}>{new Date(r.ts).toLocaleString()}</div>
                      <div style={{ fontSize:12, color:'var(--muted, #666)' }}>Tipo: {r.contract_type} · Importo: {Number(r.amount||0).toLocaleString('it-IT',{ style:'currency', currency:'EUR' })}</div>
                      {r.notes && <div style={{ fontSize:12 }}>{r.notes}</div>}
                    </div>
                    <div style={{ display:'inline-flex', gap:6 }}>
                      <button title="Modifica" onClick={()=>{ setEditingCtrId(r.id); setCtrDraft({ ts: r.ts? r.ts.slice(0,16):'', contract_type: r.contract_type, amount: Number(r.amount||0), notes: r.notes||'' }) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>✏️</button>
                      <button title="Elimina" onClick={async()=>{ if (!selectedId) return; const ok = confirm('Eliminare il contratto?'); if (!ok) return; const { error } = await supabase.from('contracts').delete().eq('id', r.id); if (error) alert(error.message); else { await loadContracts(selectedId); await loadLeads() } }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirm Delete Modal semplice */}
      {confirmDeleteId && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'grid', placeItems:'center' }}>
          <div style={{ background:'#fff', padding:16, borderRadius:12, width:320 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>Eliminare il Lead?</div>
            <div style={{ fontSize:13, color:'#555', marginBottom:12 }}>L'operazione non e reversibile.</div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
              <button onClick={()=>setConfirmDeleteId(null)} className="brand-btn">Annulla</button>
              <button onClick={()=>{ void deleteLead(confirmDeleteId) }} className="brand-btn" style={{ background:'#c00', borderColor:'#c00', color:'#fff' }}>Elimina</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// === piccoli componenti UI per la lista sinistra ===
function Toggle({ label, active, onClick }:{ label:string, active:boolean, onClick:()=>void }){
  return (
    <button
      className="brand-btn"
      onClick={onClick}
      style={ active
        ? { background: 'var(--brand-primary-600, #0029ae)', color:'#fff', borderColor:'var(--brand-primary-600, #0029ae)' }
        : { background:'#fff', color:'#111', borderColor:'var(--border, #ddd)' }
      }
    >{label}</button>
  )
}
function Pill({ children }:{ children: React.ReactNode }){
  return <span style={{ fontSize:11, padding:'2px 8px', borderRadius:999, border:'1px solid #e5e7eb' }}>{children}</span>
}
