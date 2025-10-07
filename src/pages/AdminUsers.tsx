import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * AdminUsers.tsx — Gestione Utenti (solo Admin)
 * - Larghezza coerente con app (max 1100px)
 * - Colonne: Nome | Email | Ruolo | Responsabile | Azioni
 * - Nasconde UserID/Stato
 * - Azioni: Reinvia invito, Modifica (nome/email/ruolo/responsabile), Cancella con TRASFERIMENTO lead
 * - Ripristina creazione utente (invito) via Edge Function `invite` + upsert advisors (user_id NULL, verrà collegato al primo login)
 * - Niente uso della colonna `active`
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
const ipt: React.CSSProperties = { padding:'8px 10px', border:'1px solid #ddd', borderRadius:8, background:'#fff', width:'100%' }
const label: React.CSSProperties = { fontSize:12, color:'#666' }

export default function AdminUsersPage(){
  const [meRole, setMeRole] = useState<Role>('Junior')
  const [meUid, setMeUid] = useState<string>('')

  const [rows, setRows] = useState<Advisor[]>([])
  const [tls, setTls] = useState<Advisor[]>([]) // elenco Team Lead
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // editor
  const [isOpen, setIsOpen] = useState(false)
  const [editUid, setEditUid] = useState<string|null>(null)
  const emptyDraft = { full_name:'', email:'', role:'Junior' as Role, team_lead_user_id:'' }
  const [draft, setDraft] = useState<typeof emptyDraft>(emptyDraft)

  // creazione (invito)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const createEmpty = { full_name:'', email:'', role:'Junior' as Role, team_lead_user_id:'' }
  const [create, setCreate] = useState<typeof createEmpty>(createEmpty)

  // delete con trasferimento lead
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Advisor|null>(null)
  const [transferTo, setTransferTo] = useState<string>('')
  const [targetLeadCount, setTargetLeadCount] = useState<number>(0)

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

  // ===== Create =====
  function openCreate(){ setIsCreateOpen(true); setCreate(createEmpty) }
  function closeCreate(){ setIsCreateOpen(false) }
  async function doCreate(){
    if (!canAdmin()) return alert('Accesso negato: solo Admin')
    if (!create.email.trim()) return alert('Email obbligatoria')
    try{
      // 1) invia invito (se funzione presente)
      try{
        await supabase.functions.invoke('invite', { body: { email:create.email, role:create.role, full_name:create.full_name || undefined } })
      } catch{ /* opzionale: se la function non è configurata, ignoriamo */ }
      // 2) upsert su advisors per mostrare subito l'utente (user_id null; verrà collegato al login)
      const { error } = await supabase
        .from('advisors')
        .upsert({ email:create.email, full_name:create.full_name || null, role:create.role, team_lead_user_id: create.team_lead_user_id || null }, { onConflict:'email' })
      if (error) throw error
      await loadAdvisors(); closeCreate()
    } catch(e:any){ alert(e.message||'Errore creazione utente') }
  }

  // ===== Edit =====
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

  // ===== Delete con trasferimento lead =====
  async function requestDelete(a: Advisor){
    if (!canAdmin()) return alert('Accesso negato: solo Admin')
    setDeleteTarget(a)
    setTransferTo(rows.find(r=> r.user_id && r.user_id!==a.user_id)?.user_id || '')
    // conta lead posseduti
    if (a.user_id){
      const { count } = await supabase.from('leads').select('id', { count:'exact', head:true }).eq('owner_id', a.user_id)
      setTargetLeadCount(count||0)
    } else setTargetLeadCount(0)
    setIsDeleteOpen(true)
  }
  function closeDelete(){ setIsDeleteOpen(false); setDeleteTarget(null); setTargetLeadCount(0) }
  async function doDelete(){
    if (!deleteTarget) return
    try{
      if (deleteTarget.user_id && targetLeadCount>0){
        if (!transferTo) return alert('Seleziona un nuovo responsabile a cui trasferire i lead')
        const { error: eUpd } = await supabase.from('leads').update({ owner_id: transferTo }).eq('owner_id', deleteTarget.user_id)
        if (eUpd) throw eUpd
      }
      // elimina l'advisor
      const { error: eDel } = await supabase.from('advisors').delete().eq('user_id', deleteTarget.user_id!)
      if (eDel) throw eDel
      await loadAdvisors(); closeDelete()
    } catch(e:any){ alert(e.message||'Errore eliminazione') }
  }

  if (meRole!=='Admin'){
    return <div style={{ ...box, maxWidth:1100, margin:'0 auto' }}>Accesso negato: solo Admin.</div>
  }

  return (
    <div style={{ maxWidth:1100, margin:'0 auto', display:'grid', gap:16 }}>
      <div className="brand-card" style={{ ...box }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <div style={{ fontSize:18, fontWeight:700 }}>Gestione utenti</div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button className="brand-btn" onClick={openCreate}>+ Nuovo utente</button>
            <div style={{ fontSize:12, color:'#666' }}>{rows.length} utenti</div>
          </div>
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
                      <button className="brand-btn" onClick={()=>requestDelete(a)} style={{ background:'#c00', borderColor:'#c00', color:'#fff' }}>Cancella</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Create */}
      {isCreateOpen && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'grid', placeItems:'center', zIndex:50 }}>
          <div style={{ background:'#fff', borderRadius:12, padding:16, width:520 }}>
            <div style={{ fontWeight:700, marginBottom:12 }}>Nuovo utente</div>
            <div style={{ display:'grid', gap:12 }}>
              <div>
                <div style={label}>Nome</div>
                <input value={create.full_name} onChange={e=>setCreate(c=>({ ...c, full_name:e.target.value }))} style={ipt} />
              </div>
              <div>
                <div style={label}>Email</div>
                <input type="email" value={create.email} onChange={e=>setCreate(c=>({ ...c, email:e.target.value }))} style={ipt} />
              </div>
              <div>
                <div style={label}>Ruolo</div>
                <select value={create.role} onChange={e=>setCreate(c=>({ ...c, role: e.target.value as Role }))} style={ipt}>
                  <option value="Junior">Junior</option>
                  <option value="Team Lead">Team Lead</option>
                  <option value="Admin">Admin</option>
                </select>
              </div>
              <div>
                <div style={label}>Responsabile (Team Lead)</div>
                <select value={create.team_lead_user_id} onChange={e=>setCreate(c=>({ ...c, team_lead_user_id:e.target.value }))} style={ipt}>
                  <option value="">— Nessuno —</option>
                  {tls.map(t => <option key={t.user_id||t.email} value={t.user_id||''}>{nameOf(t)}</option>)}
                </select>
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
                <button className="brand-btn" onClick={closeCreate}>Annulla</button>
                <button className="brand-btn" onClick={doCreate}>Invia invito</button>
              </div>
            </div>
          </div>
        </div>
      )}

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
                <div style={label}>Email (anagrafica)</div>
                <input type="email" value={draft.email} onChange={e=>setDraft(d=>({ ...d, email:e.target.value }))} style={ipt} />
                <div style={{ fontSize:11, color:'#777', marginTop:4 }}>Nota: non cambia l'email di login.</div>
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

      {/* Modal Delete con trasferimento */}
      {isDeleteOpen && deleteTarget && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'grid', placeItems:'center', zIndex:50 }}>
          <div style={{ background:'#fff', borderRadius:12, padding:16, width:520 }}>
            <div style={{ fontWeight:700, marginBottom:12 }}>Elimina utente</div>
            <div style={{ display:'grid', gap:12 }}>
              <div>Stai per eliminare <strong>{nameOf(deleteTarget)}</strong>.</div>
              {targetLeadCount>0 ? (
                <div>
                  <div style={{ marginBottom:6 }}>Ha <strong>{targetLeadCount}</strong> lead assegnati. Seleziona a chi trasferirli:</div>
                  <select value={transferTo} onChange={e=>setTransferTo(e.target.value)} style={ipt}>
                    <option value="">— Seleziona destinatario —</option>
                    {rows.filter(r=>r.user_id && r.user_id!==deleteTarget.user_id).map(r=> (
                      <option key={r.user_id!} value={r.user_id!}>{nameOf(r)}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>Non ha lead assegnati.</div>
              )}
              <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
                <button className="brand-btn" onClick={closeDelete}>Annulla</button>
                <button className="brand-btn" onClick={doDelete} style={{ background:'#c00', borderColor:'#c00', color:'#fff' }}>Conferma elimina</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
