import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import DashboardPage from './pages/Dashboard'
import LeadsPage from './pages/Leads'
import GoalsTLPage from './pages/GoalsTL'
import LoginPage from './pages/Login'

/**
 * App.tsx — Navigazione a schede (senza React Router)
 * Aggiunge la scheda "Obiettivi TL" come richiesto (Opzione A).
 * Mostra il tab solo ad Admin/Team Lead (i Junior non lo vedono). La pagina GoalsTL blocca comunque l'accesso lato UI e RLS.
 */

type Role = 'Admin' | 'Team Lead' | 'Junior'

type Me = { id: string; user_id: string; email: string; full_name?: string | null; role: Role }

type Screen = 'dashboard' | 'leads' | 'goals'

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
    // 2) utente corrente -> advisor
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

  return (
    <div style={{ maxWidth:1200, margin:'0 auto', padding:16, display:'grid', gap:16 }}>
      {/* Header / Nav */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div style={{ fontWeight:800, fontSize:18 }}>Adv+ Monitor</div>
{/* NAV: SMOKE v1 — forzato sempre visibile */}
<div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
  {/* MARKER: se vedi [APP MARKER], stai usando proprio questo App.tsx */}
  <div style={{ padding:'4px 8px', border:'2px dashed #f00', borderRadius:8, background:'#fff0f0' }}>
    <b>APP MARKER</b>
  </div>

  <button style={screen==='dashboard'?navBtnActive:navBtn} onClick={()=>setScreen('dashboard')}>Dashboard</button>
  <button style={screen==='leads'?navBtnActive:navBtn} onClick={()=>setScreen('leads')}>Leads</button>
  <button style={screen==='import'?navBtnActive:navBtn} onClick={()=>setScreen('import')}>Importa Leads</button>
  <button style={screen==='goals'?navBtnActive:navBtn} onClick={()=>setScreen('goals')}>Obiettivi TL</button>
  <button style={screen==='report'?navBtnActive:navBtn} onClick={()=>setScreen('report')}>Report</button>
  <button style={screen==='calendar'?navBtnActive:navBtn} onClick={()=>setScreen('calendar')}>Calendar</button>
  <button style={screen==='admin'?navBtnActive:navBtn} onClick={()=>setScreen('admin')}>Admin</button>
</div>
        
        </div>
        <div style={{ fontSize:12, color:'#666' }}>
          {loading ? 'Caricamento…' : me ? (me.full_name || me.email) : error || ''}
        </div>
      </div>

      {/* Contenuti */}
      {error && <div style={{ color:'#c00' }}>{error}</div>}
      {screen === 'dashboard' && <DashboardPage />}
      {screen === 'leads' && <LeadsPage />}
      {screen === 'goals' && <GoalsTLPage />}
    </div>
  )
}
