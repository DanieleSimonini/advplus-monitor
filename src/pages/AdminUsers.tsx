import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

// AdminUsers Step C: campi editabili + azioni (Salva / Annulla / Reinvio invito)
// Requisito SQL gia' fatto: ALTER TABLE public.advisors ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false;

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
  const [ok, setOk] = useState('')

  // drafts locali per le modifiche
  const [drafts, setDrafts] = useState<Record<string, Partial<Advisor>>>({})

  useEffect(() => { void loadAdvisors() }, [])

  async function loadAdvisors(){
    setLoading(true); setErr(''); setOk('')
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
  function isDirty(a: Advisor, d: Advisor){
    return (
      d.role !== a.role ||
      d.team_lead_user_id !== a.team_lead_user_id ||
      d.disabled !== a.disabled
    )
  }

  async function saveRow(id: string){
    setErr(''); setOk('')
    const original = advisors.find(a => a.id === id)!
    const d = getDraft(id)
    const changed: Partial<Advisor> = {}
    if (d.role !== original.role) changed.role = d.role
    if (d.team_lead_user_id !== original.team_lead_user_id) changed.team_lead_user_id = d.team_lead_user_id || null
    if (d.disabled !== original.disabled) changed.disabled = !!d.disabled

    if (Object.keys(changed).length === 0){ setOk('Nessuna modifica da salvare'); return }

    try{
      const { error } = await supabase.from('advisors').update(changed).eq('id', id)
      if (error) throw error
      setOk('Salvato')
      await loadAdvisors()
    } catch(ex:any){ setErr(ex.message || 'Errore salvataggio') }
  }

  function cancelRow(id: string){
    setDrafts(prev => { const c = { ...prev }; delete c[id]; return c })
    setOk('Annullato')
  }

  async function reinviaInvito(email: string){
    setErr(''); setOk('')
    try{
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin }
      })
      if (error) throw error
      setOk('Invito inviato. Controlla la posta (anche spam).')
    } catch(ex:any){ setErr(ex.message || 'Errore invio invito') }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 800 }}>Utenti e Ruoli</div>

      <div style={{ ...box }}>
        {(err || ok) && (
          <div style={{ marginBottom: 8 }}>
            {err && <div style={{ color: '#c00' }}>{err}</div>}
            {ok && <div style={{ color: '#080' }}>{ok}</div>}
          </div>
        )}
        {loading ? (
          'Caricamento...'
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1150 }}>
              <thead>
                <tr>
                  <th style={th}>Email</th>
                  <th style={th}>Nome</th>
                  <th style={th}>Ruolo</th>
                  <th style={th}>Team Lead</th>
                  <th style={th}>Stato</th>
                  <th style={th}>User ID</th>
                  <th style={th}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {advisors.map(a => {
                  const d = getDraft(a.id)
                  const dirty = isDirty(a, d)
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
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <button onClick={() => reinviaInvito(a.email)} style={{ ...ipt, cursor: 'pointer' }}>Reinvio invito</button>
                        <button onClick={() => saveRow(a.id)} disabled={!dirty} style={{ ...ipt, cursor: dirty ? 'pointer' : 'not-allowed', marginLeft: 8 }}>Salva</button>
                        <button onClick={() => cancelRow(a.id)} disabled={!dirty} style={{ ...ipt, cursor: dirty ? 'pointer' : 'not-allowed', marginLeft: 8 }}>Annulla</button>
                      </td>
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
          Ora puoi modificare i campi e premere Salva per persistere. Reinvio invito invia un magic-link all'indirizzo della riga.
        </div>
      </div>
    </div>
  )
}
