import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import DashboardPage from './pages/Dashboard'
import LeadsPage from './pages/Leads'
import GoalsTLPage from './pages/GoalsTL'
import LoginPage from './pages/Login'

// Proviamo a importare Admin/Import se esistono; altrimenti placeholder
let AdminPage: React.FC = () => <div style={{padding:16}}>Schermata <b>Admin</b> in preparazione.</div>
let ImportLeadsPage: React.FC = () => <div style={{padding:16}}>Schermata <b>Importa Leads</b> in preparazione.</div>
try { AdminPage = require('./pages/Admin').default } catch {}
try { ImportLeadsPage = require('./pages/ImportLeads').default } catch {}

// Placeholder opzionali
const CalendarPage: React.FC = () => <div style={{padding:16}}>Schermata <b>Calendar</b> in preparazione.</div>
const ReportPage: React.FC = () => <div style={{padding:16}}>Schermata <b>Report</b> in preparazione.</div>

// Stile bottoni nav
const navBtn: React.CSSProperties = { padding:'10px 12px', borderRadius:10, border:'1px solid #ddd', background:'#fff', cursor:'pointer' }
const navBtnActive: React.CSSProperties = { ...navBtn, borderColor:'#111', color:'#111', background:'#f6f6f6' }

// Logo inline
const LogoAPlus: React.FC = () => (
  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
    <div style={{ width:28, height:28, borderRadius:8, background:'#111', color:'#fff', display:'grid', placeItems:'center', fontWeight:800 }}>A+</div>
    <div style={{ fontWeight:800 }}>Adv+ Monitor</div>
  </div>
)

type Screen = 'dashboard'|'leads'|'import'|'goals'|'report'|'calendar'|'admin'|'login'
type Me = { id:string; user_id:string; email:string; full_name?:string|null; role:'Admin'|'Team Lead'|'Junior' }

export default function RootApp(){
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [me, setMe] = useState<Me|null>(null)
  const [loading, setLoading] = useState(true)

  // Bootstrap auth soft: non blocca il menu
  useEffect(()=>{ const sub = supabase.auth.onAuthStateChange(async (_evt, s)=>{
    if (!s){ setMe(null); setLoading(false); return }
    await loadMe(s.user.id)
  }); (async()=>{
    const { data:s } = await supabase.auth.getSession()
    if (s?.session) await loadMe(s.session.user.id)
    else setLoading(false)
  })(); return ()=>sub.data.subscription.unsubscribe() },[])

  async function loadMe(uid:string){
    setLoading(true)
    try{
      let { data, error } = await supabase
        .from('advisors')
        .select('id,user_id,email,full_name,role')
        .eq('user_id', uid).maybeSingle()
      if ((!data || error)){
        const u = await supabase.auth.getUser()
        const email = u.data.user?.email
        if (email){
          const r = await supabase
            .from('advisors')
            .select('id,user_id,email,full_name,role')
            .eq('email', email).maybeSingle()
          data = r.data as any
        }
      }
      if (data) setMe({ id:data.id, user_id:data.user_id, email:data.email, full_name:data.full_name, role:data.role })
      else setMe(null)
    } finally { setLoading(false) }
  }

  // Schermata Login dedicata
  if (screen==='login'){
    return <LoginPage />
  }

  return (
    <div style={{ maxWidth:1200, margin:'0 auto', padding:16, display:'grid', gap:16 }}>
      {/* ========== APP MARKER (deve apparire SEMPRE) ========== */}
      <div style={{ padding:8, border:'2px dashed #f00', borderRadius:8, background:'#fff0f0', textAlign:'center' }}>
        <b>APP MARKER</b> · RootApp.tsx v2
      </div>

      {/* Header / Nav */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <LogoAPlus />
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button style={screen==='dashboard'?navBtnActive:navBtn} onClick={()=>setScreen('dashboard')}>Dashboard</button>
          <button style={screen==='leads'?navBtnActive:navBtn} onClick={()=>setScreen('leads')}>Leads</button>
          <button style={screen==='import'?navBtnActive:navBtn} onClick={()=>setScreen('import')}>Importa Leads</button>
          <button style={screen==='goals'?navBtnActive:navBtn} onClick={()=>setScreen('goals')}>Obiettivi TL</button>
          <button style={screen==='report'?navBtnActive:navBtn} onClick={()=>setScreen('report')}>Report</button>
          <button style={screen==='calendar'?navBtnActive:navBtn} onClick={()=>setScreen('calendar')}>Calendar</button>
          <button style={screen==='admin'?navBtnActive:navBtn} onClick={()=>setScreen('admin')}>Admin</button>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {loading ? (
            <span style={{ fontSize:12, color:'#666' }}>Caricamento…</span>
          ) : me ? (
            <>
              <span style={{ fontSize:12, color:'#666' }}>{me.full_name || me.email} — {me.role}</span>
              <button onClick={async()=>{ await supabase.auth.signOut(); setMe(null); setScreen('login') }} style={{ padding:'6px 10px', border:'1px solid #ddd', borderRadius:8, background:'#fff' }}>Esci</button>
            </>
          ) : (
            <button onClick={()=>setScreen('login')} style={{ padding:'8px 12px', borderRadius:10, border:'1px solid #111', background:'#111', color:'#fff' }}>Accedi</button>
          )}
        </div>
      </div>

      {/* Contenuti */}
      {screen==='dashboard' && <DashboardPage />}
      {screen==='leads' && <LeadsPage />}
      {screen==='import' && <ImportLeadsPage />}
      {screen==='goals' && <GoalsTLPage />}
      {screen==='report' && <ReportPage />}
      {screen==='calendar' && <CalendarPage />}
      {screen==='admin' && <AdminPage />}
    </div>
  )
}
