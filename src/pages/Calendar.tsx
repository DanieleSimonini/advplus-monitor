import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * Calendar.tsx — Agenda con vista mensile + settimanale
 * Patch v2: card appuntamento come mock + aggiunta indicazione Assegnatario
 * NOTE: non modifica logica, query o CRUD; solo rendering UI.
 */

type Role = 'Admin' | 'Team Lead' | 'Junior'
type Mode = 'inperson' | 'phone' | 'video'

type Advisor = {
  user_id: string
  email: string
  full_name: string | null
  role: Role
  team_lead_user_id?: string | null
}

type Lead = {
  id: string
  owner_id: string | null
  first_name: string | null
  last_name: string | null
  company_name: string | null
}

type Appointment = {
  id: string
  lead_id: string
  ts: string // ISO
  mode: Mode
  notes: string | null
  lead?: Lead
}

const MODE_OPTIONS: { label: string; db: Mode }[] = [
  { label: 'In presenza', db: 'inperson' },
  { label: 'Video', db: 'video' },
  { label: 'Telefono', db: 'phone' },
]

function monthKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
function startOfMonth(d: Date){ return new Date(d.getFullYear(), d.getMonth(), 1) }
function endOfMonth(d: Date){ return new Date(d.getFullYear(), d.getMonth()+1, 0) }
function addMonths(d: Date, delta: number){ return new Date(d.getFullYear(), d.getMonth()+delta, 1) }
function sameDay(a: Date, b: Date){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate() }
function startOfWeek(d: Date){ const x=new Date(d); const w=(x.getDay()+6)%7; x.setDate(x.getDate()-w); x.setHours(0,0,0,0); return x }
function addDays(d: Date,n:number){ const x=new Date(d); x.setDate(x.getDate()+n); return x }

const box: React.CSSProperties = { background:'var(--card, #fff)', border:'1px solid var(--border, #eee)', borderRadius:16, padding:16 }
const ipt: React.CSSProperties = { padding:'8px 10px', border:'1px solid var(--border,#ddd)', borderRadius:8, background:'#fff' }
const label: React.CSSProperties = { fontSize:12, color:'var(--muted,#666)' }

const MAX_PREVIEW = 3

