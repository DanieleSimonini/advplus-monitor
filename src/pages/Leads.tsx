import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * Leads.tsx — CRUD completo (Lead + Contatti/Appunt./Proposte/Contratti)
 * - Lista lead a sinistra con ✏️/🗑️
 * - Form a destra con validazioni e assegnazione Owner (solo Admin/Team Lead)
 * - Tab con CRUD per activities, appointments, proposals, contracts
 * - Mapping UI → DB conforme ai CHECK:
 *   activities.channel ∈ {'phone','email','inperson','video'}
 *   activities.outcome ∈ {'spoke','noanswer','refused'}
 *   appointments.mode ∈ {'inperson','phone','video'}
 *   contracts.contract_type ∈ {'Danni Non Auto','Vita Protection','Vita Premi Ricorrenti','Vita Premi Unici'}
 */

type Role = 'Admin' | 'Team Lead' | 'Senior' | 'Junior'

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
  is_working?: boolean | null
}

type Activity = { id?: string, ts: string, channel: 'phone'|'email'|'inperson'|'video', outcome: 'spoke'|'noanswer'|'refused', notes?: string|null }
type Appointment = { id?: string, ts: string, mode: 'inperson'|'phone'|'video', notes?: string|null }
type Proposal = { id?: string, ts: string, line: string, amount: number, notes?: string|null }
type Contract = { id?: string, ts: string, contract_type: string, amount: number, notes?: string|null }

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
const box: React.CSSProperties = { padding:'6px 10px', border:'1px solid var(--border, #ddd)', borderRadius:8, background:'#fff' }
const label: React.CSSProperties = { fontSize:12, color:'var(--muted, #666)' }
const row: React.CSSProperties = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }

