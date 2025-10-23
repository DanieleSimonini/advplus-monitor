import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * Leads.tsx — Versione Enhanced per Team Lead
 * 
 * NOVITÀ:
 * - Team Lead può vedere i suoi Junior nell'elenco advisors
 * - Team Lead può creare leads e assegnarli direttamente ai Junior
 * - Team Lead può gestire contatti/appuntamenti/proposte/contratti sui leads dei Junior
 * - Filtro "I miei Junior" per vedere tutti i leads assegnati ai membri del team
 */

// === Opzioni UI ===
const CHANNEL_OPTIONS_UI = [
  { label: 'Telefono', db: 'phone' },
  { label: 'Email', db: 'email' },
  { label: 'WhatsApp', db: 'phone' },
  { label: 'SMS', db: 'phone' },
  { label: 'Altro', db: 'phone' },
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

type SortKey =
  | 'last_name_az'
  | 'first_name_az'
  | 'created_desc'
  | 'last_activity_desc'
  | 'last_appointment_desc'
  | 'last_proposal_desc'
  | 'last_contract_desc'

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
  const [meRole, setMeRole] = useState<Role>('Junior')
  const [meUid, setMeUid] = useState<string>('')

  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [advisors, setAdvisors] = useState<AdvisorRow[]>([])
  
  // NUOVO: Lista dei Junior del Team Lead
  const [myJuniors, setMyJuniors] = useState<AdvisorRow[]>([])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const initForm: FormState = { is_agency_client:false, first_name:'', last_name:'', company_name:'', email:'', phone:'', city:'', address:'', source:'' }
  const [form, setForm] = useState<FormState>(initForm)

  const [page, setPage] = useState(1)
  const PAGESIZE = 50

  // NUOVO: Filtro "I miei Junior" per Team Lead
  const [filterMyJuniors, setFilterMyJuniors] = useState(false)
  const [filterOwner, setFilterOwner] = useState('')
  const [filterState, setFilterState] = useState('')
  const [filterSearchText, setFilterSearchText] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('created_desc')

  const [contacts, setContacts] = useState<any[]>([])
  const [appointments, setAppointments] = useState<any[]>([])
  const [proposals, setProposals] = useState<any[]>([])
  const [contracts, setContracts] = useState<any[]>([])

  const [activeTab, setActiveTab] = useState<'info'|'contatti'|'appuntamenti'|'proposte'|'contratti'>('info')

  const [contactDraft, setContactDraft] = useState({ ts:'', channel_label:'Telefono', outcome_label:'Parlato', notes:'' })
  const [editingContactId, setEditingContactId] = useState<string | null>(null)

  const [appDraft, setAppDraft] = useState({ ts:'', mode_label:'In presenza', notes:'' })
  const [editingAppId, setEditingAppId] = useState<string | null>(null)

  const [propDraft, setPropDraft] = useState({ ts:'', line:'', amount:0, notes:'' })
  const [editingPropId, setEditingPropId] = useState<string | null>(null)

  const [ctrDraft, setCtrDraft] = useState({ ts:'', contract_type: CONTRACT_TYPE_OPTIONS[0].value, amount:0, notes:'' })
  const [editingCtrId, setEditingCtrId] = useState<string | null>(null)

  const [aggsMap, setAggsMap] = useState<Map<string,Aggs>>(new Map())

  // Init
  useEffect(()=>{ void init() }, [])

  async function init(){
    setLoading(true); setErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Non autenticato')
      setMeUid(user.id)

      const { data: pData, error: pErr } = await supabase.from('advisor_profiles').select('role').eq('user_id', user.id).single()
      if (pErr || !pData) throw new Error('Profilo non trovato')
      setMeRole(pData.role as Role)

      await loadAdvisors()
      
      // NUOVO: Se sono Team Lead, carico i miei Junior
      if (pData.role === 'Team Lead') {
        await loadMyJuniors()
      }
      
      await loadLeads()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadAdvisors(){
    const { data, error } = await supabase
      .from('advisor_profiles')
      .select('user_id, email, full_name, role')
      .order('full_name', { ascending: true })
    if (error) { console.error(error); return }
    setAdvisors((data||[]) as AdvisorRow[])
  }

  // NUOVO: Carica i Junior del Team Lead
  async function loadMyJuniors(){
    const { data, error } = await supabase
      .from('advisor_profiles')
      .select('user_id, email, full_name, role')
      .eq('role', 'Junior')
      .order('full_name', { ascending: true })
    
    if (error) { 
      console.error('Errore caricamento junior:', error)
      return 
    }
    
    // Per ora tutti i Junior sono considerati del team
    // In futuro si può aggiungere una tabella team_members per filtrare
    setMyJuniors((data||[]) as AdvisorRow[])
  }

  async function loadLeads(){
    const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending:false })
    if (error) { console.error(error); return }
    setLeads((data||[]) as Lead[])
    if (data && data.length>0) await loadAllAggs(data.map(l=>l.id!))
  }

  async function loadAllAggs(ids: string[]){
    const [cData, aData, pData, ctData] = await Promise.all([
      supabase.from('contacts').select('*').in('lead_id', ids),
      supabase.from('appointments').select('*').in('lead_id', ids),
      supabase.from('proposals').select('*').in('lead_id', ids),
      supabase.from('contracts').select('*').in('lead_id', ids),
    ])
    const m = new Map<string,Aggs>()
    for (const lid of ids){
      const conts = (cData.data||[]).filter(x=>x.lead_id===lid)
      const apps = (aData.data||[]).filter(x=>x.lead_id===lid)
      const props = (pData.data||[]).filter(x=>x.lead_id===lid)
      const ctrs = (ctData.data||[]).filter(x=>x.lead_id===lid)
      
      conts.sort((a,b)=> (b.ts||'').localeCompare(a.ts||''))
      apps.sort((a,b)=> (b.ts||'').localeCompare(a.ts||''))
      props.sort((a,b)=> (b.ts||'').localeCompare(a.ts||''))
      ctrs.sort((a,b)=> (b.ts||'').localeCompare(a.ts||''))
      
      const agg: Aggs = {
        contactsCount: conts.length,
        lastContactTs: conts[0]?.ts,
        lastContactNote: conts[0]?.notes,
        appointmentsCount: apps.length,
        lastAppointmentTs: apps[0]?.ts,
        lastAppointmentNote: apps[0]?.notes,
        proposalsCount: props.length,
        lastProposalTs: props[0]?.ts,
        lastProposalNote: props[0]?.notes,
        contractsCount: ctrs.length,
        lastContractTs: ctrs[0]?.ts,
        lastContractNote: ctrs[0]?.notes,
        contractsSum: ctrs.reduce((s,c)=> s+Number(c.amount||0), 0)
      }
      m.set(lid, agg)
    }
    setAggsMap(m)
  }

  async function createOrUpdateLead(){
    if (!form.first_name || !form.last_name) {
      alert('Nome e Cognome obbligatori'); return
    }
    
    // MODIFICATO: Se non c'è owner_id e sono Team Lead, chiedo di selezionare un Junior
    if (meRole === 'Team Lead' && !form.owner_id && !editingLeadId) {
      alert('Seleziona un Junior a cui assegnare il lead')
      return
    }
    
    const payload: any = {
      is_agency_client: form.is_agency_client,
      first_name: form.first_name || null,
      last_name: form.last_name || null,
      company_name: form.company_name || null,
      email: form.email || null,
      phone: form.phone || null,
      city: form.city || null,
      address: form.address || null,
      source: form.source || null,
      is_working: form.is_working ?? null,
    }
    
    if (editingLeadId){
      if (form.owner_id !== undefined) payload.owner_id = form.owner_id
      const { error } = await supabase.from('leads').update(payload).eq('id', editingLeadId)
      if (error) { alert(error.message); return }
      setEditingLeadId(null)
    } else {
      // MODIFICATO: Team Lead può assegnare owner_id ai Junior
      if (meRole === 'Team Lead' && form.owner_id) {
        payload.owner_id = form.owner_id
      } else {
        payload.owner_id = meUid
      }
      
      const { error } = await supabase.from('leads').insert(payload)
      if (error) { alert(error.message); return }
    }
    
    setForm(initForm)
    await loadLeads()
  }

  async function deleteLead(id: string){
    const { error } = await supabase.from('leads').delete().eq('id', id)
    if (error) { alert(error.message); return }
    setConfirmDeleteId(null)
    if (selectedId===id) setSelectedId(null)
    await loadLeads()
  }

  function selectLead(l: Lead){
    setSelectedId(l.id!)
    setForm({
      id: l.id,
      owner_id: l.owner_id,
      is_agency_client: l.is_agency_client,
      first_name: l.first_name||'',
      last_name: l.last_name||'',
      company_name: l.company_name||'',
      email: l.email||'',
      phone: l.phone||'',
      city: l.city||'',
      address: l.address||'',
      source: (l.source||'') as any,
      is_working: l.is_working ?? undefined
    })
    setActiveTab('info')
    void loadContacts(l.id!)
    void loadAppointments(l.id!)
    void loadProposals(l.id!)
    void loadContracts(l.id!)
  }

  async function loadContacts(lid: string){
    const { data, error } = await supabase.from('contacts').select('*').eq('lead_id', lid).order('ts', { ascending:false })
    if (error) { console.error(error); return }
    setContacts(data||[])
  }

  async function loadAppointments(lid: string){
    const { data, error } = await supabase.from('appointments').select('*').eq('lead_id', lid).order('ts', { ascending:false })
    if (error) { console.error(error); return }
    setAppointments(data||[])
  }

  async function loadProposals(lid: string){
    const { data, error } = await supabase.from('proposals').select('*').eq('lead_id', lid).order('ts', { ascending:false })
    if (error) { console.error(error); return }
    setProposals(data||[])
  }

  async function loadContracts(lid: string){
    const { data, error } = await supabase.from('contracts').select('*').eq('lead_id', lid).order('ts', { ascending:false })
    if (error) { console.error(error); return }
    setContracts(data||[])
  }

  const filteredLeads = useMemo(()=>{
    let arr = [...leads]
    
    // NUOVO: Filtro "I miei Junior" per Team Lead
    if (filterMyJuniors && meRole === 'Team Lead') {
      const juniorIds = myJuniors.map(j => j.user_id).filter(Boolean)
      arr = arr.filter(l => l.owner_id && juniorIds.includes(l.owner_id))
    } else if (filterOwner) {
      arr = arr.filter(l => l.owner_id === filterOwner)
    }
    
    if (filterState){
      if (filterState==='contacted'){
        arr = arr.filter(l => {
          const a = aggsMap.get(l.id!)
          return a && a.contactsCount>0
        })
      } else if (filterState==='appointment'){
        arr = arr.filter(l => {
          const a = aggsMap.get(l.id!)
          return a && a.appointmentsCount>0
        })
      } else if (filterState==='proposal'){
        arr = arr.filter(l => {
          const a = aggsMap.get(l.id!)
          return a && a.proposalsCount>0
        })
      } else if (filterState==='contract'){
        arr = arr.filter(l => {
          const a = aggsMap.get(l.id!)
          return a && a.contractsCount>0
        })
      }
    }
    
    if (filterSearchText){
      const q = filterSearchText.toLowerCase()
      arr = arr.filter(l => {
        const full = `${l.last_name||''} ${l.first_name||''}`.toLowerCase()
        return full.includes(q)
      })
    }
    
    arr.sort((a,b)=>{
      if (sortKey==='last_name_az') return (a.last_name||'').localeCompare(b.last_name||'')
      if (sortKey==='first_name_az') return (a.first_name||'').localeCompare(b.first_name||'')
      if (sortKey==='created_desc') return (b.created_at||'').localeCompare(a.created_at||'')
      
      const aAgg = aggsMap.get(a.id!)
      const bAgg = aggsMap.get(b.id!)
      
      if (sortKey==='last_activity_desc'){
        const aMax = [aAgg?.lastContactTs, aAgg?.lastAppointmentTs, aAgg?.lastProposalTs, aAgg?.lastContractTs]
          .filter(Boolean).sort((x,y)=>y!.localeCompare(x!))[0]||''
        const bMax = [bAgg?.lastContactTs, bAgg?.lastAppointmentTs, bAgg?.lastProposalTs, bAgg?.lastContractTs]
          .filter(Boolean).sort((x,y)=>y!.localeCompare(x!))[0]||''
        return bMax.localeCompare(aMax)
      }
      
      if (sortKey==='last_appointment_desc') return (bAgg?.lastAppointmentTs||'').localeCompare(aAgg?.lastAppointmentTs||'')
      if (sortKey==='last_proposal_desc') return (bAgg?.lastProposalTs||'').localeCompare(aAgg?.lastProposalTs||'')
      if (sortKey==='last_contract_desc') return (bAgg?.lastContractTs||'').localeCompare(aAgg?.lastContractTs||'')
      
      return 0
    })
    
    return arr
  }, [leads, filterMyJuniors, filterOwner, filterState, filterSearchText, sortKey, aggsMap, meRole, myJuniors])

  const totalPages = Math.ceil(filteredLeads.length / PAGESIZE)
  const paginatedLeads = filteredLeads.slice((page-1)*PAGESIZE, page*PAGESIZE)

  function exportCSV(){
    const rows = filteredLeads.map(l=>{
      const a = aggsMap.get(l.id!)
      const owner = advisors.find(x=>x.user_id===l.owner_id)
      return {
        Cognome: l.last_name||'',
        Nome: l.first_name||'',
        Azienda: l.company_name||'',
        Email: l.email||'',
        Telefono: l.phone||'',
        Città: l.city||'',
        Indirizzo: l.address||'',
        Fonte: l.source||'',
        Assegnatario: owner?.full_name||owner?.email||'',
        'Cliente Agenzia': l.is_agency_client?'Sì':'No',
        Contatti: a?.contactsCount||0,
        'Ultimo Contatto': a?.lastContactTs? new Date(a.lastContactTs).toLocaleString():'',
        'Nota Contatto': a?.lastContactNote||'',
        Appuntamenti: a?.appointmentsCount||0,
        'Ultimo Appuntamento': a?.lastAppointmentTs? new Date(a.lastAppointmentTs).toLocaleString():'',
        'Nota Appuntamento': a?.lastAppointmentNote||'',
        Proposte: a?.proposalsCount||0,
        'Ultima Proposta': a?.lastProposalTs? new Date(a.lastProposalTs).toLocaleString():'',
        'Nota Proposta': a?.lastProposalNote||'',
        Contratti: a?.contractsCount||0,
        'Ultimo Contratto': a?.lastContractTs? new Date(a.lastContractTs).toLocaleString():'',
        'Nota Contratto': a?.lastContractNote||'',
        'Somma Contratti (EUR)': a?.contractsSum||0,
      }
    })
    
    if (rows.length===0) { alert('Nessun lead da esportare'); return }
    
    const headers = Object.keys(rows[0])
    let csv = headers.join(',')+'\n'
    rows.forEach(r=>{
      csv += headers.map(h => {
        const val = (r as any)[h]
        if (typeof val==='string' && (val.includes(',') || val.includes('"') || val.includes('\n'))){
          return `"${val.replace(/"/g,'""')}"`
        }
        return val
      }).join(',')+'\n'
    })
    
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `leads_export_${new Date().toISOString().slice(0,10)}.csv`
    link.click()
  }

  if (loading) return <div style={{ padding:20 }}>Caricamento...</div>
  if (err) return <div style={{ padding:20, color:'#c00' }}>{err}</div>

  const canEdit = (l: Lead) => {
    if (meRole==='Admin') return true
    // MODIFICATO: Team Lead può modificare i leads dei suoi Junior
    if (meRole==='Team Lead') {
      const isMyJunior = myJuniors.some(j => j.user_id === l.owner_id)
      return l.owner_id === meUid || isMyJunior
    }
    return l.owner_id === meUid
  }

  const selectedLead = leads.find(l=>l.id===selectedId)
  const selOwner = selectedLead ? advisors.find(a=>a.user_id===selectedLead.owner_id) : null

  return (
    <div style={{ display:'grid', gridTemplateColumns:'480px 1fr', gap:24, height:'100vh', overflow:'hidden', padding:20, boxSizing:'border-box' }}>
      {/* SINISTRA: Elenco */}
      <div style={{ display:'flex', flexDirection:'column', gap:12, overflow:'hidden' }}>
        <div style={box}>
          <div style={{ fontWeight:700, fontSize:18, marginBottom:12 }}>Leads</div>
          
          {/* NUOVO: Filtro "I miei Junior" per Team Lead */}
          {meRole === 'Team Lead' && (
            <div style={{ marginBottom:12 }}>
              <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={filterMyJuniors} 
                  onChange={e => {
                    setFilterMyJuniors(e.target.checked)
                    if (e.target.checked) setFilterOwner('')
                  }}
                />
                <span style={{ fontSize:14, fontWeight:600, color:'var(--primary, #0066cc)' }}>
                  🎯 Mostra leads dei miei Junior ({myJuniors.length} Junior)
                </span>
              </label>
            </div>
          )}
          
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
            <div>
              <div style={label}>Assegnatario</div>
              <select 
                style={ipt} 
                value={filterOwner} 
                onChange={e=>{
                  setFilterOwner(e.target.value)
                  if (e.target.value) setFilterMyJuniors(false)
                }}
                disabled={filterMyJuniors}
              >
                <option value="">Tutti</option>
                {advisors.map(a=> <option key={a.user_id} value={a.user_id!}>{a.full_name||a.email}</option>)}
              </select>
            </div>
            <div>
              <div style={label}>Stato</div>
              <select style={ipt} value={filterState} onChange={e=>setFilterState(e.target.value)}>
                <option value="">Tutti</option>
                <option value="contacted">Contattati</option>
                <option value="appointment">Con appuntamento</option>
                <option value="proposal">Con proposta</option>
                <option value="contract">Con contratto</option>
              </select>
            </div>
          </div>
          
          <div style={{ marginBottom:8 }}>
            <div style={label}>Cerca (Cognome+Nome)</div>
            <input style={ipt} placeholder="es. Rossi Mario" value={filterSearchText} onChange={e=>setFilterSearchText(e.target.value)} />
          </div>
          
          <div style={{ marginBottom:8 }}>
            <div style={label}>Ordina per</div>
            <select style={ipt} value={sortKey} onChange={e=>setSortKey(e.target.value as SortKey)}>
              <option value="created_desc">Più recenti</option>
              <option value="last_name_az">Cognome A-Z</option>
              <option value="first_name_az">Nome A-Z</option>
              <option value="last_activity_desc">Ultima attività</option>
              <option value="last_appointment_desc">Ultimo appuntamento</option>
              <option value="last_proposal_desc">Ultima proposta</option>
              <option value="last_contract_desc">Ultimo contratto</option>
            </select>
          </div>
          
          <div style={{ display:'flex', gap:8, marginTop:8 }}>
            <button className="brand-btn" onClick={exportCSV}>Esporta CSV</button>
            <button className="brand-btn" onClick={()=>{ setForm(initForm); setEditingLeadId(null); setSelectedId(null) }}>+ Nuovo Lead</button>
          </div>
        </div>

        <div style={{ ...box, flex:1, overflow:'auto' }}>
          <div style={{ fontWeight:600, marginBottom:8 }}>
            {filteredLeads.length} Lead{filteredLeads.length!==1?'s':''} 
            {filterMyJuniors && <span style={{ color:'var(--primary, #0066cc)', marginLeft:8 }}>({myJuniors.map(j=>j.full_name||j.email).join(', ')})</span>}
          </div>
          
          {paginatedLeads.map(l=>{
            const agg = aggsMap.get(l.id!)
            const owner = advisors.find(a=>a.user_id===l.owner_id)
            const isSelected = l.id===selectedId
            
            return (
              <div 
                key={l.id} 
                onClick={()=>selectLead(l)}
                style={{ 
                  border:`1px solid ${isSelected?'var(--primary, #0066cc)':'var(--border, #eee)'}`,
                  borderRadius:10,
                  padding:10,
                  marginBottom:8,
                  cursor:'pointer',
                  background: isSelected?'var(--primary-light, #e6f2ff)':'#fff'
                }}
              >
                <div style={{ fontWeight:600, fontSize:14 }}>{l.last_name} {l.first_name}</div>
                <div style={{ fontSize:12, color:'var(--muted, #666)' }}>
                  {l.company_name && <div>🏢 {l.company_name}</div>}
                  {l.email && <div>📧 {l.email}</div>}
                  {l.phone && <div>📞 {l.phone}</div>}
                  {owner && <div>👤 {owner.full_name||owner.email}</div>}
                </div>
                {agg && (
                  <div style={{ fontSize:11, color:'var(--muted, #888)', marginTop:4 }}>
                    📞 {agg.contactsCount} | 📅 {agg.appointmentsCount} | 📄 {agg.proposalsCount} | ✅ {agg.contractsCount}
                  </div>
                )}
              </div>
            )
          })}
          
          {totalPages>1 && (
            <div style={{ display:'flex', gap:8, marginTop:12, justifyContent:'center', alignItems:'center' }}>
              <button className="brand-btn" disabled={page===1} onClick={()=>setPage(p=>p-1)}>←</button>
              <span style={{ fontSize:13 }}>Pagina {page} di {totalPages}</span>
              <button className="brand-btn" disabled={page===totalPages} onClick={()=>setPage(p=>p+1)}>→</button>
            </div>
          )}
        </div>
      </div>

      {/* DESTRA: Scheda */}
      <div style={{ ...box, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        {!selectedId && !editingLeadId ? (
          <div style={{ flex:1, display:'grid', placeItems:'center', color:'var(--muted, #999)' }}>
            Seleziona un lead dall'elenco o crea un nuovo lead
          </div>
        ) : (
          <>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexShrink:0 }}>
              <div style={{ fontWeight:700, fontSize:18 }}>
                {editingLeadId ? 'Modifica Lead' : selectedId ? `${selectedLead?.last_name} ${selectedLead?.first_name}` : 'Nuovo Lead'}
              </div>
              {selectedLead && canEdit(selectedLead) && (
                <div style={{ display:'inline-flex', gap:6 }}>
                  <button title="Modifica" onClick={()=>setEditingLeadId(selectedId)} style={{ border:'none', background:'transparent', cursor:'pointer', fontSize:20 }}>✏️</button>
                  <button title="Elimina" onClick={()=>setConfirmDeleteId(selectedId)} style={{ border:'none', background:'transparent', cursor:'pointer', fontSize:20 }}>🗑️</button>
                </div>
              )}
            </div>

            {(!selectedId || editingLeadId) && (
              <div style={{ flex:1, overflow:'auto' }}>
                <div style={{ display:'grid', gap:12 }}>
                  <div style={row}>
                    <div>
                      <div style={label}>Nome*</div>
                      <input style={ipt} value={form.first_name} onChange={e=>setForm(f=>({ ...f, first_name:e.target.value }))} />
                    </div>
                    <div>
                      <div style={label}>Cognome*</div>
                      <input style={ipt} value={form.last_name} onChange={e=>setForm(f=>({ ...f, last_name:e.target.value }))} />
                    </div>
                  </div>

                  <div>
                    <div style={label}>Azienda</div>
                    <input style={ipt} value={form.company_name} onChange={e=>setForm(f=>({ ...f, company_name:e.target.value }))} />
                  </div>

                  <div style={row}>
                    <div>
                      <div style={label}>Email</div>
                      <input type="email" style={ipt} value={form.email} onChange={e=>setForm(f=>({ ...f, email:e.target.value }))} />
                    </div>
                    <div>
                      <div style={label}>Telefono</div>
                      <input style={ipt} value={form.phone} onChange={e=>setForm(f=>({ ...f, phone:e.target.value }))} />
                    </div>
                  </div>

                  <div style={row}>
                    <div>
                      <div style={label}>Città</div>
                      <input style={ipt} value={form.city} onChange={e=>setForm(f=>({ ...f, city:e.target.value }))} />
                    </div>
                    <div>
                      <div style={label}>Indirizzo</div>
                      <input style={ipt} value={form.address} onChange={e=>setForm(f=>({ ...f, address:e.target.value }))} />
                    </div>
                  </div>

                  <div style={row}>
                    <div>
                      <div style={label}>Fonte</div>
                      <select style={ipt} value={form.source} onChange={e=>setForm(f=>({ ...f, source: e.target.value as any }))}>
                        <option value="">-- Seleziona --</option>
                        <option value="Provided">Provided</option>
                        <option value="Self">Self</option>
                      </select>
                    </div>
                    
                    {/* NUOVO: Se sono Team Lead, mostro dropdown per assegnare ai Junior */}
                    {meRole === 'Team Lead' && !editingLeadId && (
                      <div>
                        <div style={label}>Assegna a Junior*</div>
                        <select 
                          style={ipt} 
                          value={form.owner_id||''} 
                          onChange={e=>setForm(f=>({ ...f, owner_id:e.target.value }))}
                        >
                          <option value="">-- Seleziona Junior --</option>
                          {myJuniors.map(j=> (
                            <option key={j.user_id} value={j.user_id!}>
                              {j.full_name||j.email}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    
                    {(meRole === 'Admin' || (meRole === 'Team Lead' && editingLeadId)) && (
                      <div>
                        <div style={label}>Assegnatario</div>
                        <select style={ipt} value={form.owner_id||''} onChange={e=>setForm(f=>({ ...f, owner_id:e.target.value }))}>
                          <option value="">-- Nessuno --</option>
                          {advisors.map(a=> <option key={a.user_id} value={a.user_id!}>{a.full_name||a.email}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  <div>
                    <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                      <input type="checkbox" checked={!!form.is_agency_client} onChange={e=>setForm(f=>({ ...f, is_agency_client:e.target.checked }))} />
                      <span style={{ fontSize:14 }}>Cliente dell'Agenzia</span>
                    </label>
                  </div>

                  {editingLeadId && (
                    <div>
                      <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                        <input type="checkbox" checked={!!form.is_working} onChange={e=>setForm(f=>({ ...f, is_working:e.target.checked }))} />
                        <span style={{ fontSize:14 }}>In Lavorazione</span>
                      </label>
                    </div>
                  )}

                  <div style={{ display:'flex', gap:8, marginTop:8 }}>
                    {editingLeadId ? (
                      <>
                        <button className="brand-btn" onClick={createOrUpdateLead}>Salva</button>
                        <button className="brand-btn" onClick={()=>{ setEditingLeadId(null); selectLead(selectedLead!) }}>Annulla</button>
                      </>
                    ) : (
                      <>
                        <button className="brand-btn" onClick={createOrUpdateLead}>Crea Lead</button>
                        <button className="brand-btn" onClick={()=>{ setForm(initForm); setSelectedId(null) }}>Annulla</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {selectedId && !editingLeadId && (
              <>
                <div style={{ display:'flex', gap:8, marginBottom:12, flexShrink:0, borderBottom:'1px solid var(--border, #eee)', paddingBottom:8 }}>
                  {(['info','contatti','appuntamenti','proposte','contratti'] as const).map(t=> (
                    <button 
                      key={t}
                      className="brand-btn"
                      onClick={()=>setActiveTab(t)}
                      style={{ 
                        background: activeTab===t?'var(--primary, #0066cc)':'#f5f5f5',
                        color: activeTab===t?'#fff':'#333',
                        border: activeTab===t?'1px solid var(--primary, #0066cc)':'1px solid var(--border, #ddd)'
                      }}
                    >
                      {t.charAt(0).toUpperCase()+t.slice(1)}
                    </button>
                  ))}
                </div>

                <div style={{ flex:1, overflow:'auto' }}>
                  {activeTab==='info' && selectedLead && (
                    <div style={{ display:'grid', gap:8 }}>
                      <div><strong>Nome:</strong> {selectedLead.first_name}</div>
                      <div><strong>Cognome:</strong> {selectedLead.last_name}</div>
                      {selectedLead.company_name && <div><strong>Azienda:</strong> {selectedLead.company_name}</div>}
                      {selectedLead.email && <div><strong>Email:</strong> {selectedLead.email}</div>}
                      {selectedLead.phone && <div><strong>Telefono:</strong> {selectedLead.phone}</div>}
                      {selectedLead.city && <div><strong>Città:</strong> {selectedLead.city}</div>}
                      {selectedLead.address && <div><strong>Indirizzo:</strong> {selectedLead.address}</div>}
                      {selectedLead.source && <div><strong>Fonte:</strong> {selectedLead.source}</div>}
                      {selOwner && <div><strong>Assegnato a:</strong> {selOwner.full_name||selOwner.email}</div>}
                      <div><strong>Cliente Agenzia:</strong> {selectedLead.is_agency_client?'Sì':'No'}</div>
                      {selectedLead.is_working!==null && <div><strong>In Lavorazione:</strong> {selectedLead.is_working?'Sì':'No'}</div>}
                    </div>
                  )}

                  {/* CONTATTI */}
                  {activeTab==='contatti' && (
                    <div style={{ display:'grid', gap:12 }}>
                      <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)', gap:12 }}>
                        <div>
                          <div style={label}>Data/Ora</div>
                          <input type="datetime-local" style={ipt} value={contactDraft.ts} onChange={e=>setContactDraft((d:any)=>({ ...d, ts:e.target.value }))} />
                        </div>
                        <div>
                          <div style={label}>Canale</div>
                          <select style={ipt} value={contactDraft.channel_label} onChange={e=>setContactDraft((d:any)=>({ ...d, channel_label:e.target.value }))}>
                            {CHANNEL_OPTIONS_UI.map(o=> <option key={o.label} value={o.label}>{o.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <div style={label}>Esito</div>
                          <select style={ipt} value={contactDraft.outcome_label} onChange={e=>setContactDraft((d:any)=>({ ...d, outcome_label:e.target.value }))}>
                            {OUTCOME_OPTIONS_UI.map(o=> <option key={o.label} value={o.label}>{o.label}</option>)}
                          </select>
                        </div>
                        <div style={{ gridColumn:'1 / span 3' }}>
                          <div style={label}>Note</div>
                          <textarea rows={2} maxLength={240} style={{ ...ipt, width:'100%' }} value={contactDraft.notes||''} onChange={e=>setContactDraft((d:any)=>({ ...d, notes:e.target.value }))} />
                        </div>
                      </div>

                      <div>
                        {editingContactId ? (
                          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                            <button className="brand-btn" onClick={async()=>{
                              if (!selectedId) return
                              const payload = { ts: contactDraft.ts || new Date().toISOString(), channel: channelDbFromLabel(contactDraft.channel_label), outcome: outcomeDbFromLabel(contactDraft.outcome_label), notes: contactDraft.notes||null }
                              const { error } = await supabase.from('contacts').update(payload).eq('id', editingContactId)
                              if (error) alert(error.message); else { setEditingContactId(null); setContactDraft({ ts:'', channel_label:'Telefono', outcome_label:'Parlato', notes:'' }); await loadContacts(selectedId) }
                            }}>Salva</button>
                            <button className="brand-btn" onClick={()=>{ setEditingContactId(null); setContactDraft({ ts:'', channel_label:'Telefono', outcome_label:'Parlato', notes:'' }) }}>Annulla</button>
                          </div>
                        ) : (
                          <button className="brand-btn" onClick={async()=>{
                            if (!selectedId){ alert('Seleziona prima un Lead'); return }
                            const payload = { lead_id: selectedId, ts: contactDraft.ts || new Date().toISOString(), channel: channelDbFromLabel(contactDraft.channel_label), outcome: outcomeDbFromLabel(contactDraft.outcome_label), notes: contactDraft.notes||null }
                            const { error } = await supabase.from('contacts').insert(payload)
                            if (error) alert(error.message); else { setContactDraft({ ts:'', channel_label:'Telefono', outcome_label:'Parlato', notes:'' }); await loadContacts(selectedId) }
                          }}>Aggiungi contatto</button>
                        )}
                      </div>

                      <div>
                        {contacts.map(r=> (
                          <div key={r.id} style={{ border:'1px solid var(--border, #eee)', borderRadius:10, padding:10, marginBottom:8, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                            <div>
                              <div style={{ fontWeight:600 }}>{new Date(r.ts).toLocaleString()}</div>
                              <div style={{ fontSize:12, color:'var(--muted, #666)' }}>
                                Canale: {CHANNEL_OPTIONS_UI.find(o=>o.db===r.channel)?.label||r.channel} · 
                                Esito: {OUTCOME_OPTIONS_UI.find(o=>o.db===r.outcome)?.label||r.outcome}
                              </div>
                              {r.notes && <div style={{ fontSize:12 }}>{r.notes}</div>}
                            </div>
                            <div style={{ display:'inline-flex', gap:6 }}>
                              <button title="Modifica" onClick={()=>{ setEditingContactId(r.id); setContactDraft({ ts: r.ts? r.ts.slice(0,16):'', channel_label: CHANNEL_OPTIONS_UI.find(o=>o.db===r.channel)?.label || 'Telefono', outcome_label: OUTCOME_OPTIONS_UI.find(o=>o.db===r.outcome)?.label || 'Parlato', notes: r.notes||'' }) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>✏️</button>
                              <button title="Elimina" onClick={async()=>{ if (!selectedId) return; const ok = confirm('Eliminare il contatto?'); if (!ok) return; const { error } = await supabase.from('contacts').delete().eq('id', r.id); if (error) alert(error.message); else await loadContacts(selectedId) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* APPUNTAMENTI */}
                  {activeTab==='appuntamenti' && (
                    <div style={{ display:'grid', gap:12 }}>
                      <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:12 }}>
                        <div>
                          <div style={label}>Data/Ora</div>
                          <input type="datetime-local" style={ipt} value={appDraft.ts} onChange={e=>setAppDraft((d:any)=>({ ...d, ts: e.target.value }))} />
                        </div>
                        <div>
                          <div style={label}>Modalità</div>
                          <select style={ipt} value={appDraft.mode_label} onChange={e=>setAppDraft((d:any)=>({ ...d, mode_label:e.target.value }))}>
                            {MODE_OPTIONS_UI.map(o=> <option key={o.label} value={o.label}>{o.label}</option>)}
                          </select>
                        </div>
                        <div style={{ gridColumn:'1 / span 2' }}>
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
                              if (error) alert(error.message); else { setEditingAppId(null); setAppDraft({ ts:'', mode_label:'In presenza', notes:'' }); await loadAppointments(selectedId) }
                            }}>Salva</button>
                            <button className="brand-btn" onClick={()=>{ setEditingAppId(null); setAppDraft({ ts:'', mode_label:'In presenza', notes:'' }) }}>Annulla</button>
                          </div>
                        ) : (
                          <button className="brand-btn" onClick={async()=>{
                            if (!selectedId){ alert('Seleziona prima un Lead'); return }
                            const payload = { lead_id: selectedId, ts: appDraft.ts || new Date().toISOString(), mode: modeDbFromLabel(appDraft.mode_label), notes: appDraft.notes||null }
                            const { error } = await supabase.from('appointments').insert(payload)
                            if (error) alert(error.message); else { setAppDraft({ ts:'', mode_label:'In presenza', notes:'' }); await loadAppointments(selectedId) }
                          }}>Aggiungi appuntamento</button>
                        )}
                      </div>

                      <div>
                        {appointments.map(r=> (
                          <div key={r.id} style={{ border:'1px solid var(--border, #eee)', borderRadius:10, padding:10, marginBottom:8, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                            <div>
                              <div style={{ fontWeight:600 }}>{new Date(r.ts).toLocaleString()}</div>
                              <div style={{ fontSize:12, color:'var(--muted, #666)' }}>Modalità: {MODE_OPTIONS_UI.find(o=>o.db===r.mode)?.label||r.mode}</div>
                              {r.notes && <div style={{ fontSize:12 }}>{r.notes}</div>}
                            </div>
                            <div style={{ display:'inline-flex', gap:6 }}>
                              <button title="Modifica" onClick={()=>{ setEditingAppId(r.id); setAppDraft({ ts: r.ts? r.ts.slice(0,16):'', mode_label: MODE_OPTIONS_UI.find(o=>o.db===r.mode)?.label || 'In presenza', notes: r.notes||'' }) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>✏️</button>
                              <button title="Elimina" onClick={async()=>{ if (!selectedId) return; const ok = confirm('Eliminare l\'appuntamento?'); if (!ok) return; const { error } = await supabase.from('appointments').delete().eq('id', r.id); if (error) alert(error.message); else await loadAppointments(selectedId) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* PROPOSTE */}
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
                              const payload = { ts: propDraft.ts || new Date().toISOString(), line: propDraft.line, premium: propDraft.amount||0, notes: propDraft.notes||null }
                              const { error } = await supabase.from('proposals').update(payload).eq('id', editingPropId)
                              if (error) alert(error.message); else { setEditingPropId(null); setPropDraft({ ts:'', line:'', amount:0, notes:'' }); await loadProposals(selectedId) }
                            }}>Salva</button>
                            <button className="brand-btn" onClick={()=>{ setEditingPropId(null); setPropDraft({ ts:'', line:'', amount:0, notes:'' }) }}>Annulla</button>
                          </div>
                        ) : (
                          <button className="brand-btn" onClick={async()=>{
                            if (!selectedId){ alert('Seleziona prima un Lead'); return }
                            const payload = { lead_id: selectedId, ts: propDraft.ts || new Date().toISOString(), line: propDraft.line, premium: propDraft.amount||0, notes: propDraft.notes||null }
                            const { error } = await supabase.from('proposals').insert(payload)
                            if (error) alert(error.message); else { setPropDraft({ ts:'', line:'', amount:0, notes:'' }); await loadProposals(selectedId) }
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
                              <button title="Elimina" onClick={async()=>{ if (!selectedId) return; const ok = confirm('Eliminare la proposta?'); if (!ok) return; const { error } = await supabase.from('proposals').delete().eq('id', r.id); if (error) alert(error.message); else await loadProposals(selectedId) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* CONTRATTI */}
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
                              if (error) alert(error.message); else { setEditingCtrId(null); setCtrDraft({ ts:'', contract_type: CONTRACT_TYPE_OPTIONS[0].value, amount:0, notes:'' }); await loadContracts(selectedId) }
                            }}>Salva</button>
                            <button className="brand-btn" onClick={()=>{ setEditingCtrId(null); setCtrDraft({ ts:'', contract_type: CONTRACT_TYPE_OPTIONS[0].value, amount:0, notes:'' }) }}>Annulla</button>
                          </div>
                        ) : (
                          <button className="brand-btn" onClick={async()=>{
                            if (!selectedId){ alert('Seleziona prima un Lead'); return }
                            const payload = { lead_id: selectedId, ts: ctrDraft.ts || new Date().toISOString(), contract_type: ctrDraft.contract_type, amount: Number(ctrDraft.amount||0), line: ctrDraft.contract_type, notes: ctrDraft.notes||null }
                            const { error } = await supabase.from('contracts').insert(payload)
                            if (error) alert(error.message); else { setCtrDraft({ ts:'', contract_type: CONTRACT_TYPE_OPTIONS[0].value, amount:0, notes:'' }); await loadContracts(selectedId) }
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
                              <button title="Elimina" onClick={async()=>{ if (!selectedId) return; const ok = confirm('Eliminare il contratto?'); if (!ok) return; const { error } = await supabase.from('contracts').delete().eq('id', r.id); if (error) alert(error.message); else await loadContracts(selectedId) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Confirm Delete Modal */}
      {confirmDeleteId && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'grid', placeItems:'center' }}>
          <div style={{ background:'#fff', padding:16, borderRadius:12, width:320 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>Eliminare il Lead?</div>
            <div style={{ fontSize:13, color:'#555', marginBottom:12 }}>L'operazione non è reversibile.</div>
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
