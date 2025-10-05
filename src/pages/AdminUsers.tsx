import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

// AdminUsers Step A: sola lettura, elenco pulito e ASCII only
// Prossimi step: B) campi editabili, C) azioni (salva/annulla/reinvio)

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

export default function AdminUsersPage(){
  const [advisors, setAdvisors] = useState<Advisor[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

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
    } catch(ex: any){ setErr(ex.message || 'Errore caricamento') }
    finally { setLoading(false) }
  }

  const teamLeads = useMemo(() => advisors.filter(a => a.role === 'Team Lead' || a.role === 'Admin'), [advisors])
  const nameOfTL = (uid: string | null) => {
    if (!uid) return '-'
    const tl = teamLeads.find(t => t.user_id === uid)
    return tl ? (tl.full_name || tl.email) : '-'
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
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
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
                {advisors.map(a => (
                  <tr key={a.id}>
                    <td style={td}>{a.email}</td>
                    <td style={td}>{a.full_name || '-'}</td>
                    <td style={td}>{a.role}</td>
                    <td style={td}>{nameOfTL(a.team_lead_user_id)}</td>
                    <td style={td}>{a.disabled ? 'Disattivato' : 'Attivo'}</td>
                    <td style={td}><code>{a.user_id || '-'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ ...box, background: '#fffbdd', borderColor: '#ffe58f' }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Nota</div>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          Questa e la versione di sola lettura per stabilizzare il build. Se tutto ok, procedo con Step B: campi editabili, e poi Step C: azioni (salva, annulla, reinvio invito).
        </div>
      </div>
    </div>
  )
}
