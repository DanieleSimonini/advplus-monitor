import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * AdminUsers.tsx — Gestione Utenti (solo Admin)
 * Richieste:
 * 1) Larghezza coerente con le altre pagine (contenuto centrato, max-width)
 * 2) Rimuovere placeholder "Admin One" (non usiamo più dati hardcoded)
 * 3) Edit/Delete utenti (solo Admin):
 *    - Modifica: nome, email, ruolo, responsabile (team lead)
 *    - Cancella: soft-delete se esiste colonna `active`; fallback a delete fisico
 * 4) Nascondere colonne Stato e UserID
 * 5) Nuovo ordine colonne: Nome | Email | Ruolo | Responsabile | Azioni (Reinvia invito, Modifica, Cancella)
 * 6) Nome visualizzato = `full_name` (se vuoto, fallback a email)
 *
 * Nota tecnica:
 * - La modifica EMAIL qui aggiorna `advisors.email` (dato anagrafico). Non modifica l'email dell'utente nel sistema Auth.
 *   Per cambiare l'email di login serve una Edge Function con Service Role (possiamo aggiungerla in seguito).
 * - "Reinvia invito" usa la funzione edge `invite` già usata in precedenza.
 */

type Role = 'Admin' | 'Team Lead' | 'Junior'

type Advisor = {
  user_id: string | null
  email: string
  full_name: string | null
  role: Role
  team_lead_user_id?: string | null
  active?: boolean | null
}

const box: React.CSSProperties = { background:'#fff', border:'1px solid #eee', borderRadius:16, padding:16 }
const ipt: React.CSSProperties = { padding:'8px 10px', border:'1px solid #ddd', borderRadius:8, background:'#fff', width:'100%' }
const label: React.CSSProperties = { fontSize:12, color:'#666' }

export default function AdminUsersPage(){
  const [meRole, setMeRole] = useState<Role>('Junior')
  const [meUid, setMeUid] = useState<string>('')

  const [rows, setRows] = useState<Advisor[]>([])
  const [tls, setTls] = useState<Advisor[]>([]) // elenco Team Lead per assegnazione responsabile
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // editor
  const [isOpen, setIsOpen] = useState(false)
  const [editUid, setEditUid] = useState<string|null>(null)
  const emptyDraft = { full_name:'', email:'', role:'Junior' as Role, team_lead_user_id:'' }
  const [draft, setDraft] = useState<typeof emptyDraft>(emptyDraft)

  useEffect(()=>{ (async()=>{
    setLoading(true); setErr('')
    try{
      const u = await supabase.auth.getUser()
      const uid = u.data.user?.id || ''
      setMeUid(uid)
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
      .select('user_id,email,full_name,role,team_lead_user_id,active')
      .order('full_name', { ascending:true })
    if (error){ setErr(error.message); return }
    // filtra gli inattivi se esiste la colonna active
    const list = (data||[]) as Advisor[]
    const visible = list.filter(a => (typeof a.active === 'boolean' ? a.active : true))
    setRows(visible)
    setTls(visible.filter(a=>a.role==='Team Lead'))
  }

  function canAdmin(){ return meRole==='Admin' }

  function nameOf(a: Advisor){ return (a.full_name && a.full_name.trim()) || a.email }
  function nameByUid(uid: string|null){ const tl = rows.find(r=>r.user_id===uid); return tl ? nameOf(tl) : '—' }

  function openEdit(a: Advisor){
    setEditUid(a.user_id || null)
    setDraft({
      full_name: a.full_name || '',
      email: a.email || '',
      role: a.role,
      team_lead_user_id: a.team_lead_user_id || ''
    })
    setIsOpen(true)
  }
  function closeEdit(){ setIsOpen(false); setEditUid(null); setDraft(emptyDraft) }

  async function saveEdit(){
    if (!canAdmin()) return alert('Accesso negato: solo Admin')
    if (!editUid) return
    if (!draft.email.trim()) return alert('Email obbligatoria')

    const payload: Partial<Advisor> = {
      full_name: draft.full_name || null,
      email: draft.email,
      role: draft.role,
      team_lead_user_id: draft.team_lead_user_id || null,
    }
    const { error } = await supabase.from('advisors').update(payload).eq('user_id', editUid)
    if (error){ alert(error.message); return }
    await loadAdvisors(); closeEdit()
  }

  async function resendInvite(a: Advisor){
    if (!canAdmin()) return alert('Accesso negato: solo Admin')
    if (!a.email) return alert('Email non valida')
    try{
      const { error } = await supabase.functions.invoke('invite', {
        body: { email: a.email, role: a.role, full_name: a.full_name || undefined }
      })
      if (error) throw error
      alert('Invito inviato a '+a.email)
    } catch(e:any){ alert(e.message||'Errore invio invito') }
  }

  async function deleteUser(a: Advisor){
    if (!canAdmin()) return alert('Accesso negato: solo Admin')
    const ok = confirm(`Confermi la rimozione di ${nameOf(a)}?
Le assegnazioni ai lead resteranno con il suo user_id.`)
    if (!ok) return

    // preferisci soft-delete se c'è la colonna active, altrimenti delete fisico
    const upd = await supabase.from('advisors').update({ active:false }).eq('user_id', a.user_id!)
    if (upd.error){
      // se la colonna non esiste, fai delete
      const del = await supabase.from('advisors').delete().eq('user_id', a.user_id!)
      if (del.error){ alert(del.error.message); return }
    }
    await loadAdvisors()
  }

  if (meRole!=='Admin'){
    return <div style={{ ...box, maxWidth:1100, margin:'0 auto' }}>Accesso negato: solo Admin.</div>
  }

  return (
    <div style={{ maxWidth:1100, margin:'0 auto', display:'grid', gap:16 }}>
      <div className="brand-card" style={{ ...box }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <div style={{ fontSize:18, fontWeight:700 }}>Gestione utenti</div>
          <div style={{ fontSize:12, color:'#666' }}>{rows.length} utenti attivi</div>
        </div>

        {err && <div style={{ padding:10, border:'1px solid #fca5a5', background:'#fee2e2', color:'#7f1d1d', borderRadius:8 }}>{err}</div>}

        {/* Tabella */}
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
                    <div style={{ display:'flex', gap:8 }}>
                      <button className="brand-btn" onClick={()=>resendInvite(a)}>Reinvia invito</button>
                      <button className="brand-btn" onClick={()=>openEdit(a)}>Modifica</button>
                      <button className="brand-btn" onClick={()=>deleteUser(a)} style={{ background:'#c00', borderColor:'#c00', color:'#fff' }}>Cancella</button>
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
          <div style={{ background:'#fff', borderRadius:12, padding:16, width:520 }}>
            <div style={{ fontWeight:700, marginBottom:12 }}>Modifica utente</div>
            <div style={{ display:'grid', gap:12 }}>
              <div>
                <div style={label}>Nome</div>
                <input value={draft.full_name} onChange={e=>setDraft(d=>({ ...d, full_name:e.target.value }))} style={ipt} />
              </div>
              <div>
                <div style={label}>Email (visiva)</div>
                <input type="email" value={draft.email} onChange={e=>setDraft(d=>({ ...d, email:e.target.value }))} style={ipt} />
                <div style={{ fontSize:11, color:'#777', marginTop:4 }}>Nota: questo cambia l'email in anagrafica, non quella di login.</div>
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
    </div>
  )
}
