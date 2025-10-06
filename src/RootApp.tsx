import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

import DashboardPage from './pages/Dashboard'
import LeadsPage from './pages/Leads'
import GoalsTLPage from './pages/GoalsTL'
import LoginPage from './pages/Login'
import AdminPage from './pages/AdminUsers'
import ImportLeadsPage from './pages/ImportLeads'
import ReportPage from './pages/Report'
import BrandTheme from './theme/BrandTheme'

// Placeholder opzionali
const CalendarPage: React.FC = () => <div style={{padding:16}}>Schermata <b>Calendar</b> in preparazione.</div>

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
useEffect(() => {
  let unsub: { unsubscribe: () => void } | null = null

  ;(async () => {
    // 1) Prova a leggere la sessione già persistita
    const { data: s } = await supabase.auth.getSession()
    if (s?.session) {
      await loadMe(s.session.user.id)
    } else {
      // 1a) Se il token è in localStorage ma getSession è momentaneamente vuoto, forziamo il refresh
      try {
        const storageKey = (supabase as any)?.auth?.storageKey || 'advplus-auth'
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null
        if (raw) {
          await supabase.auth.refreshSession()
          const { data: s2 } = await supabase.auth.getSession()
          if (s2?.session) {
            await loadMe(s2.session.user.id)
          } else {
            setLoading(false)
          }
        } else {
          setLoading(false)
        }
      } catch {
        setLoading(false)
      }
    }

    // 2) Sottoscrizione agli eventi di auth (login/logout/refresh)
    const sub = supabase.auth.onAuthStateChange(async (_evt, session) => {
      if (!session) { setMe(null); setLoading(false); return }
      await loadMe(session.user.id)
    })
    unsub = sub.data.subscription
  })()

  return () => { if (unsub) unsub.unsubscribe() }
}, [])


 async function loadMe(uid: string){
  setLoading(true)
  try{
    // 1) prova per user_id
    let { data, error } = await supabase
      .from('advisors')
      .select('id,user_id,email,full_name,role')
      .eq('user_id', uid)
      .maybeSingle()

    // 2) fallback per email
    if ((!data || error)) {
      const u = await supabase.auth.getUser()
      const email = u.data.user?.email
      if (email){
        const r = await supabase
          .from('advisors')
          .select('id,user_id,email,full_name,role')
          .eq('email', email)
          .maybeSingle()
        data = r.data as any

        // 🔗 auto-link: se trovato per email ma manca user_id, collegalo a questo uid
        if (data && !data.user_id){
          await supabase.from('advisors').update({ user_id: uid }).eq('id', data.id)
          data.user_id = uid
        }
      }
    }

    // 3) set stato utente
    if (data) {
      setMe({ id: data.id, user_id: data.user_id, email: data.email, full_name: data.full_name, role: data.role })
    } else {
      setMe(null)
    }
  } finally {
    setLoading(false)
  }
}

  // Se sono su login e la sessione è attiva → torna in dashboard automaticamente
  useEffect(()=>{
    if (screen==='login' && me){ setScreen('dashboard') }
  }, [screen, me])

  // Schermata Login dedicata
  if (screen==='login' && !me){
    return <LoginPage />
  }

const NAV_BLUE = '#0029ae'       // fallback se CSS vars mancanti
const NAV_BORDER = '#e5e7eb'
const NAV_TEXT = '#111'

const navBtn: React.CSSProperties = {
  padding:'6px 10px',
  border:'1px solid var(--border, '+NAV_BORDER+')',
  borderRadius:8,
  background:'#fff',
  color:'var(--text, '+NAV_TEXT+')',
}

const navBtnActive: React.CSSProperties = {
  ...navBtn,
  background:'var(--brand-primary-600, '+NAV_BLUE+')',
  borderColor:'var(--brand-primary-600, '+NAV_BLUE+')',
  color:'#fff',
}


  return (
    <div style={{ maxWidth:1200, margin:'0 auto', padding:16, display:'grid', gap:16 }}>

<BrandTheme />

{/* Header / Nav */}
<div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:16, flexWrap:'wrap', padding:'6px 0' }}>
  {/* Logo sinistra: GuideUp */}
  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
    <img
      src="/guideup-logo.png"
      alt="GuideUp"
      style={{ height:36, width:'auto', display:'block' }}
    />
  </div>

  {/* Nav centrale */}
  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
    <button style={screen==='dashboard'?navBtnActive:navBtn} onClick={()=>setScreen('dashboard')}>Dashboard</button>
    <button style={screen==='leads'?navBtnActive:navBtn} onClick={()=>setScreen('leads')}>Leads</button>
    <button style={screen==='import'?navBtnActive:navBtn} onClick={()=>setScreen('import')}>Importa Leads</button>
    <button style={screen==='goals'?navBtnActive:navBtn} onClick={()=>setScreen('goals')}>Obiettivi TL</button>
    <button style={screen==='report'?navBtnActive:navBtn} onClick={()=>setScreen('report')}>Report</button>
    <button style={screen==='calendar'?navBtnActive:navBtn} onClick={()=>setScreen('calendar')}>Calendar</button>
    <button style={screen==='admin'?navBtnActive:navBtn} onClick={()=>setScreen('admin')}>Admin</button>
  </div>

  {/* Destra: logo Advisory+ + auth */}
  <div style={{ display:'flex', gap:12, alignItems:'center' }}>
    <img
      src="/advisoryplus-logo.svg"
      alt="AdvisoryPlus"
      style={{ height:28, width:'auto', display:'block' }}
    />
    {loading ? (
      <span style={{ fontSize:12, color:'#666' }}>Caricamento…</span>
    ) : me ? (
      <>
        <span style={{ fontSize:12, color:'#666' }}>{me.full_name || me.email} — {me.role}</span>
        <button
          onClick={async()=>{ await supabase.auth.signOut(); setMe(null); setScreen('login') }}
          style={{ padding:'6px 10px', border:'1px solid #ddd', borderRadius:8, background:'#fff' }}
        >
          Esci
        </button>
      </>
    ) : (
      <button
        onClick={()=>setScreen('login')}
        style={{ padding:'8px 12px', borderRadius:10, border:'1px solid #111', background:'#111', color:'#fff' }}
      >
        Accedi
      </button>
    )}
  </div>
</div>

    {/* Auth */}
    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
      {loading ? (
        <span style={{ fontSize:12, color:'var(--muted)' }}>Caricamento…</span>
      ) : me ? (
        <>
          <span style={{ fontSize:12, color:'var(--muted)' }}>
            {me.full_name || me.email} — {me.role}
          </span>
          <button
            onClick={async()=>{ await supabase.auth.signOut(); setMe(null); setScreen('login') }}
            className="brand-btn"
          >
            Esci
          </button>
        </>
      ) : (
        <button
          onClick={()=>setScreen('login')}
          className="brand-btn primary"
        >
          Accedi
        </button>
      )}
    </div>
  </div>
</header>


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
