import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'

/**
 * Leads.tsx — versione completa (Opzione A)
 * - Elenco lead a sinistra, form a destra
 * - +Nuovo azzera il form
 * - Validazioni: is_agency_client obbl., email OR phone, (first+last) OR company_name
 * - Tab Contatti/Appuntamenti/Proposte/Contratti con inserimento inline
 * - Rispetta colonne legacy NOT NULL: outcome (activities), mode (appointments), line (proposals, contracts)
 * - UI: griglie responsive per evitare sovrapposizioni orizzontali, select con z-index
 */

type Lead = {
  id?: string
  owner_id?: string
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
}

const box: React.CSSProperties = {
  background:'#fff', border:'1px solid #eee', borderRadius:16, padding:16,
  overflow:'visible', position:'relative', zIndex:0
}
const ipt: React.CSSProperties = {
  padding:'10px 12px', borderRadius:10, border:'1px solid #ddd', width:'100%',
  minWidth:0, boxSizing:'border-box'
}
const cta: React.CSSProperties = { padding:'10px 12px', borderRadius:10, border:'1px solid #111', background:'#111', color:'#fff', cursor:'pointer' }
const btn: React.CSSProperties = { padding:'8px 10px', borderRadius:10, border:'1px solid #ddd', background:'#fff', cursor:'pointer' }
const lbl: React.CSSProperties = { fontSize:12, color:'#666', marginBottom:4 }

