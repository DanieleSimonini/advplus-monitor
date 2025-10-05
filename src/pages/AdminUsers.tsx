import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * AdminUsers.tsx — Gestione utenti/ruoli (senza Service Role)
 * - Elenco advisors (email, nome, ruolo, TL)
 * - Crea nuovo: email, nome, ruolo, team lead (opz.)
 * - Invita via magic-link (signInWithOtp) — non richiede service role
 * - Collega advisor by email: user_id verrà valorizzato al primo login (RootApp ha fallback by email)
 */

type Advisor = { id:string; user_id:string|null; email:string; full_name:string|null; role:'Admin'|'Team Lead'|'Junior'; team_lead_user_id:string|null }

const box: React.CSSProperties = { background:'#fff', border:'1px solid #eee', borderRadius:16, padding:16 }
const ipt: React.CSSProperties = { padding:'8px 10px', borderRadius:8, border:'1px solid #ddd' }

export default function AdminUsersPage(){
  const [advisors, setAdvisors] = useState<Advisor[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<'Admin'|'Team Lead'|'Junior'>('Junior')
  const [tlUserId, setTlUserId] = useState<string>('')
  const [ok, setOk] = useState('')

  useEffect(()=>{ (async()=>{
    await loadAdvisors()
  })() },[])

  async function loadAdvisors(){
    setLoading(true); setErr('')
    try{
      const { data, error } = await supabase
        .from('advisors')
        .select('id,user_id,email,full_name,role,team_lead_user_id')
        .order('role', { ascending:true })
        .order('full_name', { ascending:true })
      if (error) throw error
      setAdvisors((data||[]) as any)
    }catch(ex:any){ setErr(ex.message || 'Errore caricamento') }
    finally{ setLoading(false) }
  }

  const teamLeads = useMemo(()=> advisors.filter(a=>a.role==='Team Lead' || a.role==='Admin'), [advisors])

  async function invite(){
    setErr(''); setOk('')
    // Validazioni minime
    if (!email) { setErr('Inserisci un indirizzo email'); return }
    if (!role) { setErr('Seleziona un ruolo'); return }

    try{
      // 1) Crea/aggiorna advisor by email (user_id null: verrà collegato al primo login)
      const payload = {
        email: email.trim(),
        full_name: fullName.trim() || null,
        role,
        team_lead_user_id: tlUserId || null,
      }
      // upsert by email
      const { error: uerr } = await supabase
        .from('advisors')
        .upsert(payload, { onConflict:'email' })
      if (uerr) throw uerr

      // 2) Invia magic link (se email non registrata, Supabase crea l'utente alla conferma)
      const { error: merr } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin }
      })
      if (merr) throw merr

      setOk('Invito inviato. Controlla la posta (anche spam). Al primo accesso, il profilo verrà collegato automaticamente.')
      setEmail(''); setFullName(''); setRole('Junior'); setTlUserId('')
      await loadAdvisors()
    }catch(ex:any){ setErr(ex.message || 'Errore invio invito') }
  }

  return (
    <div style={{ display:'grid', gap:16 }}>
      <div style={{ fontSize:20, fontWeight:800 }}>Utenti & Ruoli</div>

      <div style={{ ...box }}>
        <div style={{ display:'grid', gap:10 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8 }}>
            <label style={{ display:'grid', gap:6 }}>
              <span style={{ fontSize:12, color:'#666' }}>Email</span>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)} style={ipt} />
            </label>
            <label style={{ display:'grid', gap:6 }}>
              <span style={{ fontSize:12, color:'#666' }}>Nome</span>
              <input type="text" value={fullName} onChange={e=>setFullName(e.target.value)} style={ipt} />
            </label>
            <label style={{ display:'grid', gap:6 }}>
              <span style={{ fontSize:12, color:'#666' }}>Ruolo</span>
              <select value={role} onChange={e=>setRole(e.target.value as any)} style={ipt}>
                <option value="Admin">Admin</option>
                <option value="Team Lead">Team Lead</option>
                <option value="Junior">Junior</option>
              </select>
            </label>
            <label style={{ display:'grid', gap:6 }}>
              <span style={{ fontSize:12, color:'#666' }}>Team Lead (opz.)</span>
              <select value={tlUserId} onChange={e=>setTlUserId(e.target.value)} style={ipt}>
                <option value="">—</option>
                {teamLeads.map(tl=> (
                  <option key={tl.user_id||tl.email} value={tl.user_id||''}>{tl.full_name || tl.email} ({tl.role})</option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <button onClick={invite} style={{ ...ipt, cursor:'pointer' }}>Invia invito</button>
          </div>
          {err && <div style={{ color:'#c00' }}>{err}</div>}
          {ok && <div style={{ color:'#080' }}>{ok}</div>}
        </div>
      </div>

      <div style={{ ...box }}>
        <div style={{ fontWeight:700, marginBottom:8 }}>Elenco utenti</div>
        {loading ? 'Caricamento…' : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', minWidth:800 }}>
              <thead>
                <tr>
                  <th style={th}>Email</th>
                  <th style={th}>Nome</th>
                  <th style={th}>Ruolo</th>
                  <th style={th}>Team Lead</th>
                  <th style={th}>User ID</th>
                </tr>
              </thead>
              <tbody>
                {advisors.map(a=> (
                  <tr key={a.id}>
                    <td style={td}>{a.email}</td>
                    <td style={td}>{a.full_name||'—'}</td>
                    <td style={td}>{a.role}</td>
                    <td style={td}>{teamLeads.find(t=>t.user_id===a.team_lead_user_id)?.full_name || '—'}</td>
                    <td style={td}><code>{a.user_id||'—'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const th: React.CSSProperties = { textAlign:'left', padding:'6px 8px', borderBottom:'1px solid #eee', background:'#fafafa' }
const td: React.CSSProperties = { padding:'6px 8px', borderBottom:'1px solid #f5f5f5' }
