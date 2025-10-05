import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

// AdminUsers Step C+Invite: campi editabili + azioni + INVITA NUOVO UTENTE
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

type InviteDraft = {
  email: string
  full_name: string
  role: Role
  team_lead_user_id: string | null
}

const box: React.CSSProperties = { background: '#fff', border: '1px solid #eee', borderRadius: 16, padding: 16 }
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #eee', background: '#fafafa' }
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #f5f5f5' }
const ipt: React.CSSProperties = { padding: '6px 10px', border: '1px solid #ddd', borderRadius: 8 }
const row: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }

export default function AdminUsersPage(){
  const [advisors, setAdvisors] = useState<Advisor[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  // drafts locali per le modifiche riga
  const [drafts, setDrafts] = useState<Record<string, Partial<Advisor>>>({})

  // draft per INVITO
  const [invite, setInvite] = useState<InviteDraft>({ email: '', full_name: '', role: 'Junior', team_lead_user_id: '' as any })
  const [inviting, setInviting] = useState(false)

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

  async function doInvite(){
    setErr(''); setOk(''); setInviting(true)
    try{
      const email = invite.email.trim().toLowerCase()
      if (!email){ setErr('Email obbligatoria'); return }
      // cerca advisor esistente per email
      const { data: exists, error: e1 } = await supabase
        .from('advisors')
        .select('id,user_id')
        .eq('email', email)
        .maybeSingle()
      if (e1 && e1.code !== 'PGRST116') throw e1

      if (exists && exists.id){
        // aggiorna dati base
        const { error: uerr } = await supabase
          .from('advisors')
          .update({ full_name: invite.full_name || null, role: invite.role, team_lead_user_id: invite.team_lead_user_id || null, disabled: false })
          .eq('id', exists.id)
        if (uerr) throw uerr
      } else {
        // crea advisor
        const { error: ierr } = await supabase
          .from('advisors')
          .insert({ email, full_name: invite.full_name || null, role: invite.role, team_lead_user_id: invite.team_lead_user_id || null, disabled: false })
        if (ierr) throw ierr
      }

      // invia magic link
      const { error: merr } = await supabase.auth.signInWithOtp({
        email: email,
        options: { emailRedirectTo: window.location.origin }
      })
      if (merr) throw merr

      setOk('Utente creato/aggiornato e invito inviato')
      setInvite({ email: '', full_name: '', role: 'Junior', team_lead_user_id: '' as any })
      await loadAdvisors()
    } catch(ex:any){ setErr(ex.message || 'Errore durante invito') }
    finally{ setInviting(false) }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 800 }}>Utenti e Ruoli</div>

      {/* BOX INVITO NUOVO UTENTE */}
      <div style={{ ...box }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Invita nuovo utente</div>
        {(err || ok) && (
          <div style={{ marginBottom: 8 }}>
            {err && <div style={{ color: '#c00' }}>{err}</div>}
            {ok && <div style={{ color: '#080' }}>{ok}</div>}
          </div>
        )}
        <div style={row}>
          <div>
            <div style={{ fontSize: 12, marginBottom: 4 }}>Email</div>
            <input value={invite.email} onChange={e=>setInvite(v=>({ ...v, email: e.target.value }))} style={ipt} placeholder="nome@azienda.it" />
          </div>
          <div>
            <div style={{ fontSize: 12, marginBottom: 4 }}>Nome</div>
            <input value={invite.full_name} onChange={e=>setInvite(v=>({ ...v, full_name: e.target.value }))} style={ipt} placeholder="Nome Cognome" />
          </div>
          <div>
            <div style={{ fontSize: 12, marginBottom: 4 }}>Ruolo</div>
            <select value={invite.role} onChange={e=>setInvite(v=>({ ...v, role: e.target.value as Role }))} style={ipt}>
              <option value="Admin">Admin</option>
              <option value="Team Lead">Team Lead</option>
              <option value="Junior">Junior</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, marginBottom: 4 }}>Team Lead</div>
            <select value={invite.team_lead_user_id || ''} onChange={e=>setInvite(v=>({ ...v, team_lead_user_id: e.target.value || null }))} style={ipt}>
              <option value="">-</option>
              {teamLeads.map(tl => (
                <option key={tl.user_id || tl.email} value={tl.user_id || ''}>{tl.full_name || tl.email} ({tl.role})</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ height: 18 }} />
            <button onClick={doInvite} disabled={inviting} style={{ ...ipt, cursor: 'pointer' }}>Invia invito</button>
          </div>
        </div>
      </div>

      {/* BOX ELENCO UTENTI */}
      <div style={{ ...box }}>
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
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Note</div>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          L'invito crea o aggiorna la riga su advisors e invia un magic-link all'indirizzo indicato. Al primo login, l'auto-link user_id avviene in RootApp.
        </div>
      </div>
    </div>
  )
}
