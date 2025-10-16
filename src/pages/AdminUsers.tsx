import React, { useEffect, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * AdminUsers.tsx — Gestione Utenti (solo Admin)
 */

type Role = 'Admin' | 'Team Lead' | 'Junior'

type Advisor = {
  user_id: string | null
  email: string
  full_name: string | null
  role: Role
  team_lead_user_id?: string | null
}

const box: React.CSSProperties = { background:'#fff', border:'1px solid #eee', borderRadius:16, padding:16 }
const ipt: React.CSSProperties = { padding:'8px 10px', border:'1px solid #ddd', borderRadius:8, background:'#fff', width:'100%', maxWidth:'100%', minWidth:0, boxSizing:'border-box' }
const label: React.CSSProperties = { fontSize:12, color:'#666' }

export default function AdminUsersPage(){
  const [meRole, setMeRole] = useState<Role>('Junior')
  const [rows, setRows] = useState<Advisor[]>([])
  const [tls, setTls] = useState<Advisor[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // EDIT
  const [isOpen, setIsOpen] = useState(false)
  const [editUid, setEditUid] = useState<string|null>(null)
  const emptyDraft = { full_name:'', email:'', role:'Junior' as Role, team_lead_user_id:'' }
  const [draft, setDraft] = useState<typeof emptyDraft>(emptyDraft)

  // DELETE → REASSIGN
  const [reassignUid, setReassignUid] = useState<string|null>(null)
  const [reassignTo, setReassignTo] = useState<string>('')
  const [reassignCount, setReassignCount] = useState<number>(0)

  // NEW USER
  const [newUser, setNewUser] = useState<{full_name:string; email:string; role:Role; team_lead_user_id:string}>({ full_name:'', email:'', role:'Junior', team_lead_user_id:'' })

  useEffect(()=>{ (async()=>{
    setLoading(true); setErr('')
    try{
      const u = await supabase.auth.getUser()
      const uid = u.data.user?.id || ''
      if (uid){
        const { data: me } = await supabase.from('advisors').select('role').eq('user_id', uid).maybeSingle()
        if (me?.role) setMeRole(me.role as Role)
      }
      await loadAdvisors()
    } catch(e:any){ setErr(e.message||'Errore caricamento') } finally { setLoading(false) }
  })() },[])

  async function loadAdvisors(){
    const { data, error } = await supabase
      .from('advisors')
      .select('user_id,email,full_name,role,team_lead_user_id')
      .order('full_name', { ascending:true })
    if (error){ setErr(error.message); return }
    const list = (data||[]) as Advisor[]
    setRows(list)
    setTls(list.filter(a=>a.role==='Team Lead'))
  }

  function canAdmin(){ return meRole==='Admin' }
  function nameOf(a: Advisor){ return (a.full_name && a.full_name.trim()) || a.email }
  function nameByUid(uid: string|null){ const tl = rows.find(r=>r.user_id===uid); return tl ? nameOf(tl) : '—' }

  // ====== INVITES con retry + fallback ======
  function normalizeRole(r: Role){
    return r === 'Team Lead' ? 'TeamLead' : r
  }
  function buildInviteBody(payload: { email:string; role:Role; full_name?:string }){
    const roleForEdge = normalizeRole(payload.role)
    return {
      email: payload.email,
      role: roleForEdge,
      role_id: roleForEdge,          // compat: se la funzione usa role_id
      full_name: payload.full_name,
    }
  }
  async function sleep(ms:number){ return new Promise(res=>setTimeout(res, ms)) }

  async function sendWithFetch(url:string, body:any){
    const anon = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': anon, 'authorization': `Bearer ${anon}` },
      body: JSON.stringify(body),
      keepalive: true,
    })
    if (!resp.ok){
      const txt = await resp.text()
      // 409: utente già presente → trattiamo come "non bloccante" (reinvia invito o già attivo)
      if (resp.status === 409) return { ok:true, note:'exists' }
      const err = new Error(`HTTP ${resp.status} — ${txt}`)
      // 425/429/500/503/504 → retryabile
      ;(err as any).retryable = [425,429,500,503,504].includes(resp.status)
      throw err
    }
    return { ok:true }
  }

  async function sendWithInvoke(name:string, body:any){
    const { data, error } = await supabase.functions.invoke(name, { body })
    if (error){
      const msg = error.message || 'Edge error'
      const err = new Error(msg)
      ;(err as any).retryable = /timeout|too\s*many|earlydrop|temporar/i.test(msg)
      throw err
    }
    return { ok:true }
  }

  async function sendInvite(payload: { email:string; role:Role; full_name?:string }){
    const url  = (import.meta as any).env?.VITE_SUPABASE_URL
    const anon = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY
    if (!url || !anon) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
    const body = buildInviteBody(payload)

    const attempts = [600, 1200, 2400] // backoff ms

    // 1) Direct fetch → /functions/v1/invite
    let lastErr:any = null
    for (let i=0; i<attempts.length; i++){
      try{
        const res = await sendWithFetch(`${url}/functions/v1/invite`, body)
        return res.note === 'exists' ? 'direct-existing' : 'direct'
      }catch(e:any){
        lastErr = e
        if (!e?.retryable) break
        await sleep(attempts[i])
      }
    }

    // 2) Supabase invoke → invite
    for (let i=0; i<attempts.length; i++){
      try{
        await sendWithInvoke('invite', body)
        return 'edge'
      }catch(e:any){
        lastErr = e
        if (!e?.retryable) break
        await sleep(attempts[i])
      }
    }

    // 3) Fallback → smtp_invite (se esiste lato server)
    for (let i=0; i<attempts.length; i++){
      try{
        // prima fetch diretta
        await sendWithFetch(`${url}/functions/v1/smtp_invite`, body)
        return 'smtp-direct'
      }catch(e:any){
        lastErr = e
        if (!e?.retryable) break
        await sleep(attempts[i])
      }
    }
    for (let i=0; i<attempts.length; i++){
      try{
        await sendWithInvoke('smtp_invite', body)
        return 'smtp-edge'
      }catch(e:any){
        lastErr = e
        if (!e?.retryable) break
        await sleep(attempts[i])
      }
    }

    throw new Error(`Invio invito fallito. Ultimo errore: ${lastErr?.message||lastErr}`)
  }

  async function inviteNew(){
    if (!canAdmin()) return alert('Accesso negato: solo Admin')
    if (!newUser.email.trim()) return alert('Email obbligatoria')
    try{
      const mode = await sendInvite({ email:newUser.email, role:newUser.role, full_name: newUser.full_name || undefined })
      const note = mode.includes('existing') ? ' (utente già presente)' : ''
      alert(`Invito inviato${note} (${mode}).`)
      setNewUser({ full_name:'', email:'', role:'Junior', team_lead_user_id:'' })
      await loadAdvisors()
    } catch(e:any){ alert(e.message||'Errore invito') }
  }

  async function resendInvite(a: Advisor){
    if (!canAdmin()) return alert('Accesso negato: solo Admin')
    if (!a?.email) return alert('Email non valida')
    try{
      const mode = await sendInvite({ email:a.email, role:a.role, full_name: a.full_name||undefined })
      alert(`Invito inviato a ${a.email} (${mode}).`)
    } catch(e:any){ alert(e.message||'Errore invio invito') }
  }

  // ====== EDIT ======
  function openEdit(a: Advisor){
    setEditUid(a.user_id || null)
    setDraft({ full_name: a.full_name || '', email: a.email || '', role: a.role, team_lead_user_id: a.team_lead_user_id || '' })
    setIsOpen(true)
  }
  function closeEdit(){ setIsOpen(false); setEditUid(null); setDraft(emptyDraft) }

  async function saveEdit(){
    if (!canAdmin()) return alert('Accesso negato: solo Admin')
    if (!editUid) return
    if (!draft.email.trim()) return alert('Email obbligatoria')

    const payload: Partial<Advisor> = { full_name: draft.full_name || null, email: draft.email, role: draft.role, team_lead_user_id: draft.team_lead_user_id || null }
    const { error } = await supabase.from('advisors').update(payload).eq('user_id', editUid)
    if (error){ alert(error.message); return }
    await loadAdvisors(); closeEdit()
  }

  // ====== DELETE + REASSIGN ======
  async function requestDelete(a: Advisor){
    if (!canAdmin()) return alert('Accesso negato: solo Admin')

    if (!a.user_id){
      const ok = confirm(`Confermi l'eliminazione di ${nameOf(a)}?`)
      if (!ok) return
      const del = await supabase.from('advisors').delete().eq('email', a.email)
      if (del.error){ alert(del.error.message); return }
      await loadAdvisors();
      return
    }

    const { count, error } = await supabase
      .from('leads')
      .select('id', { count:'exact', head:true })
      .eq('owner_id', a.user_id)
    if (error){ alert(error.message); return }

    if ((count||0) > 0){
      setReassignUid(a.user_id)
      setReassignTo(a.team_lead_user_id || '')
      setReassignCount(count||0)
    } else {
      const ok = confirm(`Confermi l'eliminazione di ${nameOf(a)}?`)
      if (!ok) return
      const del = await supabase.from('advisors').delete().eq('user_id', a.user_id)
      if (del.error){ alert(del.error.message); return }
      await loadAdvisors()
    }
  }

  async function confirmReassignAndDelete(){
    if (!reassignUid) return
    if (!reassignTo) return alert('Seleziona un nuovo assegnatario per i lead')
    const upd = await supabase.from('leads').update({ owner_id: reassignTo }).eq('owner_id', reassignUid)
    if (upd.error){ alert(upd.error.message); return }
    const del = await supabase.from('advisors').delete().eq('user_id', reassignUid)
    if (del.error){ alert(del.error.message); return }
    setReassignUid(null); setReassignTo(''); setReassignCount(0)
    await loadAdvisors()
  }

  if (meRole!=='Admin'){
    return <div style={{ ...box, maxWidth:1100, margin:'0 auto' }}>Accesso negato: solo Admin.</div>
  }

  return (
    <div style={{ maxWidth:1100, margin:'0 auto', display:'grid', gap:16 }}>
      {/* Nuovo utente */}
      <div className="brand-card" style={{ ...box }}>
        <div style={{ fontWeight:700, marginBottom:12 }}>Nuovo utente</div>
        <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1.4fr 1fr 1fr auto', gap:8, alignItems:'end' }}>
          <div>
            <div style={label}>Nome</div>
            <input value={newUser.full_name} onChange={e=>setNewUser(s=>({ ...s, full_name:e.target.value }))} style={ipt} placeholder="Nome e cognome" />
          </div>
          <div>
            <div style={label}>Email</div>
            <input type="email" value={newUser.email} onChange={e=>setNewUser(s=>({ ...s, email:e.target.value }))} style={ipt} placeholder="name@domain" />
          </div>
          <div>
            <div style={label}>Ruolo</div>
            <select value={newUser.role} onChange={e=>setNewUser(s=>({ ...s, role: e.target.value as Role }))} style={ipt}>
              <option value="Junior">Junior</option>
              <option value="Team Lead">Team Lead</option>
              <option value="Admin">Admin</option>
            </select>
          </div>
          <div>
            <div style={label}>Responsabile (TL)</div>
            <select value={newUser.team_lead_user_id} onChange={e=>setNewUser(s=>({ ...s, team_lead_user_id:e.target.value }))} style={ipt}>
              <option value="">— Nessuno —</option>
              {tls.map(t => <option key={t.user_id||t.email} value={t.user_id||''}>{nameOf(t)}</option>)}
            </select>
          </div>
          <div>
            <button className="brand-btn" onClick={inviteNew}>Invia invito</button>
          </div>
        </div>
      </div>

      {/* Lista utenti */}
      <div className="brand-card" style={{ ...box }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <div style={{ fontSize:18, fontWeight:700 }}>Gestione utenti</div>
          <div style={{ fontSize:12, color:'#666' }}>{rows.length} utenti</div>
        </div>

        {err && <div style={{ padding:10, border:'1px solid #fca5a5', background:'#fee2e2', color:'#7f1d1d', borderRadius:8 }}>{err}</div>}

        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ textAlign:'left' }}>
                <th style={{ padding:'8px 6px', borderBottom:'1px solid #eee' }}>Nome</th>
                <th style={{ padding:'8px 6px', borderBottom:'1px solid #eee' }}>Email</th>
                <th style={{ padding:'8px 6px', borderBottom:'1px solid #eee' }}>Ruolo</th>
                <th style={{ padding:'8px 6px', borderBottom:'1px solid #eee' }}>Responsabile</th>
                <th style={{ padding:'8px 6px', borderBottom:'1px solid #eee' }}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.user_id || a.email}>
                  <td style={{ padding:'8px 6px', borderBottom:'1px solid #f2f2f2' }}>{nameOf(a)}</td>
                  <td style={{ padding:'8px 6px', borderBottom:'1px solid #f2f2f2' }}>{a.email}</td>
                  <td style={{ padding:'8px 6px', borderBottom:'1px solid #f2f2f2' }}>{a.role}</td>
                  <td style={{ padding:'8px 6px', borderBottom:'1px solid #f2f2f2' }}>{nameByUid(a.team_lead_user_id||null)}</td>
                  <td style={{ padding:'8px 6px', borderBottom:'1px solid #f2f2f2' }}>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      <button className="brand-btn" onClick={()=>resendInvite(a)}>Reinvia invito</button>
                      <button className="brand-btn" onClick={()=>openEdit(a)}>Modifica</button>
                      <button className="brand-btn" onClick={()=>requestDelete(a)} style={{ background:'#c00', borderColor:'#c00', color:'#fff' }}>Cancella</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Edit */}
      {isOpen && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'grid', placeItems:'center', zIndex:50 }}>
          <div style={{ background:'#fff', borderRadius:12, padding:16, width:'min(92vw, 560px)' }}>
            <div style={{ fontWeight:700, marginBottom:12 }}>Modifica utente</div>
            <div style={{ display:'grid', gap:12 }}>
              <div>
                <div style={label}>Nome</div>
                <input value={draft.full_name} onChange={e=>setDraft(d=>({ ...d, full_name:e.target.value }))} style={ipt} />
              </div>
              <div>
                <div style={label}>Email (anagrafica)</div>
                <input type="email" value={draft.email} onChange={e=>setDraft(d=>({ ...d, email:e.target.value }))} style={ipt} />
                <div style={{ fontSize:11, color:'#777', marginTop:4 }}>Nota: non modifica l'email di login.</div>
              </div>
              <div>
                <div style={label}>Ruolo</div>
                <select value={draft.role} onChange={e=>setDraft(d=>({ ...d, role: e.target.value as Role }))} style={ipt}>
                  <option value="Junior">Junior</option>
                  <option value="Team Lead">Team Lead</option>
                  <option value="Admin">Admin</option>
                </select>
              </div>
              <div>
                <div style={label}>Responsabile (Team Lead)</div>
                <select value={draft.team_lead_user_id} onChange={e=>setDraft(d=>({ ...d, team_lead_user_id:e.target.value }))} style={ipt}>
                  <option value="">— Nessuno —</option>
                  {tls.map(t => <option key={t.user_id||t.email} value={t.user_id||''}>{nameOf(t)}</option>)}
                </select>
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
                <button className="brand-btn" onClick={closeEdit}>Annulla</button>
                <button className="brand-btn" onClick={saveEdit}>Salva</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Reassign + Delete */}
      {reassignUid && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'grid', placeItems:'center', zIndex:50 }}>
          <div style={{ background:'#fff', borderRadius:12, padding:16, width:'min(92vw, 560px)' }}>
            <div style={{ fontWeight:700, marginBottom:12 }}>Riassegna {reassignCount} lead</div>
            <div style={{ display:'grid', gap:12 }}>
              <div>
                <div style={label}>Nuovo assegnatario</div>
                <select value={reassignTo} onChange={e=>setReassignTo(e.target.value)} style={ipt}>
                  <option value="">— Seleziona —</option>
                  {rows.filter(r=>r.user_id!==reassignUid).map(r=> (
                    <option key={r.user_id||r.email} value={r.user_id||''}>{nameOf(r)} — {r.role}</option>
                  ))}
                </select>
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
                <button className="brand-btn" onClick={()=>{ setReassignUid(null); setReassignTo(''); setReassignCount(0) }}>Annulla</button>
                <button className="brand-btn" onClick={confirmReassignAndDelete}>Riassegna e cancella</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {err && <div style={{ padding:10, border:'1px solid #fca5a5', background:'#fee2e2', color:'#7f1d1d', borderRadius:8 }}>{err}</div>}
      {loading && <div>Caricamento…</div>}
    </div>
  )
}
