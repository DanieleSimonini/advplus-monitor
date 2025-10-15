import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * Leads.tsx — CRUD completo con:
 * - Lista con paginazione, filtri, ricerca, ordinamento, export CSV
 * - Form Lead + tab Contatti/Appuntamenti/Proposte/Contratti
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

// mapping UI → DB
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

// aggregati (per filtri/ordina/export)
type Agg = {
  contactsCount: number
  lastContactTs?: string
  lastContactNotes?: string | null

  apptsCount: number
  lastApptTs?: string
  lastApptNotes?: string | null

  propsCount: number
  lastPropTs?: string
  lastPropNotes?: string | null

  ctrsCount: number
  lastCtrTs?: string
  lastCtrNotes?: string | null
  ctrsAmountSum: number
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

export default function LeadsPage(){
  // auth/ruolo corrente
  const [meRole, setMeRole] = useState<Role>('Junior')
  const [meUid, setMeUid] = useState<string>('')

  // advisors (per filtro assegnatario e select owner)
  const [advisors, setAdvisors] = useState<AdvisorRow[]>([])

  // elenco leads + aggregati
  const [leads, setLeads] = useState<Lead[]>([])
  const [aggs, setAggs] = useState<Record<string, Agg>>({})
  const [loading, setLoading] = useState(true)

  // selezione + edit
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null)

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

  // tabelle collegate (tab)
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

  // FILTRI / SEARCH / ORDINAMENTO / PAGINAZIONE
  const [filterOwner, setFilterOwner] = useState<string>('') // user_id
  const [fltWorking, setFltWorking] = useState<boolean>(true)  // default selezionato
  const [fltContacted, setFltContacted] = useState<boolean>(false)
  const [fltAppt, setFltAppt] = useState<boolean>(false)
  const [fltProp, setFltProp] = useState<boolean>(false)
  const [fltCtr, setFltCtr] = useState<boolean>(false)
  const [query, setQuery] = useState<string>('')

  type SortKey = 'ln'|'fn'|'created'|'last_contact'|'last_appt'|'last_prop'|'last_ctr'
  const [sortBy, setSortBy] = useState<SortKey>('ln')

  const [page, setPage] = useState(1)
  const PER_PAGE = 10

  // bootstrap
  useEffect(()=>{ (async()=>{
    setLoading(true)
    const { data: s } = await supabase.auth.getUser()
    const uid = s.user?.id || ''
    setMeUid(uid)
    if (uid){
      const { data: me } = await supabase.from('advisors').select('role').eq('user_id', uid).maybeSingle()
      if (me?.role) setMeRole(me.role as Role)
    }
    await Promise.all([loadLeads(), loadAdvisors()])
    setLoading(false)
  })() },[])

  async function loadAdvisors(){
    const { data } = await supabase.from('advisors').select('user_id,email,full_name,role').order('full_name', { ascending:true })
    setAdvisors((data||[]) as AdvisorRow[])
  }

  async function loadLeads(){
    const { data: leadsData } = await supabase
      .from('leads')
      .select('id,owner_id,is_agency_client,first_name,last_name,company_name,email,phone,city,address,source,created_at,is_working')
      .order('created_at', { ascending:false })
    const list = (leadsData||[]) as Lead[]
    setLeads(list)

    // Carico aggregati per i lead visibili (client-side per semplicità)
    const ids = list.map(l=>l.id!).filter(Boolean)
    if (ids.length===0){ setAggs({}); return }

    // contacts
    const { data: acts } = await supabase.from('activities').select('id,lead_id,ts,notes').in('lead_id', ids).order('ts', { ascending: true })
    const { data: apps } = await supabase.from('appointments').select('id,lead_id,ts,notes').in('lead_id', ids).order('ts', { ascending: true })
    const { data: props } = await supabase.from('proposals').select('id,lead_id,ts,notes').in('lead_id', ids).order('ts', { ascending: true })
    const { data: ctrs } = await supabase.from('contracts').select('id,lead_id,ts,notes,amount').in('lead_id', ids).order('ts', { ascending: true })

    const agg: Record<string, Agg> = {}
    for (const id of ids) agg[id] = { contactsCount:0, apptsCount:0, propsCount:0, ctrsCount:0, ctrsAmountSum:0 }

    ;(acts||[]).forEach(r=>{
      const a = agg[r.lead_id]!
      a.contactsCount++
      a.lastContactTs = r.ts
      a.lastContactNotes = r.notes||null
    })
    ;(apps||[]).forEach(r=>{
      const a = agg[r.lead_id]!
      a.apptsCount++
      a.lastApptTs = r.ts
      a.lastApptNotes = r.notes||null
    })
    ;(props||[]).forEach(r=>{
      const a = agg[r.lead_id]!
      a.propsCount++
      a.lastPropTs = r.ts
      a.lastPropNotes = r.notes||null
    })
    ;(ctrs||[]).forEach(r=>{
      const a = agg[r.lead_id]!
      a.ctrsCount++
      a.lastCtrTs = r.ts
      a.lastCtrNotes = r.notes||null
      a.ctrsAmountSum += Number(r.amount||0)
    })
    setAggs(agg)
  }

  // loaders delle righe del tab (per lead selezionato)
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
    await Promise.all([loadActivities(leadId), loadAppointments(leadId), loadProposals(leadId), loadContracts(leadId)])
  }

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
      is_working: (l.is_working ?? true)
    })
    if (l.id) { void reloadAllChildren(l.id) }
  }
  function validateForm(f: FormState): string | null {
    if (f.is_agency_client === null) return 'Indicare se è già cliente di agenzia.'
    if (!f.owner_id) return 'Seleziona "Assegna a Junior".'
    if (!f.first_name.trim()) return 'Il nome è obbligatorio.'
    if (!f.last_name.trim()) return 'Il cognome è obbligatorio.'
    if (!f.email.trim()) return 'L\'email è obbligatoria.'
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())
    if (!emailOk) return 'Formato email non valido.'
    if (!f.phone.trim()) return 'Il telefono è obbligatorio.'
    return null
  }

  async function saveLead(){
    const msg = validateForm(form)
    if (msg){ alert(msg); return }
    const payload = {
      owner_id: form.owner_id,
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

  // owners per filtro (solo Admin/TL)
  const canFilterByOwner = meRole==='Admin' || meRole==='Team Lead'
  const ownerOptions = useMemo(()=> advisors.filter(a=>!!a.user_id), [advisors])

  // APPLY: filtri + ricerca + sort + paginazione (client-side)
  const filteredSorted = useMemo(()=>{
    let rows = [...leads]

    // filtro owner
    if (canFilterByOwner && filterOwner) rows = rows.filter(l => (l.owner_id||'') === filterOwner)

    // filtro In Lavorazione
    if (fltWorking) rows = rows.filter(l => (l.is_working ?? true) === true)

    // contattato / appuntamento / proposta / contratto
    rows = rows.filter(l => {
      const a = aggs[l.id!]
      if (!a) return !(fltContacted||fltAppt||fltProp||fltCtr) // se non ho aggs e non ci sono filtri specifici → ok
      if (fltContacted && a.contactsCount<=0) return false
      if (fltAppt && a.apptsCount<=0) return false
      if (fltProp && a.propsCount<=0) return false
      if (fltCtr && a.ctrsCount<=0) return false
      return true
    })

    // ricerca su Cognome + Nome
    const q = query.trim().toLowerCase()
    if (q){
      rows = rows.filter(l => {
        const nom = `${l.last_name||''} ${l.first_name||''}`.toLowerCase()
        return nom.includes(q)
      })
    }

    // ordinamento
    rows.sort((a,b)=>{
      const A = aggs[a.id!]; const B = aggs[b.id!]
      const byText = (x?:string|null, y?:string|null)=> (x||'').localeCompare(y||'', 'it', { sensitivity:'base' })
      const byDateDesc = (x?:string, y?:string)=>{
        const dx = x? new Date(x).getTime() : 0
        const dy = y? new Date(y).getTime() : 0
        return dy - dx
      }
      switch (sortBy){
        case 'ln': return byText(a.last_name||'', b.last_name||'') || byText(a.first_name||'', b.first_name||'')
        case 'fn': return byText(a.first_name||'', b.first_name||'') || byText(a.last_name||'', b.last_name||'')
        case 'created': return byDateDesc(a.created_at||'', b.created_at||'')
        case 'last_contact': return byDateDesc(A?.lastContactTs, B?.lastContactTs)
        case 'last_appt': return byDateDesc(A?.lastApptTs, B?.lastApptTs)
        case 'last_prop': return byDateDesc(A?.lastPropTs, B?.lastPropTs)
        case 'last_ctr': return byDateDesc(A?.lastCtrTs, B?.lastCtrTs)
      }
    })

    return rows
  }, [leads, aggs, canFilterByOwner, filterOwner, fltWorking, fltContacted, fltAppt, fltProp, fltCtr, query, sortBy])

  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = filteredSorted.slice((currentPage-1)*PER_PAGE, currentPage*PER_PAGE)

  // EXPORT CSV (leads filtrati/ordinati)
  function exportCsv(){
    const cols = [
      'ID','Assegnatario','GiaCliente','Nome','Cognome','RagioneSociale','Email','Telefono','Citta','Indirizzo','Fonte','CreatoIl',
      'NumContatti','UltimoContatto','NoteUltimoContatto',
      'NumAppuntamenti','UltimoAppuntamento','NoteUltimoAppuntamento',
      'NumProposte','UltimaProposta','NoteUltimaProposta',
      'NumContratti','UltimoContratto','NoteUltimoContratto','SommaPremiContratti'
    ]
    const rows = filteredSorted.map(l=>{
      const a = aggs[l.id!] || {} as Agg
      const owner = advisors.find(x=>x.user_id===l.owner_id)?.full_name || advisors.find(x=>x.user_id===l.owner_id)?.email || ''
      return [
        l.id||'',
        owner,
        (l.is_agency_client===true ? 'Si' : l.is_agency_client===false ? 'No' : ''),
        l.first_name||'',
        l.last_name||'',
        l.company_name||'',
        l.email||'',
        l.phone||'',
        l.city||'',
        l.address||'',
        l.source||'',
        l.created_at? new Date(l.created_at).toLocaleString() : '',
        a.contactsCount||0,
        a.lastContactTs? new Date(a.lastContactTs).toLocaleString() : '',
        a.lastContactNotes||'',
        a.apptsCount||0,
        a.lastApptTs? new Date(a.lastApptTs).toLocaleString() : '',
        a.lastApptNotes||'',
        a.propsCount||0,
        a.lastPropTs? new Date(a.lastPropTs).toLocaleString() : '',
        a.lastPropNotes||'',
        a.ctrsCount||0,
        a.lastCtrTs? new Date(a.lastCtrTs).toLocaleString() : '',
        a.lastCtrNotes||'',
        (a.ctrsAmountSum||0).toString().replace('.', ',')
      ]
    })

    // CSV safe
    const escape = (v:any)=>{
      const s = String(v??'')
      if (/[",;\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`
      return s
    }
    const csv = [cols.join(';'), ...rows.map(r=>r.map(escape).join(';'))].join('\n')
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads_export_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // === RENDER ===
  return (
    <div style={{ display:'grid', gridTemplateColumns:'360px minmax(0,1fr)', gap:16 }}>
      {/* LISTA + FILTRI */}
      <div className="brand-card" style={{ ...box }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <div style={{ fontSize:16, fontWeight:700 }}>Leads</div>
          <div style={{ display:'flex', gap:6 }}>
            <button className="brand-btn" onClick={()=>{ setSelectedId(null); clearForm() }}>+ Nuovo</button>
          </div>
        </div>

        {/* FILTRI */}
        <div style={{ display:'grid', gap:8, marginBottom:10 }}>
          <div style={{ display:'grid', gap:8 }}>
            {(canFilterByOwner) && (
              <div>
                <div style={label}>Assegnatario</div>
                <select value={filterOwner} onChange={e=>{ setFilterOwner(e.target.value); setPage(1) }} style={ipt}>
                  <option value="">Tutti</option>
                  {ownerOptions.map(o=>(
                    <option key={o.user_id||o.email} value={o.user_id||''}>{o.full_name || o.email}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Toggle buttons */}
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <FilterBtn active={fltWorking} onClick={()=>{ setFltWorking(v=>!v); setPage(1) }}>In Lavorazione</FilterBtn>
              <FilterBtn active={fltContacted} onClick={()=>{ setFltContacted(v=>!v); setPage(1) }}>Contattato</FilterBtn>
              <FilterBtn active={fltAppt} onClick={()=>{ setFltAppt(v=>!v); setPage(1) }}>Fissato/Fatto Appuntamento</FilterBtn>
              <FilterBtn active={fltProp} onClick={()=>{ setFltProp(v=>!v); setPage(1) }}>Presentata Proposta</FilterBtn>
              <FilterBtn active={fltCtr} onClick={()=>{ setFltCtr(v=>!v); setPage(1) }}>Firmato Contratto</FilterBtn>
            </div>

            {/* ricerca + ordina + export */}
            <div>
              <div style={label}>Cerca (Cognome + Nome)</div>
              <input style={ipt} placeholder="es. Rossi Ma" value={query} onChange={e=>{ setQuery(e.target.value); setPage(1) }} />
            </div>
            <div>
              <div style={label}>Ordina per</div>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value as any)} style={ipt}>
                <option value="ln">Cognome A→Z</option>
                <option value="fn">Nome A→Z</option>
                <option value="created">Data Caricamento (recenti)</option>
                <option value="last_contact">Data Contatto (recenti)</option>
                <option value="last_appt">Data Appuntamento (recenti)</option>
                <option value="last_prop">Data Proposta (recenti)</option>
                <option value="last_ctr">Data Contratto (recenti)</option>
              </select>
            </div>

            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontSize:12, color:'#666' }}>
                {filteredSorted.length} risultati · pagina {currentPage}/{totalPages}
              </div>
              <button className="brand-btn" onClick={exportCsv}>Esporta</button>
            </div>
          </div>
        </div>

        {/* ELENCO + PAGINAZIONE */}
        {loading ? 'Caricamento...' : (
          <>
            <div style={{ display:'grid', gap:8 }}>
              {pageItems.map(l => (
                <div
                  key={l.id}
                  style={{
                    border:'1px solid',
                    borderColor: selectedId===l.id ? 'var(--brand-primary-600, #0029ae)' : 'var(--border, #eee)',
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
                    </div>
                    <div style={{ display:'inline-flex', gap:6 }}>
                      <button title="Modifica" onClick={()=>{ setEditingLeadId(l.id!); setSelectedId(l.id!); loadLeadIntoForm(l) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>✏️</button>
                      <button title="Elimina" onClick={()=>{ void deleteLead(l.id!) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
                    </div>
                  </div>
                </div>
              ))}
              {pageItems.length===0 && (
                <div style={{ color:'#666', fontSize:13, padding:8 }}>Nessun lead trovato con i filtri correnti.</div>
              )}
            </div>

            {/* PAGINATOR */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:10 }}>
              <button className="brand-btn" disabled={currentPage<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>‹ Prev</button>
              <div style={{ fontSize:12, color:'#555' }}>Pagina {currentPage} di {totalPages}</div>
              <button className="brand-btn" disabled={currentPage>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Next ›</button>
            </div>
          </>
        )}
      </div>

      {/* FORM + TAB (resto invariato, con pulsante In Lavorazione) */}
      <div className="brand-card" style={{ ...box }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, gap:8 }}>
          <div style={{ fontSize:16, fontWeight:700 }}>
            {editingLeadId ? `Modifica — ${leadLabel(form as any)}` : 'Nuovo Lead'}
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button className="brand-btn" onClick={saveLead}>{editingLeadId? 'Salva' : 'Crea'}</button>
            <button className="brand-btn" onClick={()=>clearForm()}>Reset</button>
            <button
              className="brand-btn"
              onClick={()=> setForm(f=>({ ...f, is_working: !f.is_working }))}
              style={
                form?.is_working
                  ? { background:'var(--brand-primary-600, #0029ae)', color:'#fff', borderColor:'var(--brand-primary-600, #0029ae)' }
                  : { background:'#c1121f', color:'#fff', borderColor:'#c1121f' }
              }>
              {form?.is_working ? 'In Lavorazione' : 'Stop Lavorazione'}
            </button>
          </div>
        </div>

        {/* --- campi anagrafici (come prima) --- */}
        <div style={{ display:'grid', gap:12 }}>
          {(meRole==='Admin' || meRole==='Team Lead') && (
            <div>
              <div style={label}>Assegna a Junior*</div>
              <select value={form.owner_id||''} onChange={e=>setForm(f=>({ ...f, owner_id: e.target.value || null }))} style={ipt}>
                <option value="">— Scegli —</option>
                {ownerOptions.map(a => (
                  <option key={a.user_id||a.email} value={a.user_id||''}>{a.full_name || a.email}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <div style={label}>Gia cliente di agenzia?*</div>
            <div style={{ display:'flex', gap:12 }}>
              <label><input type="radio" checked={form.is_agency_client===true} onChange={()=>setForm(f=>({ ...f, is_agency_client:true }))}/> Si</label>
              <label><input type="radio" checked={form.is_agency_client===false} onChange={()=>setForm(f=>({ ...f, is_agency_client:false }))}/> No</label>
            </div>
          </div>

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
            <div style={label}>Ragione Sociale</div>
            <input style={ipt} value={form.company_name} onChange={e=>setForm(f=>({ ...f, company_name:e.target.value }))} />
          </div>

          <div style={row}>
            <div>
              <div style={label}>Email*</div>
              <input style={ipt} value={form.email} onChange={e=>setForm(f=>({ ...f, email:e.target.value }))} />
            </div>
            <div>
              <div style={label}>Telefono*</div>
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

        {/* --- TAB: Contatti/Appuntamenti/Proposte/Contratti --- */}
        {/* (il resto del codice dei tab è invariato rispetto alla tua versione) */}
        {/* ... [mantieni qui i blocchi dei tab che avevi già: contatti, appuntamenti, proposte, contratti] ... */}
      </div>
    </div>
  )
}

/* Pulsante filtro (blu se attivo, bianco se non attivo) */
function FilterBtn({ active, onClick, children }: { active:boolean, onClick: ()=>void, children: React.ReactNode }){
  return (
    <button
      onClick={onClick}
      className="brand-btn"
      style={active
        ? { background:'var(--brand-primary-600, #0029ae)', color:'#fff', borderColor:'var(--brand-primary-600, #0029ae)' }
        : { background:'#fff', color:'#111', borderColor:'var(--border,#ddd)' }
      }>
      {children}
    </button>
  )
}