export default function LeadsPage() {
  // utente corrente
  const [me, setMe] = useState<{ id: string; email: string; full_name?: string } | null>(null)

  // elenco leads
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')

  // selezione + form
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Lead>(emptyLead())
  const [saving, setSaving] = useState(false)

  // tabs (solo dati del lead selezionato)
  const [tab, setTab] = useState<'contatti'|'appuntamenti'|'proposte'|'contratti'>('contatti')
  const [contacts, setContacts] = useState<any[]>([])
  const [appointments, setAppointments] = useState<any[]>([])
  const [proposals, setProposals] = useState<any[]>([])
  const [contracts, setContracts] = useState<any[]>([])

  // inline forms per inserimento rapido
  const [newContact, setNewContact] = useState<{ts:string; channel:string; notes:string}>({ ts:'', channel:'', notes:'' })
  const [newAppointment, setNewAppointment] = useState<{ts:string; method:string; notes:string}>({ ts:'', method:'', notes:'' })
  const [newProposal, setNewProposal] = useState<{ts:string; line:string; notes:string}>({ ts:'', line:'', notes:'' })
  const [newContract, setNewContract] = useState<{ts:string; kind:string; amount:string; notes:string}>({ ts:'', kind:'', amount:'', notes:'' })

  // bootstrap
  useEffect(()=>{(async()=>{
    setLoading(true); setError('')
    const u = await supabase.auth.getUser()
    const email = u.data.user?.email
    if (!email){ setError('Utente non autenticato'); setLoading(false); return }
    // advisor corrente
    const { data: myRow, error: meErr } = await supabase.from('advisors').select('id,email,full_name').eq('email', email).maybeSingle()
    if (meErr || !myRow){ setError(meErr?.message || 'Advisor non trovato'); setLoading(false); return }
    setMe({ id: myRow.id, email: myRow.email, full_name: myRow.full_name })

    await reloadLeads()
    setLoading(false)
  })()},[])

  const reloadLeads = async () => {
    const { data, error } = await supabase
      .from('leads')
      .select('id,owner_id,is_agency_client,first_name,last_name,company_name,email,phone,city,address,source,created_at')
      .order('created_at', { ascending:false })
    if (error) { setError(error.message); return }
    setLeads(data || [])
    if (selectedId) {
      const found = (data||[]).find(l => l.id === selectedId)
      if (found) setForm(normalizeLead(found))
    }
  }

  const onSelectLead = (l: Lead) => {
    setSelectedId(l.id || null)
    setForm(normalizeLead(l))
    loadTabs(l.id!)
  }

  const onNew = () => {
    setSelectedId(null)
    setForm(emptyLead())
    setContacts([]); setAppointments([]); setProposals([]); setContracts([])
    setNewContact({ ts:'', channel:'', notes:'' })
    setNewAppointment({ ts:'', method:'', notes:'' })
    setNewProposal({ ts:'', line:'', notes:'' })
    setNewContract({ ts:'', kind:'', amount:'', notes:'' })
  }

  const validateLead = (l: Lead): string | null => {
    if (l.is_agency_client === null) return 'Seleziona se è già cliente di agenzia.'
    if (!(l.email && l.email.trim()) && !(l.phone && l.phone.trim())) return 'Inserisci almeno Email o Telefono.'
    const hasPerson = !!(l.first_name && l.first_name.trim()) && !!(l.last_name && l.last_name.trim())
    const hasCompany = !!(l.company_name && l.company_name.trim())
    if (!hasPerson && !hasCompany) return 'Compila Nome+Cognome oppure Ragione Sociale.'
    return null
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!me) { setError('Advisor corrente non trovato'); return }
    const msg = validateLead(form)
    if (msg) { setError(msg); return }

    setSaving(true)
    try {
      if (selectedId) {
        const { error } = await supabase.from('leads').update(cleanLeadForDb(form)).eq('id', selectedId)
        if (error) throw error
      } else {
        const payload = { ...cleanLeadForDb(form), owner_id: me.id }
        const { data, error } = await supabase.from('leads').insert(payload).select('id').single()
        if (error) throw error
        setSelectedId(data?.id || null)
      }
      await reloadLeads()
      alert('Lead salvato.')
    } catch(e:any) {
      setError(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const loadTabs = async (leadId: string) => {
    const [c1, c2, c3, c4] = await Promise.all([
      supabase.from('activities').select('id,ts,channel,outcome,notes').eq('lead_id', leadId).order('ts', { ascending:false }),
      supabase.from('appointments').select('id,ts,method,mode,notes').eq('lead_id', leadId).order('ts', { ascending:false }),
      supabase.from('proposals').select('id,ts,line,notes').eq('lead_id', leadId).order('ts', { ascending:false }),
      supabase.from('contracts').select('id,ts,amount,kind,line,notes').eq('lead_id', leadId).order('ts', { ascending:false }),
    ])
    if (!c1.error) setContacts(c1.data || [])
    if (!c2.error) setAppointments(c2.data || [])
    if (!c3.error) setProposals(c3.data || [])
    if (!c4.error) setContracts(c4.data || [])
  }

  useEffect(()=>{ if (selectedId) loadTabs(selectedId) }, [tab, selectedId])

  const ownerName = useMemo(()=>{
    if (!me) return ''
    if (!form.owner_id) return me.full_name || me.email
    return form.owner_id === me.id ? (me.full_name || me.email) : '—'
  }, [me, form.owner_id])

  return (
    <div style={{ display:'grid', gridTemplateColumns:'320px 1fr', gap:16 }}>
      {/* SINISTRA: elenco lead */}
      <div style={{ display:'grid', gap:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontWeight:700 }}>Leads</div>
          <button onClick={onNew} style={btn}>+ Nuovo</button>
        </div>
        <div style={{ ...box, padding:0 }}>
          <ul style={{ listStyle:'none', margin:0, padding:0, maxHeight: '70vh', overflow:'auto' }}>
            {leads.map(l => (
              <li
                key={l.id}
                onClick={()=>onSelectLead(l)}
                style={{
                  padding:'10px 12px', borderBottom:'1px solid #f2f2f2', cursor:'pointer',
                  background: selectedId===l.id ? '#f7f7f7' : '#fff'
                }}
              >
                <div style={{ fontWeight:600 }}>
                  {l.company_name || `${l.first_name||''} ${l.last_name||''}`.trim() || '(senza nome)'}
                </div>
                <div style={{ fontSize:12, color:'#666' }}>
                  {l.email || '—'} · {l.phone || '—'} · {l.is_agency_client ? 'Già cliente' : 'Nuovo'}
                </div>
              </li>
            ))}
            {!leads.length && <li style={{ padding:12, color:'#666' }}>Nessun lead presente.</li>}
          </ul>
        </div>
      </div>

      {/* DESTRA: form + tabs */}
      <div style={{ display:'grid', gap:12 }}>
        <div style={box}>
          <div style={{ fontWeight:700, marginBottom:8 }}>{selectedId ? 'Modifica Lead' : 'Nuovo Lead'}</div>
          <form onSubmit={save} style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12 }}>
            <div>
              <div style={lbl}>Già cliente di agenzia?</div>
              <select
                value={form.is_agency_client===null ? '' : String(form.is_agency_client)}
                onChange={e=>setForm({ ...form, is_agency_client: e.target.value==='' ? null : e.target.value==='true' })}
                style={{ ...ipt, position:'relative', zIndex:2 }}
              >
                <option value="">—</option>
                <option value="true">Sì</option>
                <option value="false">No</option>
              </select>
            </div>
            <div>
              <div style={lbl}>Owner (Junior)</div>
              <input value={ownerName} readOnly style={{ ...ipt, background:'#f9f9f9' }} />
            </div>

            <div>
              <div style={lbl}>Nome</div>
              <input value={form.first_name||''} onChange={e=>setForm({ ...form, first_name:e.target.value })} style={ipt} />
            </div>
            <div>
              <div style={lbl}>Cognome</div>
              <input value={form.last_name||''} onChange={e=>setForm({ ...form, last_name:e.target.value })} style={ipt} />
            </div>

            <div>
              <div style={lbl}>Ragione Sociale</div>
              <input value={form.company_name||''} onChange={e=>setForm({ ...form, company_name:e.target.value })} style={ipt} />
            </div>
            <div>
              <div style={lbl}>Email</div>
              <input value={form.email||''} onChange={e=>setForm({ ...form, email:e.target.value })} style={ipt} />
            </div>

            <div>
              <div style={lbl}>Telefono</div>
              <input value={form.phone||''} onChange={e=>setForm({ ...form, phone:e.target.value })} style={ipt} />
            </div>
            <div>
              <div style={lbl}>Città</div>
              <input value={form.city||''} onChange={e=>setForm({ ...form, city:e.target.value })} style={ipt} />
            </div>

            <div>
              <div style={lbl}>Indirizzo</div>
              <input value={form.address||''} onChange={e=>setForm({ ...form, address:e.target.value })} style={ipt} />
            </div>
            <div>
              <div style={lbl}>Fonte</div>
              <select value={form.source||'Provided'} onChange={e=>setForm({ ...form, source:e.target.value as any })} style={{ ...ipt, position:'relative', zIndex:2 }}>
                <option value="Provided">Provided</option>
                <option value="Self">Self</option>
              </select>
            </div>

            <div style={{ gridColumn:'1 / -1', display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button type="button" onClick={onNew} style={{ ...btn }}>Reset</button>
              <button type="submit" disabled={saving} style={cta}>{saving ? 'Salvataggio…' : 'Salva'}</button>
            </div>
          </form>
          {error && <div style={{ color:'#c00', marginTop:8 }}>{error}</div>}
        </div>

        {/* Tabs */}
        <div style={box}>
          <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
            {tabBtn('contatti','Contatti')}
            {tabBtn('appuntamenti','Appuntamenti')}
            {tabBtn('proposte','Proposte')}
            {tabBtn('contratti','Contratti')}
          </div>

          {!selectedId && <div style={{ color:'#666' }}>Seleziona un lead per vedere e inserire le attività.</div>}

          {selectedId && tab==='contatti' && (
            <>
              <InlineNewRow title="Nuovo contatto" onSave={async()=>{
                if (!newContact.ts || !newContact.channel){ setError('Per il contatto indica data/ora e canale.'); return }
                const { error } = await supabase.from('activities').insert({
                  lead_id: selectedId,
                  ts: newContact.ts,
                  channel: newContact.channel,
                  outcome: newContact.channel || 'contatto',
                  notes: newContact.notes||null
                })
                if (error){ setError(error.message); return }
                setNewContact({ ts:'', channel:'', notes:'' })
                await loadTabs(selectedId)
              }}>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12, overflow:'visible' }}>
                  <div>
                    <div style={lbl}>Quando</div>
                    <input type="datetime-local" value={newContact.ts} onChange={e=>setNewContact({ ...newContact, ts:e.target.value })} style={ipt} />
                  </div>
                  <div>
                    <div style={lbl}>Canale</div>
                    <input value={newContact.channel} onChange={e=>setNewContact({ ...newContact, channel:e.target.value })} placeholder="Telefono / Email / WhatsApp / Altro" style={ipt} />
                  </div>
                  <div>
                    <div style={lbl}>Note</div>
                    <input value={newContact.notes} onChange={e=>setNewContact({ ...newContact, notes:e.target.value })} style={ipt} />
                  </div>
                </div>
              </InlineNewRow>
              <SimpleTable rows={contacts} cols={[{k:'ts',l:'Quando'},{k:'channel',l:'Canale'},{k:'outcome',l:'Esito'},{k:'notes',l:'Note'}]} />
            </>
          )}

          {selectedId && tab==='appuntamenti' && (
            <>
              <InlineNewRow title="Nuovo appuntamento" onSave={async()=>{
                if (!newAppointment.ts || !newAppointment.method){ setError('Per l\'appuntamento indica data/ora e modalità.'); return }
                const { error } = await supabase.from('appointments').insert({
                  lead_id: selectedId,
                  ts: newAppointment.ts,
                  method: newAppointment.method,
                  mode: newAppointment.method,
                  notes: newAppointment.notes||null
                })
                if (error){ setError(error.message); return }
                setNewAppointment({ ts:'', method:'', notes:'' })
                await loadTabs(selectedId)
              }}>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12, overflow:'visible' }}>
                  <div>
                    <div style={lbl}>Quando</div>
                    <input type="datetime-local" value={newAppointment.ts} onChange={e=>setNewAppointment({ ...newAppointment, ts:e.target.value })} style={ipt} />
                  </div>
                  <div>
                    <div style={lbl}>Modalità</div>
                    <input value={newAppointment.method} onChange={e=>setNewAppointment({ ...newAppointment, method:e.target.value })} placeholder="In presenza / Video / Telefono" style={ipt} />
                  </div>
                  <div>
                    <div style={lbl}>Note</div>
                    <input value={newAppointment.notes} onChange={e=>setNewAppointment({ ...newAppointment, notes:e.target.value })} style={ipt} />
                  </div>
                </div>
              </InlineNewRow>
              <SimpleTable rows={appointments} cols={[{k:'ts',l:'Quando'},{k:'method',l:'Metodo'},{k:'mode',l:'Mode'},{k:'notes',l:'Note'}]} />
            </>
          )}

          {selectedId && tab==='proposte' && (
            <>
              <InlineNewRow title="Nuova proposta" onSave={async()=>{
                if (!newProposal.ts || !newProposal.line){ setError('Indica data e linea di prodotto.'); return }
                const { error } = await supabase.from('proposals').insert({
                  lead_id: selectedId,
                  ts: newProposal.ts,
                  line: newProposal.line,
                  notes: newProposal.notes||null
                })
                if (error){ setError(error.message); return }
                setNewProposal({ ts:'', line:'', notes:'' })
                await loadTabs(selectedId)
              }}>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12, overflow:'visible' }}>
                  <div>
                    <div style={lbl}>Data</div>
                    <input type="date" value={newProposal.ts} onChange={e=>setNewProposal({ ...newProposal, ts:e.target.value })} style={ipt} />
                  </div>
                  <div>
                    <div style={lbl}>Linea</div>
                    <select value={newProposal.line} onChange={e=>setNewProposal({ ...newProposal, line:e.target.value })} style={{ ...ipt, position:'relative', zIndex:2 }}>
                      <option value="">—</option>
                      <option value="Danni Non Auto">Danni Non Auto</option>
                      <option value="Vita Protection">Vita Protection</option>
                      <option value="Vita Premi Ricorrenti">Vita Premi Ricorrenti</option>
                      <option value="Vita Premi Unici">Vita Premi Unici</option>
                    </select>
                  </div>
                  <div>
                    <div style={lbl}>Note</div>
                    <input value={newProposal.notes} onChange={e=>setNewProposal({ ...newProposal, notes:e.target.value })} style={ipt} />
                  </div>
                </div>
              </InlineNewRow>
              <SimpleTable rows={proposals} cols={[{k:'ts',l:'Data'},{k:'line',l:'Linea'},{k:'notes',l:'Note'}]} />
            </>
          )}

          {selectedId && tab==='contratti' && (
            <>
              <InlineNewRow title="Nuovo contratto" onSave={async()=>{
                if (!newContract.ts || !newContract.kind){ setError('Indica data e tipo contratto.'); return }
                const amountNum = newContract.amount ? Number(newContract.amount) : null
                if (newContract.amount && isNaN(Number(newContract.amount))){ setError('Importo non valido'); return }
                const { error } = await supabase.from('contracts').insert({
                  lead_id: selectedId,
                  ts: newContract.ts,
                  kind: newContract.kind,
                  line: newContract.kind,
                  amount: amountNum,
                  notes: newContract.notes||null
                })
                if (error){ setError(error.message); return }
                setNewContract({ ts:'', kind:'', amount:'', notes:'' })
                await loadTabs(selectedId)
              }}>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12, overflow:'visible' }}>
                  <div>
                    <div style={lbl}>Data</div>
                    <input type="date" value={newContract.ts} onChange={e=>setNewContract({ ...newContract, ts:e.target.value })} style={ipt} />
                  </div>
                  <div>
                    <div style={lbl}>Tipo</div>
                    <select value={newContract.kind} onChange={e=>setNewContract({ ...newContract, kind:e.target.value })} style={{ ...ipt, position:'relative', zIndex:2 }}>
                      <option value="">—</option>
                      <option value="Danni Non Auto">Danni Non Auto</option>
                      <option value="Vita Protection">Vita Protection</option>
                      <option value="Vita Premi Ricorrenti">Vita Premi Ricorrenti</option>
                      <option value="Vita Premi Unici">Vita Premi Unici</option>
                    </select>
                  </div>
                  <div>
                    <div style={lbl}>Premio</div>
                    <input type="number" step="0.01" value={newContract.amount} onChange={e=>setNewContract({ ...newContract, amount:e.target.value })} style={ipt} />
                  </div>
                  <div>
                    <div style={lbl}>Note</div>
                    <input value={newContract.notes} onChange={e=>setNewContract({ ...newContract, notes:e.target.value })} style={ipt} />
                  </div>
                </div>
              </InlineNewRow>
              <SimpleTable rows={contracts} cols={[{k:'ts',l:'Data'},{k:'kind',l:'Tipo'},{k:'line',l:'Linea'},{k:'amount',l:'Premio'},{k:'notes',l:'Note'}]} />
            </>
          )}
        </div>
      </div>
    </div>
  )

  function tabBtn<K extends typeof tab>(id: K, label: string){
    const active = tab===id
    return (
      <button onClick={()=>setTab(id)} style={{
        ...btn,
        borderColor: active? '#111':'#ddd',
        color: active? '#111':'#333',
        background: active? '#f6f6f6':'#fff'
      }}>{label}</button>
    )
  }
}

