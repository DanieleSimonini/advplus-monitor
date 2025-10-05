import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import DashboardPage from './pages/Dashboard'
import LeadsPage from './pages/Leads'
import GoalsTLPage from './pages/GoalsTL'
import LoginPage from './pages/Login'
// Pagine aggiuntive già lavorate
import AdminPage from './pages/Admin'
import ImportLeadsPage from './pages/ImportLeads'

// Placeholder per pagine opzionali (se non esistono ancora i file reali)
const CalendarPage: React.FC = () => <div style={{padding:16}}>Schermata <b>Calendar</b> in preparazione.</div>
const ReportPage: React.FC = () => <div style={{padding:16}}>Schermata <b>Report</b> in preparazione.</div>

/**
 * App.tsx — Navigazione a schede (senza React Router)
 * Tabs: Dashboard, Leads, Import, Goals TL, Report, Calendar, Admin
 * - Mostra i tab in base al ruolo (Admin/Team Lead/Junior)
 * - Gate di autenticazione → LoginPage se non autenticato
 */

type Role = 'Admin' | 'Team Lead' | 'Junior'

type Me = { id: string; user_id: string; email: string; full_name?: string | null; role: Role }

type Screen = 'dashboard' | 'leads' | 'import' | 'goals' | 'report' | 'calendar' | 'admin'

const navBtn: React.CSSProperties = { padding:'10px 12px', borderRadius:10, border:'1px solid #ddd', background:'#fff', cursor:'pointer' }
const navBtnActive: React.CSSProperties = { ...navBtn, borderColor:'#111', color:'#111', background:'#f6f6f6' }

export default function App(){
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sessionReady, setSessionReady] = useState(false)

  useEffect(()=>{ (async()=>{
    setError('')
    // 1) sessione
    const { data: sess } = await supabase.auth.getSession()
    if (!sess.session){ setSessionReady(true); setLoading(false); setMe(null); return }
    // 2) utente corrente → advisor
    const u = await supabase.auth.getUser()
    const email = u.data.user?.email
    if (!email){ setError('Utente non autenticato'); setLoading(false); setMe(null); return }
    const { data, error } = await supabase
      .from('advisors')
      .select('id,user_id,email,full_name,role')
      .eq('email', email)
      .maybeSingle()
    if (error || !data){ setError(error?.message || 'Advisor non trovato'); setLoading(false); setMe(null); return }
    setMe({ id:data.id, user_id:data.user_id, email:data.email, full_name:data.full_name, role:data.role as Role })
    setLoading(false); setSessionReady(true)
  })()
  // subscribe a cambiamenti auth
  const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, sess)=>{
    if (!sess){ setMe(null); setSessionReady(true); return }
    const email = sess.user.email
    if (!email){ setMe(null); setSessionReady(true); return }
    const { data, error } = await supabase
      .from('advisors')
      .select('id,user_id,email,full_name,role')
      .eq('email', email)
      .maybeSingle()
    if (!error && data){ setMe({ id:data.id, user_id:data.user_id, email:data.email, full_name:data.full_name, role:data.role as Role }) }
  })
  return ()=>{ sub.subscription.unsubscribe() }
  },[])

  // GATE: se non autenticato, mostra LoginPage
  if (sessionReady && !me){
    return <LoginPage />
  }

  const isAdmin = me?.role === 'Admin'
  const isTL = me?.role === 'Team Lead'
  const isJunior = me?.role === 'Junior'

  return (
    <div style={{ maxWidth:1200, margin:'0 auto', padding:16, display:'grid', gap:16 }}>
      {/* Header / Nav */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div style={{ fontWeight:800, fontSize:18 }}>Adv+ Monitor</div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button style={screen==='dashboard'?navBtnActive:navBtn} onClick={()=>setScreen('dashboard')}>Dashboard</button>
          <button style={screen==='leads'?navBtnActive:navBtn} onClick={()=>setScreen('leads')}>Leads</button>
          {(isAdmin || isTL) && (
            <button style={screen==='import'?navBtnActive:navBtn} onClick={()=>setScreen('import')}>Importa Leads</button>
          )}
          {(isAdmin || isTL) && (
            <button style={screen==='goals'?navBtnActive:navBtn} onClick={()=>setScreen('goals')}>Obiettivi TL</button>
          )}
          <button style={screen==='report'?navBtnActive:navBtn} onClick={()=>setScreen('report')}>Report</button>
          <button style={screen==='calendar'?navBtnActive:navBtn} onClick={()=>setScreen('calendar')}>Calendar</button>
          {isAdmin && (
            <button style={screen==='admin'?navBtnActive:navBtn} onClick={()=>setScreen('admin')}>Admin</button>
          )}
        </div>
        <div style={{ fontSize:12, color:'#666' }}>
          {loading ? 'Caricamento…' : me ? (me.full_name || me.email) : error || ''}
        </div>
      </div>

      {/* Contenuti */}
      {error && <div style={{ color:'#c00' }}>{error}</div>}
      {screen === 'dashboard' && <DashboardPage />}
      {screen === 'leads' && <LeadsPage />}
      {screen === 'import' && <ImportLeadsPage />}
      {screen === 'goals' && <GoalsTLPage />}
      {screen === 'report' && <ReportPage />}
      {screen === 'calendar' && <CalendarPage />}
      {screen === 'admin' && <AdminPage />}

      {!!me && (
        <div style={{ marginTop:8, textAlign:'right' }}>
          <button onClick={async()=>{ await supabase.auth.signOut(); window.location.reload() }} style={{ padding:'6px 10px', border:'1px solid #ddd', borderRadius:8, background:'#fff' }}>Esci</button>
        </div>
      )}
    </div>
  )
}
