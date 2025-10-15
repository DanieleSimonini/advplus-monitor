import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * Leads.tsx — Gestione Leads
 * ✅ Layout aggiornato (sinistra più larga, destra più compatta)
 * ✅ Filtri ordinati in 3 righe
 * ✅ Fix nome/cognome
 */

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

const box: React.CSSProperties = {
  background: '#fff',
  border: '1px solid var(--border, #eee)',
  borderRadius: 16,
  padding: 16
}

const ipt: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '1px solid var(--border, #ddd)',
  borderRadius: 8,
  background: '#fff',
  boxSizing: 'border-box',
}

const label: React.CSSProperties = { fontSize: 12, color: '#666' }

export default function LeadsPage() {
  const [meRole, setMeRole] = useState<Role>('Junior')
  const [meUid, setMeUid] = useState<string>('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [advisors, setAdvisors] = useState<AdvisorRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Lead>>({ is_agency_client: null, is_working: true })
  const [loading, setLoading] = useState(true)

  // Filtri elenco
  const [assigneeFilter, setAssigneeFilter] = useState<string>('')
  const [onlyWorking, setOnlyWorking] = useState<boolean>(true)
  const [onlyContacted, setOnlyContacted] = useState<boolean>(false)
  const [onlyAppointment, setOnlyAppointment] = useState<boolean>(false)
  const [onlyProposal, setOnlyProposal] = useState<boolean>(false)
  const [onlyContract, setOnlyContract] = useState<boolean>(false)
  const [q, setQ] = useState<string>('')

  const isTLorAdmin = meRole === 'Admin' || meRole === 'Team Lead'
  const gridColsFiltersTop = isTLorAdmin ? 'minmax(180px,1fr) 170px' : '1fr 170px'

  useEffect(() => { void init() }, [])

  async function init() {
    setLoading(true)
    const { data: s } = await supabase.auth.getUser()
    const uid = s.user?.id || ''
    setMeUid(uid)
    if (uid) {
      const { data: me } = await supabase.from('advisors').select('role').eq('user_id', uid).maybeSingle()
      if (me?.role) setMeRole(me.role as Role)
    }
    await Promise.all([loadLeads(), loadAdvisors()])
    setLoading(false)
  }

  async function loadLeads() {
    const { data } = await supabase
      .from('leads')
      .select('id,owner_id,is_agency_client,first_name,last_name,company_name,email,phone,city,address,source,created_at,is_working')
      .order('created_at', { ascending: false })
    setLeads(data || [])
  }

  async function loadAdvisors() {
    const { data } = await supabase
      .from('advisors')
      .select('user_id,email,full_name,role')
      .order('full_name', { ascending: true })
    setAdvisors((data || []) as AdvisorRow[])
  }

  function leadLabel(l: Partial<Lead>) {
    const n = [l.first_name || '', l.last_name || ''].join(' ').trim()
    return n || l.email || l.phone || 'Lead'
  }

  async function saveLead() {
    if (!form.first_name || !form.last_name || !form.email) {
      alert('Compila i campi obbligatori')
      return
    }
    const payload = {
      owner_id: form.owner_id || meUid,
      is_agency_client: form.is_agency_client,
      first_name: form.first_name,
      last_name: form.last_name,
      email: form.email,
      phone: form.phone,
      city: form.city,
      address: form.address,
      source: form.source,
      is_working: form.is_working ?? true
    }
    if (editingLeadId) {
      await supabase.from('leads').update(payload).eq('id', editingLeadId)
    } else {
      await supabase.from('leads').insert(payload)
    }
    await loadLeads()
    setForm({ is_agency_client: null, is_working: true })
  }

  const filtered = useMemo(() => {
    let arr = [...leads]
    if (assigneeFilter) arr = arr.filter(l => l.owner_id === assigneeFilter)
    if (onlyWorking) arr = arr.filter(l => l.is_working)
    if (q.trim()) {
      const s = q.toLowerCase()
      arr = arr.filter(l => `${l.first_name} ${l.last_name}`.toLowerCase().includes(s))
    }
    return arr
  }, [leads, assigneeFilter, onlyWorking, q])

  const juniorOptions = useMemo(
    () => advisors.filter(a => a.role === 'Junior' && a.user_id),
    [advisors]
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '420px minmax(0,0.9fr)', gap: 20 }}>

      {/* === SINISTRA === */}
      <div className="brand-card" style={{ ...box }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Leads</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="brand-btn" onClick={() => setForm({ is_agency_client: null, is_working: true })}>+ Nuovo</button>
          </div>
        </div>

        {/* === FILTRI (3 righe) === */}
        <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
          {/* Riga 1: Assegnatario + In Lavorazione */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: gridColsFiltersTop,
              alignItems: 'end',
              gap: 8
            }}
          >
            {isTLorAdmin ? (
              <div>
                <div style={label}>Assegnatario</div>
                <select
                  style={{ ...ipt, width: '100%' }}
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value)}
                >
                  <option value="">Tutti</option>
                  {advisors
                    .filter(a => a.role === 'Junior' && a.user_id)
                    .map(a => (
                      <option key={a.user_id!} value={a.user_id!}>
                        {a.full_name || a.email}
                      </option>
                    ))}
                </select>
              </div>
            ) : (
              <div />
            )}
            <div>
              <div style={{ visibility: 'hidden', height: 14 }} />
              <button
                className="brand-btn"
                onClick={() => setOnlyWorking(v => !v)}
                style={onlyWorking ? { background: 'var(--brand-primary-600, #0029ae)', color: '#fff' } : undefined}
              >
                In Lavorazione
              </button>
            </div>
          </div>

          {/* Riga 2 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button className="brand-btn" onClick={() => setOnlyContacted(v => !v)}>Contattato</button>
            <button className="brand-btn" onClick={() => setOnlyAppointment(v => !v)}>Fissato/Fatto Appuntamento</button>
          </div>

          {/* Riga 3 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button className="brand-btn" onClick={() => setOnlyProposal(v => !v)}>Presentata Proposta</button>
            <button className="brand-btn" onClick={() => setOnlyContract(v => !v)}>Firmato Contratto</button>
          </div>
        </div>

        <div>
          <div style={label}>Cerca (Nome + Cognome)</div>
          <input style={ipt} placeholder="es. Mario Rossi" value={q} onChange={e => setQ(e.target.value)} />
        </div>

        <div style={{ marginTop: 12 }}>
          {loading ? 'Caricamento...' : (
            <div style={{ display: 'grid', gap: 8 }}>
              {filtered.map(l => (
                <div
                  key={l.id}
                  onClick={() => { setSelectedId(l.id!); setEditingLeadId(l.id!); setForm(l) }}
                  style={{
                    border: '1px solid',
                    borderColor: selectedId === l.id ? '#0029ae' : '#eee',
                    background: selectedId === l.id ? '#F0F6FF' : '#fff',
                    borderRadius: 12,
                    padding: 10,
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{leadLabel(l)}</div>
                  <div style={{ fontSize: 12, color: '#666' }}>{l.email || l.phone || '—'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* === DESTRA === */}
      <div className="brand-card" style={{ ...box }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            {editingLeadId ? `Modifica — ${leadLabel(form)}` : 'Nuovo Lead'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="brand-btn" onClick={saveLead}>{editingLeadId ? 'Salva' : 'Crea'}</button>
            <button className="brand-btn" onClick={() => setForm({ is_agency_client: null, is_working: true })}>Reset</button>
            <button
              className="brand-btn"
              onClick={() => setForm(f => ({ ...f, is_working: !f.is_working }))}
              style={form?.is_working
                ? { background: 'var(--brand-primary-600, #0029ae)', color: '#fff' }
                : { background: '#c1121f', color: '#fff' }}
            >
              {form?.is_working ? 'In Lavorazione' : 'Stop Lavorazione'}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          {(meRole === 'Admin' || meRole === 'Team Lead') && (
            <div>
              <div style={label}>Assegna a Junior</div>
              <select
                value={form.owner_id || ''}
                onChange={e => setForm(f => ({ ...f, owner_id: e.target.value || null }))}
                style={ipt}
              >
                <option value="">— Scegli —</option>
                {juniorOptions.map(a => (
                  <option key={a.user_id!} value={a.user_id!}>{a.full_name || a.email}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <div style={label}>Nome</div>
            <input style={ipt} value={form.first_name || ''} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
          </div>
          <div>
            <div style={label}>Cognome</div>
            <input style={ipt} value={form.last_name || ''} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
          </div>
          <div>
            <div style={label}>Email</div>
            <input style={ipt} value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <div style={label}>Telefono</div>
            <input style={ipt} value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
        </div>
      </div>
    </div>
  )
}