function InlineNewRow({ title, onSave, children }:{ title:string; onSave:()=>void; children:React.ReactNode }){
  return (
    <div style={{ marginBottom:12 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, gap:12, flexWrap:'wrap' }}>
        <div style={{ fontWeight:600 }}>{title}</div>
        <button onClick={onSave} style={{ padding:'8px 10px', borderRadius:10, border:'1px solid #111', background:'#111', color:'#fff', cursor:'pointer' }}>Salva</button>
      </div>
      {children}
    </div>
  )
}

function emptyLead(): Lead {
  return {
    is_agency_client: null,
    first_name: '',
    last_name: '',
    company_name: '',
    email: '',
    phone: '',
    city: '',
    address: '',
    source: 'Provided'
  }
}
function normalizeLead(l: Lead): Lead {
  return {
    id: l.id,
    owner_id: l.owner_id,
    is_agency_client: (l.is_agency_client ?? null),
    first_name: l.first_name || '',
    last_name: l.last_name || '',
    company_name: l.company_name || '',
    email: l.email || '',
    phone: l.phone || '',
    city: l.city || '',
    address: l.address || '',
    source: (l.source as any) || 'Provided'
  }
}
function cleanLeadForDb(l: Lead){
  return {
    is_agency_client: l.is_agency_client,
    first_name: trimOrNull(l.first_name),
    last_name: trimOrNull(l.last_name),
    company_name: trimOrNull(l.company_name),
    email: trimOrNull(l.email),
    phone: trimOrNull(l.phone),
    city: trimOrNull(l.city),
    address: trimOrNull(l.address),
    source: l.source || 'Provided'
  }
}
function trimOrNull(s?: string | null){ const v = (s||'').trim(); return v ? v : null }

function SimpleTable({ rows, cols }:{ rows:any[], cols:{k:string,l:string}[] }){
  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
        <thead><tr>{cols.map(c => <th key={c.k} style={{ textAlign:'left', padding:'6px 8px', borderBottom:'1px solid #eee', color:'#666' }}>{c.l}</th>)}</tr></thead>
        <tbody>
          {rows.map((r,i)=>(
            <tr key={i}>
              {cols.map(c => <td key={c.k} style={{ padding:'6px 8px', borderBottom:'1px solid #f4f4f4' }}>{String(r[c.k] ?? '')}</td>)}
            </tr>
          ))}
          {!rows.length && <tr><td style={{ padding:'6px 8px', color:'#666' }} colSpan={cols.length}>Nessun dato.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
