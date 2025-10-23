import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

import DashboardPage from './pages/Dashboard'
import LeadsPage from './pages/Leads'
import GoalsTLPage from './pages/GoalsTL'
import AdminPage from './pages/AdminUsers'
import ImportLeadsPage from './pages/ImportLeads'
import ReportPage from './pages/Report'
import BrandTheme from './theme/BrandTheme'
import Calendar from './pages/Calendar'
import LoginPage from './pages/Login'
import ResetPasswordPage from './pages/ResetPassword'

// Percorsi logo (serviti da /public)
const GUIDEUP_LOGO = '/guideup-logo.png';
const APLUS_LOGO   = '/advisoryplus-logo.svg';

type Screen = 'dashboard'|'leads'|'import'|'goals'|'report'|'calendar'|'admin'|'login'
type Me = { id:string; user_id:string; email:string; full_name?:string|null; role:'Admin'|'Team Lead'|'Junior' }

export default function RootApp(){
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [me, setMe] = useState<Me|null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(()=>{ document.title = 'GuideUp' },[])

  // Bootstrap auth (persistenza sessione + onAuthStateChange)
  useEffect(() => {
    let unsub: { unsubscribe: () => void } | null = null
    const onFocus = async () => {
      try{
        // Quando la scheda torna in focus prova a ristabilire la sessione senza disturbare la UI
        const { data: s } = await supabase.auth.getSession()
        if (!s?.session) {
          const { data: r } = await supabase.auth.refreshSession()
          if (r?.session) {
            await loadMe(r.session.user.id, { silent: true })
          }
        }
      } catch {}
    }

    ;(async () => {
      const { data: s } = await supabase.auth.getSession()
      if (s?.session) {
        await loadMe(s.session.user.id) // iniziale: mostra loading
      } else {
        // tentativo di refresh anche senza affidarsi a localStorage
        try {
          // 1) se c'è storageKey locale prova un refresh "soft"
          const storageKey = (supabase as any)?.auth?.storageKey || 'advplus-auth'
          const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null
          if (raw) {
            await supabase.auth.refreshSession()
            const { data: s2 } = await supabase.auth.getSession()
            if (s2?.session) {
              await loadMe(s2.session.user.id)
            } else {
              // 2) ultimo tentativo: scambia eventuali token residui nell'URL
              try { await supabase.auth.exchangeCodeForSession(window.location.href) } catch {}
              const { data: s3 } = await supabase.auth.getSession()
              if (s3?.session) await loadMe(s3.session.user.id)
              else setLoading(false)
            }
          } else {
            // Nessuna traccia locale: prova comunque refresh + exchange
            const { data: r } = await supabase.auth.refreshSession()
            if (r?.session) await loadMe(r.session.user.id)
            else {
              try { await supabase.auth.exchangeCodeForSession(window.location.href) } catch {}
              const { data: s4 } = await supabase.auth.getSession()
              if (s4?.session) await loadMe(s4.session.user.id)
              else setLoading(false)
            }
          }
        } catch {
          setLoading(false)
        }
      }

      // ⬇️ Patch: non rimettiamo loading durante i refresh del token
      const sub = supabase.auth.onAuthStateChange(async (evt, session) => {
        if (!session) { setMe(null); setLoading(false); return }

        // refresh periodico del token: non toccare la UI
        if (evt === 'TOKEN_REFRESHED') return

        // altri eventi rilevanti (login, update profilo): ricarica anagrafica
        await loadMe(session.user.id, { silent: false })
      })
      unsub = sub.data.subscription

      // ascolta focus della finestra per rinfrescare la sessione in background
      if (typeof window !== 'undefined') {
        window.addEventListener('focus', onFocus)
      }
    })()

    return () => { 
      if (unsub) unsub.unsubscribe()
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus)
      }
    }
  }, [])

  // ⬇️ Patch: possibilità di caricare in modo “silenzioso” (senza mostrare Caricamento…)
  async function loadMe(uid: string, opts?: { silent?: boolean }){
    const silent = !!opts?.silent
    if (!silent) setLoading(true)
    try{
      // 1) prova per user_id
      let { data, error } = await supabase
        .from('advisors')
        .select('id,user_id,email,full_name,role')
        .eq('user_id', uid)
        .maybeSingle()

      // 2) fallback per email (auto-collega user_id se manca)
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

          if (data && !data.user_id){
            await supabase.from('advisors').update({ user_id: uid }).eq('id', data.id)
            data.user_id = uid
          }
        }
      }

      if (data) setMe({ id: data.id, user_id: data.user_id, email: data.email, full_name: data.full_name, role: data.role })
      else setMe(null)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  // ====== RENDER ======
  const wantsReset = typeof window !== 'undefined' && window.location.pathname === '/reset'
  if (wantsReset) {
    return <ResetPasswordPage />
  }

  // Gate d'accesso: se non autenticato mostriamo Login (con loghi)
  if (!loading && !me) {
    return <LoginPage />
  }

  const NAV_BLUE = '#0029ae'
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
      <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gridTemplateRows:'auto auto', rowGap:6, alignItems:'center', padding:'6px 0' }}>
        {/* Logo GuideUp (sx) */}
        <div style={{ gridColumn:'1 / 2', gridRow:'1 / 2', display:'flex', alignItems:'center', gap:10 }}>
          <img src={GUIDEUP_LOGO} alt="GuideUp" style={{ height:54, width:'auto', display:'block' }} />
        </div>

        {/* Logo Advisory+ (dx) */}
        <div style={{ gridColumn:'2 / 3', gridRow:'1 / 2', display:'flex', alignItems:'center', gap:10, justifyContent:'flex-end' }}>
          <img src={APLUS_LOGO} alt="AdvisoryPlus" style={{ height:48, width:'auto', display:'block' }} />
        </div>

        {/* Menu centrale */}
        <div style={{ gridColumn:'1 / 3', gridRow:'2 / 3', display:'flex', gap:8, flexWrap:'wrap', justifyContent:'center' }}>
          <button style={screen==='dashboard'?navBtnActive:navBtn} onClick={()=>setScreen('dashboard')}>Dashboard</button>
          <button style={screen==='leads'?navBtnActive:navBtn} onClick={()=>setScreen('leads')}>Leads</button>
          <button style={screen==='import'?navBtnActive:navBtn} onClick={()=>setScreen('import')}>Importa Leads</button>
          <button style={screen==='goals'?navBtnActive:navBtn} onClick={()=>setScreen('goals')}>Obiettivi</button>
          <button style={screen==='report'?navBtnActive:navBtn} onClick={()=>setScreen('report')}>Report</button>
          <button style={screen==='calendar'?navBtnActive:navBtn} onClick={()=>setScreen('calendar')}>Calendar</button>
          <button style={screen==='admin'?navBtnActive:navBtn} onClick={()=>setScreen('admin')}>Admin</button>
        </div>

        {/* Pannello utente */}
        <div style={{ gridColumn:'2 / 3', gridRow:'3 / 4', display:'flex', gap:10, alignItems:'center', justifyContent:'flex-end' }}>
          {loading ? (
            <span style={{ fontSize:12, color:'#666' }}>Caricamento…</span>
          ) : me ? (
            <>
              <div style={{ textAlign:'right', lineHeight:1.2 }}>
                <div style={{ fontSize:12, color:'#111' }}>{me.full_name || me.email}</div>
                <div style={{ fontSize:11, color:'#666' }}>{me.role}</div>
              </div>
              <button onClick={async()=>{ await supabase.auth.signOut(); setMe(null); setScreen('login') }}
                style={{ padding:'6px 10px', border:'1px solid #ddd', borderRadius:8, background:'#fff' }}>
                Esci
              </button>
            </>
          ) : (
            <button onClick={()=>setScreen('login')}
              style={{ padding:'8px 12px', borderRadius:10, border:'1px solid #111', background:'#111', color:'#fff' }}>
              Accedi
            </button>
          )}
        </div>
      </div>

      {/* Contenuti */}
      {screen==='dashboard' && <DashboardPage />}
      {screen==='leads' && <LeadsPage />}
      {screen==='import' && <ImportLeadsPage />}
      {screen==='goals' && <GoalsTLPage />}
      {screen==='report' && <ReportPage />}
      {screen==='calendar' && <Calendar />}
      {screen==='admin' && <AdminPage />}
    </div>
  )
}