export default function CalendarPage(){
  const [me, setMe] = useState<Advisor|null>(null)
  const [advisors, setAdvisors] = useState<Advisor[]>([])
  const [scope, setScope] = useState<'me'|'team'|'all'>('me')
  const [month, setMonth] = useState<string>(monthKey(new Date()))
  const [activeDate, setActiveDate] = useState<Date>(new Date())
  const [view, setView] = useState<'month'|'week'>('month')
  const [leads, setLeads] = useState<Lead[]>([])
  const [appts, setAppts] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [selectedAdvisor, setSelectedAdvisor] = useState<string>('')
  const [editingId, setEditingId] = useState<string|null>(null)
  const emptyDraft: { id:string; lead_id:string; ts:string; mode:Mode; notes:string } = { id:'', lead_id:'', ts:'', mode:'inperson', notes:'' }
  const [draft, setDraft] = useState<typeof emptyDraft>(emptyDraft)
  const [openDayDate, setOpenDayDate] = useState<Date | null>(null)

  // bootstrap
  useEffect(()=>{ (async()=>{
    setLoading(true)
    try{
      const u = await supabase.auth.getUser()
      const uid = u.data.user?.id
      if (uid){
        const { data: meRow } = await supabase.from('advisors').select('user_id,email,full_name,role,team_lead_user_id').eq('user_id', uid).maybeSingle()
        if (meRow) setMe(meRow as any)
      }
      const { data: adv } = await supabase.from('advisors').select('user_id,email,full_name,role,team_lead_user_id')
      setAdvisors((adv||[]) as any)
    } catch(e:any){ setErr(e.message||'Errore init') } finally { setLoading(false) }
  })() },[])

  const ownerIds = useMemo(()=>{
    if (!me) return [] as string[]
    if (me.role==='Junior') return [me.user_id]
    if (scope==='me') return [me.user_id]
    if (scope==='team') return advisors.filter(a=>a.team_lead_user_id===me.user_id || a.user_id===me.user_id).map(a=>a.user_id)
    return advisors.map(a=>a.user_id)
  }, [me, advisors, scope])

  // ricarica dati quando cambiano ownerIds o mese
  useEffect(()=>{ (async()=>{
    if (!ownerIds.length) return
    setLoading(true); setErr('')
    try{
      // range mese
      const [y,m] = month.split('-').map(Number)
      const start = new Date(y, m-1, 1).toISOString()
      const end = new Date(y, m, 1).toISOString() // esclusivo

      // leads nello scope
      const { data: lds } = await supabase.from('leads').select('id,owner_id,first_name,last_name,company_name').in('owner_id', ownerIds)
      setLeads((lds||[]) as any)

      // appuntamenti del mese
      const { data: rows } = await supabase
        .from('appointments')
        .select('id,lead_id,ts,mode,notes')
        .in('lead_id', (lds||[]).map(x=>x.id))
        .gte('ts', start).lt('ts', end)
        .order('ts', { ascending:true })

      const leadMap = new Map((lds||[]).map(x=>[x.id, x] as const))
      const parsed = (rows||[]).map(r=> ({ ...r, lead: leadMap.get(r.lead_id) })) as Appointment[]
      setAppts(parsed)
    } catch(e:any){ setErr(e.message||'Errore caricamento') } finally { setLoading(false) }
  })() }, [ownerIds.join(','), month])

  function labelLead(l: Lead|undefined){
    if (!l) return '(lead)'
    const n = [l.first_name||'', l.last_name||''].join(' ').trim()
    return n || l.company_name || '(lead)'
  }

  function labelAdvisor(ownerId?: string|null){
    if (!ownerId) return '—'
    const a = advisors.find(x=>x.user_id===ownerId)
    return a?.full_name || a?.email || '—'
  }

  // griglia mese
  const monthGrid = useMemo(()=>{
    const [y,m] = month.split('-').map(Number)
    const first = startOfMonth(new Date(y, m-1, 1))
    const last = endOfMonth(first)
    const startWeekDay = (first.getDay()+6)%7 // lun=0
    const daysInMonth = last.getDate()
    const cells: { date: Date, inMonth: boolean }[] = []

    // giorni del mese precedente per riempire la prima settimana
    for (let i=0;i<startWeekDay;i++){
      const d = new Date(first); d.setDate(first.getDate() - (startWeekDay - i))
      cells.push({ date:d, inMonth:false })
    }
    // giorni del mese corrente
    for (let d=1; d<=daysInMonth; d++) cells.push({ date: new Date(y, m-1, d), inMonth:true })
    // riempi fino a 42 celle
    while (cells.length<42){ const d = new Date(cells[cells.length-1].date); d.setDate(d.getDate()+1); cells.push({ date:d, inMonth:false }) }
    return cells
  }, [month])

  // editor helpers
  function openCreate(date: Date){
    const iso = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0, 0).toISOString().slice(0,16)
    setDraft({ id:'', lead_id: leads[0]?.id || '', ts: iso, mode:'inperson', notes:'' })
    setEditingId('new')
  }
  function openEdit(a: Appointment){
    setDraft({ id:a.id, lead_id:a.lead_id, ts: (a.ts||'').slice(0,16), mode:a.mode, notes:a.notes||'' })
    setEditingId(a.id)
  }
  function closeEditor(){ setEditingId(null); setDraft(emptyDraft) }

  async function saveDraft(){
    if (!draft.lead_id){ alert('Seleziona un lead'); return }
    if (!draft.ts){ alert('Imposta data/ora'); return }
    const payload = { lead_id:draft.lead_id, ts: new Date(draft.ts).toISOString(), mode:draft.mode, notes: draft.notes||null }
    if (editingId==='new'){
      const { error } = await supabase.from('appointments').insert(payload)
      if (error) return alert(error.message)
    } else if (editingId){
      const { error } = await supabase.from('appointments').update(payload).eq('id', editingId)
      if (error) return alert(error.message)
    }
    closeEditor()
    // refresh mese corrente
    const [y,m] = month.split('-').map(Number)
    const start = new Date(y, m-1, 1).toISOString()
    const end = new Date(y, m, 1).toISOString()
    const { data: lds } = await supabase.from('leads').select('id,owner_id,first_name,last_name,company_name').in('owner_id', ownerIds)
    const { data: rows } = await supabase
      .from('appointments').select('id,lead_id,ts,mode,notes')
      .in('lead_id', (lds||[]).map(x=>x.id))
      .gte('ts', start).lt('ts', end).order('ts',{ascending:true})
    const leadMap = new Map((lds||[]).map(x=>[x.id, x] as const))
    setAppts((rows||[]).map(r=> ({ ...r, lead: leadMap.get(r.lead_id) })) as Appointment[])
  }
  async function deleteAppt(id: string){
    const ok = confirm('Eliminare l\'appuntamento?')
    if (!ok) return
    const { error } = await supabase.from('appointments').delete().eq('id', id)
    if (error) return alert(error.message)
    setAppts(a=> a.filter(x=>x.id!==id))
  }

  // raggruppo appuntamenti per giorno (applico qui il filtro consulente)
  const apptsByDay = useMemo(()=>{
    const filtered = selectedAdvisor
      ? appts.filter(a => a.lead?.owner_id === selectedAdvisor)
      : appts

    const map = new Map<string, Appointment[]>()
    for (const a of filtered){
      const d = new Date(a.ts); const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      const arr = map.get(k) || []; arr.push(a); map.set(k, arr)
    }
    return map
  }, [appts, selectedAdvisor])

  const ApptCard: React.FC<{ a: Appointment }> = ({ a }) => (
    <div style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'8px 10px', background:'#f8fafc' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
        <div style={{ fontSize:12, fontWeight:700 }}>
          {new Date(a.ts).toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' })}
          {' · '}{MODE_OPTIONS.find(m=>m.db===a.mode)?.label}
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <button title="Modifica" onClick={()=>openEdit(a)} style={{ border:'none', background:'transparent', cursor:'pointer' }}>✏️</button>
          <button title="Elimina" onClick={()=>deleteAppt(a.id)} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
        </div>
      </div>
      <div style={{ fontSize:12, color:'#1d4ed8', marginTop:2 }}>{labelLead(a.lead)}</div>
      <div style={{ fontSize:11, color:'var(--muted,#666)', marginTop:2 }}>Assegnatario: {labelAdvisor(a.lead?.owner_id||null)}</div>
    </div>
  )

  function dayKey(d: Date){ return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }

  return (
    <div style={{ display:'grid', gap:16 }}>
      {/* Filtri */}
      <div style={{ display:'flex', gap:12, alignItems:'end', flexWrap:'wrap' }}>
        <div>
          <div style={label}>Ambito</div>
          <select value={scope} onChange={e=>setScope(e.target.value as any)} style={ipt}>
            <option value="me">Solo me</option>
            {(me?.role!=='Junior') && <option value="team">Il mio Team</option>}
            {(me?.role==='Admin') && <option value="all">Tutti</option>}
          </select>
        </div>
        <div>
          <div style={label}>Mese</div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button className="brand-btn" onClick={()=>setMonth(prev=>{ const [y,m]=prev.split('-').map(Number); return monthKey(addMonths(new Date(y,m-1,1),-1)) })}>{'‹'}</button>
            <input type="month" value={month} onChange={e=>{ const v=e.target.value; setMonth(v); const [y,m]=v.split('-').map(Number); setActiveDate(new Date(y,m-1,1)); }} style={ipt} />
            <button className="brand-btn" onClick={()=>setMonth(prev=>{ const [y,m]=prev.split('-').map(Number); return monthKey(addMonths(new Date(y,m-1,1),+1)) })}>{'›'}</button>
          </div>
        </div>
        <div>
          <div style={label}>Vista</div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="brand-btn" onClick={()=>setView('month')}>Mese</button>
            <button className="brand-btn" onClick={()=>setView('week')}>Settimana</button>
          </div>
        </div>
        <div>
          <div style={label}>Nuovo</div>
          <button className="brand-btn" onClick={()=>openCreate(new Date())}>+ Appuntamento</button>
        </div>
        {/* Filtro consulente */}
        <div>
          <div style={label}>Consulente</div>
          <select style={ipt} value={selectedAdvisor} onChange={e => setSelectedAdvisor(e.target.value)}>
            <option value="">— Scegli —</option>
            <optgroup label="Team Lead">
              {advisors.filter(a => a.role === 'Team Lead').map(a => (
                <option key={a.user_id} value={a.user_id}>{a.full_name || a.email}</option>
              ))}
            </optgroup>
            <optgroup label="Junior">
              {advisors.filter(a => a.role === 'Junior').map(a => (
                <option key={a.user_id} value={a.user_id}>{a.full_name || a.email}</option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>

      {/* Vista mensile */}
      {view === 'month' && (
        <div className="brand-card" style={{ ...box }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:8, fontSize:12, color:'var(--muted,#666)', marginBottom:8 }}>
            {['Lun','Mar','Mer','Gio','Ven','Sab','Dom'].map(d=> <div key={d} style={{ textAlign:'center' }}>{d}</div>)}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:8 }}>
            {monthGrid.map((cell, idx)=>{
              const items = apptsByDay.get(dayKey(cell.date)) || []
              const isToday = sameDay(cell.date, new Date())
              const preview = items.slice(0, MAX_PREVIEW)
              const hidden = Math.max(0, items.length - preview.length)
              return (
                <div key={idx} style={{ border:'1px solid var(--border,#eee)', borderRadius:12, padding:8, background: cell.inMonth? '#fff' : '#fafafa', display:'flex', flexDirection:'column', minHeight:120 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:isToday? '#0b57d0':'#111' }}>{cell.date.getDate()}</div>
                    <button title="Nuovo appuntamento" onClick={()=>openCreate(cell.date)} style={{ border:'none', background:'transparent', cursor:'pointer' }}>＋</button>
                  </div>
                  <div style={{ display:'grid', gap:6, overflow:'hidden' }}>
                    {preview.map(a => (<ApptCard key={a.id} a={a} />))}
                  </div>
                  {hidden>0 && (
                    <button onClick={()=>setOpenDayDate(cell.date)} style={{ marginTop:6, border:'none', background:'transparent', textAlign:'left', cursor:'pointer', fontSize:12, color:'#0b57d0' }}>
                      +{hidden} altri
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Vista settimanale */}
      {view === 'week' && (
        <div className="brand-card" style={{ ...box }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <button className="brand-btn" onClick={()=>setActiveDate(d => addDays(d, -7))}>{'‹'}</button>
              <div style={{ fontWeight:600 }}>
                {(() => { const s=startOfWeek(activeDate); const e=addDays(s,6); const fmt=(dt:Date)=>dt.toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit'}); return `${fmt(s)} – ${fmt(e)}` })()}
              </div>
              <button className="brand-btn" onClick={()=>setActiveDate(d => addDays(d, +7))}>{'›'}</button>
            </div>
            <div><button className="brand-btn" onClick={()=>setActiveDate(new Date())}>Oggi</button></div>
          </div>

          {(() => {
            const start = startOfWeek(activeDate)
            const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
            return (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:8, fontSize:12, color:'var(--muted,#666)', marginBottom:8 }}>
                  {['Lun','Mar','Mer','Gio','Ven','Sab','Dom'].map(d=> <div key={d} style={{ textAlign:'center' }}>{d}</div>)}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:8 }}>
                  {days.map((d, i) => {
                    const items = (apptsByDay.get(dayKey(d)) || []).slice().sort((a,b)=> +new Date(a.ts) - +new Date(b.ts))
                    const isToday = sameDay(d, new Date())
                    return (
                      <div key={i} style={{ border:'1px solid var(--border,#eee)', borderRadius:12, padding:8, background:'#fff', minHeight:220, display:'flex', flexDirection:'column' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                          <div style={{ fontSize:12, fontWeight:600, color: isToday ? '#0b57d0' : '#111' }}>{d.getDate()}/{d.getMonth()+1}</div>
                          <button title="Nuovo appuntamento" onClick={()=>openCreate(d)} style={{ border:'none', background:'transparent', cursor:'pointer' }}>＋</button>
                        </div>
                        <div style={{ display:'grid', gap:8 }}>
                          {items.length===0 && <div style={{ fontSize:12, color:'var(--muted,#666)' }}>Nessun appuntamento</div>}
                          {items.map(a => (<ApptCard key={a.id} a={a} />))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* Modal editor */}
      {editingId && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'grid', placeItems:'center', zIndex:50 }}>
          <div style={{ background:'#fff', borderRadius:12, padding:16, width:420 }}>
            <div style={{ fontWeight:700, marginBottom:12 }}>{editingId==='new' ? 'Nuovo appuntamento' : 'Modifica appuntamento'}</div>
            <div style={{ display:'grid', gap:12 }}>
              <div>
                <div style={label}>Lead</div>
                <select value={draft.lead_id} onChange={e=>setDraft(d=>({ ...d, lead_id:e.target.value }))} style={ipt}>
                  <option value="">— Seleziona —</option>
                  {leads.map(l=> <option key={l.id} value={l.id}>{labelLead(l)}</option>)}
                </select>
              </div>
              <div>
                <div style={label}>Data/Ora</div>
                <input type="datetime-local" value={draft.ts} onChange={e=>setDraft(d=>({ ...d, ts:e.target.value }))} style={ipt} />
              </div>
              <div>
                <div style={label}>Modalità</div>
                <select value={draft.mode} onChange={e=>{ const v = e.target.value as Mode; setDraft(d=>({ ...d, mode:v })) }} style={ipt}>
                  {MODE_OPTIONS.map(o=> <option key={o.db} value={o.db}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <div style={label}>Note</div>
                <input value={draft.notes||''} onChange={e=>setDraft(d=>({ ...d, notes:e.target.value }))} style={ipt} />
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
                <button className="brand-btn" onClick={closeEditor}>Annulla</button>
                <button className="brand-btn" onClick={saveDraft}>Salva</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Overlay "tutti gli appuntamenti del giorno" */}
      {openDayDate && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', display:'grid', placeItems:'center', zIndex:50 }}>
          <div style={{ background:'#fff', borderRadius:12, padding:16, width:520, maxHeight:'80vh', display:'flex', flexDirection:'column' }}>
            <div style={{ fontWeight:700, marginBottom:12 }}>
              Appuntamenti · {openDayDate.toLocaleDateString('it-IT', { weekday:'long', day:'2-digit', month:'2-digit', year:'numeric' })}
            </div>
            <div style={{ display:'grid', gap:8, overflow:'auto' }}>
              {(apptsByDay.get(dayKey(openDayDate)) || []).map(a => (<ApptCard key={a.id} a={a} />))}
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', marginTop:12 }}>
              <button className="brand-btn" onClick={()=>setOpenDayDate(null)}>Chiudi</button>
            </div>
          </div>
        </div>
      )}

      {err && <div style={{ padding:10, border:'1px solid #fca5a5', background:'#fee2e2', color:'#7f1d1d', borderRadius:8 }}>{err}</div>}
      {loading && <div>Caricamento…</div>}
    </div>
  )
}
