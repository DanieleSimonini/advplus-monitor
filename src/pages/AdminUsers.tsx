import React, { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const box: React.CSSProperties = { background:'#fff', border:'1px solid #eee', borderRadius:16, padding:16 }
const ipt: React.CSSProperties = { padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd', width:'100%' }
const cta: React.CSSProperties = { padding: '10px 12px', borderRadius: 10, border: '1px solid #111', background: '#111', color: '#fff', cursor: 'pointer' }
const th: React.CSSProperties = { textAlign:'left', padding:'8px 6px', borderBottom:'1px solid #eee', color:'#666', fontWeight:600 }
const td: React.CSSProperties = { padding:'8px 6px', borderBottom:'1px solid #f2f2f2' }

export default function AdminUsers() {
  const [role, setRole] = useState<string>('')
  const [list, setList] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [form, setForm] = useState<any>({ email:'', full_name:'', role:'Advisor', reports_to:'', region:'' })
  const [saving, setSaving] = useState(false)

  // Carica ruolo utente corrente (blocca accesso ai non-Admin)
  useEffect(() => {
    (async () => {
      const u = await supabase.auth.getUser()
      const email = u.data.user?.email
      if (email) {
        const { data } = await supabase.from('advisors').select('role').eq('email', email).maybeSingle()
        setRole(data?.role || '')
      }
    })()
  }, [])

  const load = async () => {
    setLoading(true); setError('')
    const { data, error } = await supabase.from('advisors')
      .select('id,email,full_name,role,reports_to,region,created_at')
      .order('created_at', { ascending:false })
    if (error) setError(error.message)
    setList(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const email = (form.email||'').trim()
    const full_name = (form.full_name||'').trim()
    const role = form.role
    const reports_to = form.reports_to || null
    const region = form.region || null

    if (!email || !full_name || !role) { setError('Compila email, nome completo e ruolo.'); return }

    // Coerenza gerarchica
    if (role === 'Advisor') {
      const tl = list.find(x => x.id === reports_to)
      if (!tl || tl.role !== 'TeamLead') { setError('Per un Advisor seleziona un Team Lead in "Riporta a".'); return }
    }
    if (role === 'TeamLead') {
      const adm = list.find(x => x.id === reports_to)
      if (!adm || adm.role !== 'Admin') { setError('Per un Team Lead seleziona un Admin in "Riporta a".'); return }
    }

    setSaving(true)
    const { error } = await supabase.from('advisors').upsert({ email, full_name, role, reports_to, region }, { onConflict: 'email' })
    setSaving(false)
    if (error) { setError(error.message); return }

    setForm({ email:'', full_name:'', role:'Advisor', reports_to:'', region:'' })
    await load()
    alert('Utente salvato in advisors. Per permettere il login, crea (solo per ora) l’utente anche in Auth → Add User con la stessa email, oppure usa il pulsante Invita qui sotto se hai pubblicato la Function.')
  }

  // 👉 FUNZIONE INVITE (usa Edge Function admin_create_user)
  const invite = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const email = (form.email||'').trim()
    const full_name = (form.full_name||'').trim()
    const role = form.role
    const reports_to = form.reports_to || null
    const region = form.region || null

    if (!email || !full_name || !role) { setError('Compila email, nome completo e ruolo.'); return }

    if (role === 'Advisor') {
      const tl = list.find(x => x.id === reports_to)
      if (!tl || tl.role !== 'TeamLead') { setError('Per un Advisor seleziona un Team Lead in "Riporta a".'); return }
    }
    if (role === 'TeamLead') {
      const adm = list.find(x => x.id === reports_to)
      if (!adm || adm.role !== 'Admin') { setError('Per un Team Lead seleziona un Admin in "Riporta a".'); return }
    }

    const { data, error } = await supabase.functions.invoke('admin_create_user', {
      body: { email, full_name, role, reports_to, region }
    })
    if (error) { setError(error.message || 'Errore invito'); return }

    await load()
    alert('Utente creato e invitato. Riceverà l’email per impostare l’accesso.')
  }

  if (role !== 'Admin') return <div style={box}>Accesso negato: solo Admin.</div>

  return (
    <div style={{ display:'grid', gap:16 }}>
      <div style={{ fontWeight:700 }}>Admin → Utenti</div>

      <div style={box}>
        <div style={{ fontWeight:600, marginBottom:8 }}>Nuovo / Modifica</div>
        <form onSubmit={save} style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div>
            <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Email</div>
            <input value={form.email} onChange={e=>setForm({ ...form, email:e.target.value })} placeholder="nome@advisoryplus.it" style={ipt} />
          </div>
          <div>
            <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Nome completo</div>
            <input value={form.full_name} onChange={e=>setForm({ ...form, full_name:e.target.value })} placeholder="Mario Rossi" style={ipt} />
          </div>
          <div>
            <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Ruolo</div>
            <select value={form.role} onChange={e=>setForm({ ...form, role:e.target.value })} style={ipt}>
              <option value="Advisor">Advisor</option>
              <option value="TeamLead">TeamLead</option>
              <option value="Admin">Admin</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Riporta a</div>
            <select value={form.reports_to} onChange={e=>setForm({ ...form, reports_to: e.target.value })} style={ipt}>
              <option value="">(Nessuno)</option>
              {list.map(u => (
                <option key={u.id} value={u.id}>{u.full_name} — {u.role}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Regione (opz.)</div>
            <input value={form.region} onChange={e=>setForm({ ...form, region:e.target.value })} placeholder="Nord Ovest" style={ipt} />
          </div>
          <div style={{ alignSelf:'end', display:'flex', gap:8 }}>
            <button type="button" onClick={()=>setForm({ email:'', full_name:'', role:'Advisor', reports_to:'', region:'' })} style={{ ...cta, background:'#fff', color:'#111' }}>Reset</button>
            <button type="submit" disabled={saving} style={cta}>{saving? 'Salvataggio…':'Salva (solo DB)'}</button>
            <button type="button" onClick={invite} style={{ ...cta, background:'#0a7', borderColor:'#0a7' }}>Crea utente (invita)</button>
          </div>
        </form>
        {error && <div style={{ marginTop:8, color:'#c00' }}>{error}</div>}
      </div>

      <div style={box}>
        <div style={{ fontWeight:600, marginBottom:8 }}>Utenti esistenti</div>
        {loading ? (
          <div>Caricamento…</div>
        ) : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:14 }}>
            <thead>
              <tr>
                <th style={th}>Nome</th>
                <th style={th}>Email</th>
                <th style={th}>Ruolo</th>
                <th style={th}>Riporta a</th>
                <th style={th}>Regione</th>
                <th style={th}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {list.map(u => (
                <tr key={u.id}>
                  <td style={td}>{u.full_name}</td>
                  <td style={td}>{u.email}</td>
                  <td style={td}>{u.role}</td>
                  <td style={td}>{list.find(x=>x.id===u.reports_to)?.full_name || '—'}</td>
                  <td style={td}>{u.region || '—'}</td>
                  <td style={td}>
                    <button onClick={()=>setForm({ email:u.email, full_name:u.full_name, role:u.role, reports_to:u.reports_to||'', region:u.region||'' })} style={{ ...cta, padding:'6px 10px' }}>Modifica</button>
                  </td>
                </tr>
              ))}
              {!list.length && (
                <tr><td style={td} colSpan={6}>Nessun utente presente.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
