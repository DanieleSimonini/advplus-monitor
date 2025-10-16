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

// 🔧 PATCH: aggiunto team_lead_user_id per calcolare il team
type AdvisorRow = {
  user_id: string | null,
  email: string,
  full_name: string | null,
  role: Role,
  team_lead_user_id?: string | null
}

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
  // 🔧 PATCH: owner del team per visibilità TL
  const [teamOwnerIds, setTeamOwnerIds] = useState<string[]>([])

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

  // bootstrap (sequenziale per calcolare prima il team)
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
      // carico advisors (calcola teamOwnerIds) e poi i leads filtrati
      await loadAdvisors()
      await loadLeads()
    } catch(ex:any){ setErr(ex.message || 'Errore inizializzazione') }
    finally{ setLoading(false) }
  })() },[])

  // 🔧 ricarica leads se cambia la composizione del team (es. TL)
  useEffect(()=>{
    if (meRole === 'Team Lead'){ void loadLeads() }
  }, [teamOwnerIds, meRole])

  // carica leads
  async function loadLeads(){
    const { data, error } = await supabase
      .from('leads')
      .select('id,owner_id,is_agency_client,first_name,last_name,company_name,email,phone,city,address,source,created_at,is_working')
      .order('created_at', { ascending:false })
    if (error){ setErr(error.message); return }
    let arr = (data || []) as Lead[]

    // 🔧 PATCH: visibilità per ruolo
    if (meRole === 'Junior' && meUid){
      arr = arr.filter(l => l.owner_id === meUid)
    } else if (meRole === 'Team Lead'){
      const owners = teamOwnerIds.length ? teamOwnerIds : (meUid ? [meUid] : [])
      if (owners.length){
        const setOwners = new Set(owners)
        arr = arr.filter(l => l.owner_id && setOwners.has(l.owner_id))
      }
      // Admin → nessun filtro; se owners vuoto, lascio tutto (fallback a RLS)
    }

    setLeads(arr)
    // carica aggregati per i lead visibili
    await loadAggregates(arr.map(x=>x.id!).filter(Boolean))
  }

  async function loadAdvisors(){
    const { data } = await supabase
      .from('advisors')
      .select('user_id,email,full_name,role,team_lead_user_id')
      .order('full_name', { ascending:true })
    const list = (data||[]) as AdvisorRow[]
    setAdvisors(list)

    // 🔧 PATCH: calcolo owner del team per TL
    if (meRole === 'Team Lead' && meUid){
      const juniors = list
        .filter(a => a.role==='Junior' && a.team_lead_user_id === meUid && !!a.user_id)
        .map(a => a.user_id!) // garantito non null
      setTeamOwnerIds(Array.from(new Set([...juniors, meUid])))
    } else if (meRole === 'Admin'){
      setTeamOwnerIds([]) // non serve filtro (tutti)
    } else {
      setTeamOwnerIds(meUid ? [meUid] : [])
    }
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

    // ii. Contattato / Appuntamento / Proposta / Contra