export default function LeadsPage(){
  // auth/ruolo corrente
  const [meRole, setMeRole] = useState<Role>('Junior')
  const [meUid, setMeUid] = useState<string | null>(null)

  // dati lookup
  const [users, setUsers] = useState<{ id:string, email:string }[]>([])

  // lista leads
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState<boolean>(true)

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

  // tabs e sotto CRUD
  const [activeTab, setActiveTab] = useState<'contatti'|'appuntamenti'|'proposte'|'contratti'>('contatti')

  // Contatti
  const [activities, setActivities] = useState<Activity[]>([])
  const [editingActId, setEditingActId] = useState<string | null>(null)
  const [actDraft, setActDraft] = useState<any>({ ts:'', channel_label:'Telefono', outcome_label:'Parlato', notes:'' })

  // Appuntamenti
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [editingAppId, setEditingAppId] = useState<string | null>(null)
  const [appDraft, setAppDraft] = useState<any>({ ts:'', mode_label:'In presenza', notes:'' })

  // Proposte
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [editingPropId, setEditingPropId] = useState<string | null>(null)
  const [propDraft, setPropDraft] = useState<any>({ ts:'', line:'', amount:0, notes:'' })

  // Contratti
  const [contracts, setContracts] = useState<Contract[]>([])
  const [editingCtrId, setEditingCtrId] = useState<string | null>(null)
  const [ctrDraft, setCtrDraft] = useState<any>({ ts:'', contract_type:'Danni Non Auto', amount:0, notes:'' })

  // === Opzioni UI
  const CHANNEL_OPTIONS_UI = [
    { label:'Telefono', db:'phone' },
    { label:'Email', db:'email' },
    { label:'Di persona', db:'inperson' },
    { label:'Video', db:'video' },
  ] as const

  const OUTCOME_OPTIONS_UI = [
    { label:'Parlato', db:'spoke' },
    { label:'Nessuna risposta', db:'noanswer' },
    { label:'Rifiutato', db:'refused' },
  ] as const

  const MODE_OPTIONS_UI = [
    { label:'In presenza', db:'inperson' },
    { label:'Telefono', db:'phone' },
    { label:'Video', db:'video' },
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

  // boot
  useEffect(()=>{
    ;(async()=>{
      const me = await supabase.auth.getSession()
      setMeUid(me.data.session?.user?.id || null)
      // (se hai una tabella ruoli collegata, qui setti meRole)
      await loadUsers()
      await loadLeads()
    })()
  },[])

  async function loadUsers(){
    const { data, error } = await supabase.from('profiles').select('id,email').order('email')
    if (!error && data) setUsers(data as any)
  }
  async function loadLeads(){
    setLoading(true)
    const { data, error } = await supabase.from('leads')
      .select('id,owner_id,is_agency_client,first_name,last_name,company_name,email,phone,city,address,source,is_working')
      .order('created_at', { ascending:false })
    if (!error && data) setLeads(data as any)
    setLoading(false)
  }

  async function loadActivities(leadId:string){
    const { data, error } = await supabase
      .from('activities')
      .select('id,ts,channel,outcome,notes')
      .eq('lead_id', leadId)
      .order('ts', { ascending:false })
    if (!error) setActivities(data||[])
  }
  async function loadAppointments(leadId:string){
    const { data, error } = await supabase
      .from('appointments')
      .select('id,ts,mode,notes')
      .eq('lead_id', leadId)
      .order('ts', { ascending:false })
    if (!error) setAppointments(data||[])
  }
  async function loadProposals(leadId:string){
    const { data, error } = await supabase
      .from('proposals')
      .select('id,ts,line,amount,notes')
      .eq('lead_id', leadId)
      .order('ts', { ascending:false })
    if (!error) setProposals(data||[])
  }
  async function loadContracts(leadId:string){
    const { data, error } = await supabase
      .from('contracts')
      .select('id,ts,contract_type,amount,notes')
      .eq('lead_id', leadId)
      .order('ts', { ascending:false })
    if (!error) setContracts(data||[])
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
  function leadLabel(l: Lead){
    const n = [l.first_name||'', l.last_name||''].join(' ').trim()
    return n || (l.company_name||l.email||l.phone||'Lead')
  }
  function clearForm(){ setForm(emptyForm); setEditingLeadId(null) }
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
      is_working: (form as any).is_working ?? true,
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

  // === render
  return (
    <div style={{ display:'grid', gridTemplateColumns:'360px 1fr', gap:12 }}>
      {/* Lista */}
      <div className="brand-card" style={{ ...box }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <div style={{ fontSize:16, fontWeight:700 }}>Leads</div>
          <div style={{ display:'flex', gap:6 }}>
            <button className="brand-btn" onClick={()=>{ setSelectedId(null); clearForm() }}>+ Nuovo</button>
          </div>
        </div>
        {loading ? 'Caricamento...' : (
          <div style={{ display:'grid', gap:8 }}>
            {leads.map(l => (
              <div key={l.id}
                   style={{
                     border:'1px solid',
                     borderColor: selectedId===l.id ? 'var(--brand-primary-600, #0029ae)' : 'var(--border, #eee)',
                     background: selectedId===l.id ? '#F0F6FF' : '#fff',
                     borderRadius:12,
                     padding:10
                   }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                  <div onClick={()=>{ setSelectedId(l.id!); setEditingLeadId(l.id!); loadLeadIntoForm(l) }} style={{ cursor:'pointer' }}>
                    <div style={{ fontWeight:600 }}>{leadLabel(l)}</div>
                    <div style={{ fontSize:12, color:'var(--muted,#666)' }}>{l.email || l.phone || '—'} {l.is_agency_client? ' · Gia cliente' : ''}</div>
                  </div>
                  <div style={{ display:'inline-flex', gap:6 }}>
                    <button title="Modifica" onClick={()=>{ setSelectedId(l.id!); setEditingLeadId(l.id!); loadLeadIntoForm(l) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>✏️</button>
                    <button title="Elimina" onClick={()=>setConfirmDeleteId(l.id!)} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form Lead + TAB */}
      <div className="brand-card" style={{ ...box }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <div style={{ fontSize:16, fontWeight:700 }}>
            {editingLeadId ? `Modifica — ${leadLabel(form as any)}` : 'Nuovo Lead'}
          </div>
          <div style={{ display:'flex', gap:8 }}>
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

        <div style={{ display:'grid', gap:12 }}>
          {/* Owner (solo Admin/TL) */}
          {(meRole==='Admin' || meRole==='Team Lead') && (
            <div>
              <div style={label}>Assegna a Junior</div>
              <select style={{ ...ipt }} value={form.owner_id||''} onChange={e=>setForm(f=>({ ...f, owner_id:e.target.value||null }))}>
                <option value="">— Scegli —</option>
                {users.map(u=> <option key={u.id} value={u.id}>{u.email}</option>)}
              </select>
            </div>
          )}

          {/* cliente di agenzia */}
          <div>
            <div style={label}>Gia cliente di agenzia?</div>
            <div style={{ display:'inline-flex', gap:12, fontSize:14 }}>
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
            <select style={ipt} value={form.source} onChange={e=>setForm(f=>({ ...f, source: (e.target.value as any) }))}>
              <option value="">—</option>
              <option value="Provided">Fornito</option>
              <option value="Self">Autonomo</option>
            </select>
          </div>

          {/* Tabs */}
          <div style={{ display:'flex', gap:8 }}>
            <button className="brand-btn" style={{ ...(activeTab==='contatti'? { background:'var(--brand-primary-600, #0029ae)', color:'#fff' } : {}) }} onClick={()=>setActiveTab('contatti')}>Contatti</button>
            <button className="brand-btn" style={{ ...(activeTab==='appuntamenti'? { background:'var(--brand-primary-600, #0029ae)', color:'#fff' } : {}) }} onClick={()=>setActiveTab('appuntamenti')}>Appuntamenti</button>
            <button className="brand-btn" style={{ ...(activeTab==='proposte'? { background:'var(--brand-primary-600, #0029ae)', color:'#fff' } : {}) }} onClick={()=>setActiveTab('proposte')}>Proposte</button>
            <button className="brand-btn" style={{ ...(activeTab==='contratti'? { background:'var(--brand-primary-600, #0029ae)', color:'#fff' } : {}) }} onClick={()=>setActiveTab('contratti')}>Contratti</button>
          </div>

          {/* CONTATTI */}
          {activeTab==='contatti' && (
            <div style={{ display:'grid', gap:12 }}>
              {/* form nuovo/edita contatto */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12 }}>
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
                  <textarea
                    rows={2}
                    maxLength={240}
                    style={{ ...ipt, width:'100%' }}
                    value={actDraft.notes||''}
                    onChange={e=>setActDraft((d:any)=>({ ...d, notes:e.target.value }))}
                  />
                </div>
              </div>
              <div>
                {editingActId ? (
                  <div style={{ display:'flex', gap:8 }}>
                    <button className="brand-btn" onClick={async()=>{
                      if (!selectedId) return
                      const payload = { ts: actDraft.ts || new Date().toISOString(), channel: channelDbFromLabel(actDraft.channel_label), outcome: outcomeDbFromLabel(actDraft.outcome_label), notes: actDraft.notes||null }
                      const { error } = await supabase.from('activities').update(payload).eq('id', editingActId)
                      if (error) alert(error.message); else { setEditingActId(null); setActDraft({ ts:'', channel_label:'Telefono', outcome_label:'Parlato', notes:'' }); await loadActivities(selectedId) }
                    }}>Salva</button>
                    <button className="brand-btn" onClick={()=>{ setEditingActId(null); setActDraft({ ts:'', channel_label:'Telefono', outcome_label:'Parlato', notes:'' }) }}>Annulla</button>
                  </div>
                ) : (
                  <button className="brand-btn" onClick={async()=>{
                    if (!selectedId){ alert('Seleziona prima un Lead'); return }
                    const payload = { lead_id: selectedId, ts: actDraft.ts || new Date().toISOString(), channel: channelDbFromLabel(actDraft.channel_label), outcome: outcomeDbFromLabel(actDraft.outcome_label), notes: actDraft.notes||null }
                    const { error } = await supabase.from('activities').insert(payload)
                    if (error) alert(error.message); else { setActDraft({ ts:'', channel_label:'Telefono', outcome_label:'Parlato', notes:'' }); await loadActivities(selectedId) }
                  }}>Aggiungi contatto</button>
                )}
              </div>

              <div>
                {activities.map(r=> (
                  <div key={r.id} style={{ border:'1px solid var(--border,#eee)', borderRadius:12, padding:10, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                    <div>
                      <div style={{ fontWeight:600 }}>{new Date(r.ts).toLocaleString()}</div>
                      <div style={{ fontSize:12, color:'var(--muted,#666)' }}>{CHANNEL_OPTIONS_UI.find(o=>o.db===r.channel)?.label || r.channel} · {OUTCOME_OPTIONS_UI.find(o=>o.db===r.outcome)?.label || r.outcome}</div>
                      {r.notes && <div style={{ fontSize:12 }}>{r.notes}</div>}
                    </div>
                    <div style={{ display:'inline-flex', gap:6 }}>
                      <button title="Modifica" onClick={()=>{ setEditingActId(r.id!); setActDraft({ ts: r.ts?.slice(0,16), channel_label: CHANNEL_OPTIONS_UI.find(o=>o.db===r.channel)?.label || 'Telefono', outcome_label: OUTCOME_OPTIONS_UI.find(o=>o.db===r.outcome)?.label || 'Parlato', notes: r.notes||'' }) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>✏️</button>
                      <button title="Elimina" onClick={async()=>{ await supabase.from('activities').delete().eq('id', r.id!); if (selectedId) await loadActivities(selectedId) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* APPUNTAMENTI */}
          {activeTab==='appuntamenti' && (
            <div style={{ display:'grid', gap:12 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 2fr', gap:12 }}>
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
                  <div style={{ display:'flex', gap:8 }}>
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
                  <div key={r.id} style={{ border:'1px solid var(--border,#eee)', borderRadius:12, padding:10, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                    <div>
                      <div style={{ fontWeight:600 }}>{new Date(r.ts).toLocaleString()}</div>
                      <div style={{ fontSize:12, color:'var(--muted,#666)' }}>{MODE_OPTIONS_UI.find(o=>o.db===r.mode)?.label || r.mode}</div>
                      {r.notes && <div style={{ fontSize:12 }}>{r.notes}</div>}
                    </div>
                    <div style={{ display:'inline-flex', gap:6 }}>
                      <button title="Modifica" onClick={()=>{ setEditingAppId(r.id!); setAppDraft({ ts: r.ts?.slice(0,16), mode_label: MODE_OPTIONS_UI.find(o=>o.db===r.mode)?.label || 'In presenza', notes: r.notes||'' }) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>✏️</button>
                      <button title="Elimina" onClick={async()=>{ await supabase.from('appointments').delete().eq('id', r.id!); if (selectedId) await loadAppointments(selectedId) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PROPOSTE */}
          {activeTab==='proposte' && (
            <div style={{ display:'grid', gap:12 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr 1fr', gap:12 }}>
                <div>
                  <div style={label}>Data/Ora</div>
                  <input type="datetime-local" style={ipt} value={propDraft.ts} onChange={e=>setPropDraft((d:any)=>({ ...d, ts: e.target.value }))} />
                </div>
                <div>
                  <div style={label}>Linea</div>
                  <input style={ipt} value={propDraft.line} onChange={e=>setPropDraft((d:any)=>({ ...d, line: e.target.value }))} />
                </div>
                <div>
                  <div style={label}>Importo (EUR)</div>
                  <input type="number" style={ipt} value={propDraft.amount} onChange={e=>setPropDraft((d:any)=>({ ...d, amount: Number(e.target.value||0) }))} />
                </div>
                <div style={{ gridColumn:'1 / span 3' }}>
                  <div style={label}>Note</div>
                  <textarea rows={2} maxLength={240} style={{ ...ipt, width:'100%' }} value={propDraft.notes||''} onChange={e=>setPropDraft((d:any)=>({ ...d, notes:e.target.value }))} />
                </div>
              </div>

              <div>
                {editingPropId ? (
                  <div style={{ display:'flex', gap:8 }}>
                    <button className="brand-btn" onClick={async()=>{
                      if (!selectedId) return
                      const payload = { ts: propDraft.ts || new Date().toISOString(), line: propDraft.line, amount: propDraft.amount||0, notes: propDraft.notes||null }
                      const { error } = await supabase.from('proposals').update(payload).eq('id', editingPropId)
                      if (error) alert(error.message); else { setEditingPropId(null); setPropDraft({ ts:'', line:'', amount:0, notes:'' }); await loadProposals(selectedId) }
                    }}>Salva</button>
                    <button className="brand-btn" onClick={()=>{ setEditingPropId(null); setPropDraft({ ts:'', line:'', amount:0, notes:'' }) }}>Annulla</button>
                  </div>
                ) : (
                  <button className="brand-btn" onClick={async()=>{
                    if (!selectedId){ alert('Seleziona prima un Lead'); return }
                    const payload = { lead_id: selectedId, ts: propDraft.ts || new Date().toISOString(), line: propDraft.line, amount: propDraft.amount||0, notes: propDraft.notes||null }
                    const { error } = await supabase.from('proposals').insert(payload)
                    if (error) alert(error.message); else { setPropDraft({ ts:'', line:'', amount:0, notes:'' }); await loadProposals(selectedId) }
                  }}>Aggiungi proposta</button>
                )}
              </div>

              <div>
                {proposals.map(r=> (
                  <div key={r.id} style={{ border:'1px solid var(--border,#eee)', borderRadius:12, padding:10, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                    <div>
                      <div style={{ fontWeight:600 }}>{new Date(r.ts).toLocaleString()}</div>
                      <div style={{ fontSize:12, color:'var(--muted,#666)' }}>{r.line} · {Number(r.amount||0).toLocaleString('it-IT',{ style:'currency', currency:'EUR' })}</div>
                      {r.notes && <div style={{ fontSize:12 }}>{r.notes}</div>}
                    </div>
                    <div style={{ display:'inline-flex', gap:6 }}>
                      <button title="Modifica" onClick={()=>{ setEditingPropId(r.id!); setPropDraft({ ts: r.ts?.slice(0,16), line: r.line, amount: r.amount, notes: r.notes||'' }) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>✏️</button>
                      <button title="Elimina" onClick={async()=>{ await supabase.from('proposals').delete().eq('id', r.id!); if (selectedId) await loadProposals(selectedId) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CONTRATTI */}
          {activeTab==='contratti' && (
            <div style={{ display:'grid', gap:12 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
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
                  <input type="number" style={ipt} value={ctrDraft.amount} onChange={e=>setCtrDraft((d:any)=>({ ...d, amount: Number(e.target.value||0) }))} />
                </div>
              </div>
              <div>
                <div style={label}>Note</div>
                <textarea rows={2} maxLength={240} style={{ ...ipt, width:'100%' }} value={ctrDraft.notes||''} onChange={e=>setCtrDraft((d:any)=>({ ...d, notes:e.target.value }))} />
              </div>

              <div>
                {editingCtrId ? (
                  <div style={{ display:'flex', gap:8 }}>
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
                    const payload = { 
                      lead_id: selectedId,
                      ts: ctrDraft.ts || new Date().toISOString(),
                      contract_type: ctrDraft.contract_type,
                      amount: Number(ctrDraft.amount||0),
                      notes: ctrDraft.notes||null
                    }
                    const { error } = await supabase.from('contracts').insert(payload)
                    if (error) alert(error.message); else { setCtrDraft({ ts:'', contract_type: CONTRACT_TYPE_OPTIONS[0].value, amount:0, notes:'' }); await loadContracts(selectedId) }
                  }}>Aggiungi contratto</button>
                )}
              </div>

              <div>
                {contracts.map(r=> (
                  <div key={r.id} style={{ border:'1px solid var(--border,#eee)', borderRadius:12, padding:10, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                    <div>
                      <div style={{ fontWeight:600 }}>{new Date(r.ts).toLocaleString()}</div>
                      <div style={{ fontSize:12, color:'var(--muted,#666)' }}>{r.contract_type} · {Number(r.amount||0).toLocaleString('it-IT',{ style:'currency', currency:'EUR' })}</div>
                      {r.notes && <div style={{ fontSize:12 }}>{r.notes}</div>}
                    </div>
                    <div style={{ display:'inline-flex', gap:6 }}>
                      <button title="Modifica" onClick={()=>{ setEditingCtrId(r.id!); setCtrDraft({ ts: r.ts?.slice(0,16), contract_type: r.contract_type, amount: r.amount, notes: r.notes||'' }) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>✏️</button>
                      <button title="Elimina" onClick={async()=>{ await supabase.from('contracts').delete().eq('id', r.id!); if (selectedId) await loadContracts(selectedId) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Conferma cancellazione */}
      {confirmDeleteId && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'grid', placeItems:'center' }}>
          <div style={{ background:'#fff', padding:16, borderRadius:12, width:320 }}>
            <div style={{ fontWeight:700, marginBottom:8 }}>Eliminare il Lead?</div>
            <div style={{ fontSize:13, color:'#555', marginBottom:12 }}>L'operazione non e reversibile.</div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
              <button onClick={()=>setConfirmDeleteId(null)} className="brand-btn">Annulla</button>
              <button onClick={async()=>{
                const { error } = await supabase.from('leads').delete().eq('id', confirmDeleteId)
                if (error) alert(error.message)
                await loadLeads()
                setConfirmDeleteId(null)
                if (selectedId===confirmDeleteId){ setSelectedId(null); clearForm() }
              }} className="brand-btn" style={{ background:'#c00', borderColor:'#c00', color:'#fff' }}>Elimina</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// input stile base
const ipt: React.CSSProperties = {
  width:'100%', padding:'8px 10px', border:'1px solid var(--border,#ddd)', borderRadius:8, outline:'none'
}
