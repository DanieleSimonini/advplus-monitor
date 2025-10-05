import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

// AdminUsers Step B: campi editabili (senza azioni di salvataggio)
// Dopo conferma, Step C aggiungera Salva / Annulla / Reinvio invito.

type Role = 'Admin' | 'Team Lead' | 'Junior'

type Advisor = {
  id: string
  user_id: string | null
  email: string
  full_name: string | null
  role: Role
  team_lead_user_id: string | null
  disabled: boolean
}

const box: React.CSSProperties = { background: '#fff', border: '1px solid #eee', borderRadius: 16, padding: 16 }
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee', background: '#fafafa' }
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #f5f5f5' }
const ipt: React.CSSProperties = { padding: '6px 10px', border: '1px solid #ddd', borderRadius: 8 }

export default function AdminUsersPage(){
  const [advisors, setAdvisors] = useState<Advisor[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // drafts locali per le modifiche (non persistono in Step B)
  const [drafts, setDrafts] = useState<Record<string, Partial<Advisor>>>({})

  useEffect(() => { void loadAdvisors() }, [])

  async function loadAdvisors(){
    setLoading(true); setErr('')
    try{
      const { data, error } = await supabase
        .from('advisors')
        .select('id,user_id,email,full_name,role,team_lead_user_id,disabled')
        .order('role', { ascending: true })
        .order('full_name', { ascending: true })
      if (error) throw error
      setAdvisors((data || []) as Advisor[])
      setDrafts({})
    } catch(ex: any){ setErr(ex.message || 'Errore caricamento') }
    finally { setLoading(false) }
  }

  const teamLeads = useMemo(() => advisors.filter(a => a.role === 'Team Lead' || a.role === 'Admin'), [advisors])
  const nameOfTL = (uid: string | null) => {
    if (!uid) return '-'
    const tl = teamLeads.find(t => t.user_id === uid)
    return tl ? (tl.full_name || tl.email) : '-'
  }

  function setDraft(id: string, patch: Partial<Advisor>){
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }
  function getDraft(id: string): Advisor{
    const a = advisors.find(x => x.id === id)!
    const d = drafts[id] || {}
    return { ...a, ...d }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 800 }}>Utenti e Ruoli</div>

      <div style={{ ...box }}>
        {err && <div style={{ color: '#c00', marginBottom: 8 }}>{err}</div>}
        {loading ? (
          'Caricamento...'
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ marginBottom: 8, color: '#8a6d3b', background: '#fcf8e3', border: '1px solid #faebcc', padding: 8, borderRadius: 8 }}>
              Modifiche locali non salvate. Nel prossimo step aggiungeremo i pulsanti Salva / Annulla / Reinvio invito.
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
              <thead>
                <tr>
                  <th style={th}>Email</th>
                  <th style={th}>Nome</th>
                  <th style={th}>Ruolo</th>
                  <th style={th}>Team Lead</th>
                  <th style={th}>Stato</th>
                  <th style={th}>User ID</th>
                </tr>
              </thead>
              <tbody>
                {advisors.map(a => {
                  const d = getDraft(a.id)
                  return (
                    <tr key={a.id}>
                      <td style={td}>{a.email}</td>
                      <td style={td}>{a.full_name || '-'}</td>
                      <td style={td}>
                        <select value={d.role} onChange={e => setDraft(a.id, { role: e.target.value as Role })} style={ipt}>
                          <option value="Admin">Admin</option>
                          <option value="Team Lead">Team Lead</option>
                          <option value="Junior">Junior</option>
                        </select>
                      </td>
                      <td style={td}>
                        <select value={d.team_lead_user_id || ''} onChange={e => setDraft(a.id, { team_lead_user_id: e.target.value || null })} style={ipt}>
                          <option value="">-</option>
                          {teamLeads.map(tl => (
                            <option key={tl.user_id || tl.email} value={tl.user_id || ''}>{tl.full_name || tl.email} ({tl.role})</option>
                          ))}
                        </select>
                      </td>
                      <td style={td}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <input type="checkbox" checked={!!d.disabled} onChange={e => setDraft(a.id, { disabled: e.target.checked })} />
                          {d.disabled ? 'Disattivato' : 'Attivo'}
                        </label>
                      </td>
                      <td style={td}><code>{a.user_id || '-'}</code></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ ...box, background: '#fffbdd', borderColor: '#ffe58f' }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Nota</div>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          Questa e la versione con campi editabili locali. Nel prossimo step aggiungeremo la persistenza e il reinvio invito.
        </div>
      </div>
    </div>
  )
}
