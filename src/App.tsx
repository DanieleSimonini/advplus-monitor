import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import Dashboard from './pages/Dashboard'
import AdminUsers from './pages/AdminUsers'
import AcceptInvite from './pages/AcceptInvite'
import ImportLeads from './pages/ImportLeads'

type User = {
  email: string
}

function Nav({ current, set }: { current: string; set: (s: string) => void }) {
  const btn = (id: string, label: string) => (
    <button
      onClick={() => set(id)}
      style={{
        padding: '8px 12px',
        borderRadius: 10,
        border: current === id ? '1px solid #111' : '1px solid #ddd',
        background: current === id ? '#111' : '#fff',
        color: current === id ? '#fff' : '#111',
        cursor: 'pointer'
      }}
    >
      {label}
    </button>
  )
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {btn('dashboard', 'Dashboard')}
      {btn('leads', 'Leads')}
      {btn('calendar', 'Calendario')}
      {btn('reports', 'Report')}
      {btn('goals', 'Obiettivi')}
      {btn('import', 'Import')}
      {btn('admin', 'Admin')}
    </div>
  )
}

function LoginView({ onLogged }: { onLogged: (u: User) => void }) {
  const [email, setEmail] = useState('admin1@advisoryplus.it')
  const [password, setPassword] = useState('')

  const login = async (e: React.FormEvent) => {
    e.preventDefault()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      alert('Login fallito: ' + error.message)
      return
    }
    onLogged({ email: data.user?.email || email })
  }

  return (
    <div style={{ maxWidth: 360, margin: '10vh auto', background: '#fff', padding: 24, borderRadius: 16, border: '1px solid #eee' }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Adv+ Monitor</div>
      <div style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>Accedi con l’utente Admin creato in Supabase</div>
      <form onSubmit={login} style={{ display: 'grid', gap: 10 }}>
        <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={ipt} />
        <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} style={ipt} />
        <button type="submit" style={cta}>Entra</button>
      </form>
    </div>
  )
}

const ipt: React.CSSProperties = { padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd' }
const cta: React.CSSProperties = { padding: '10px 12px', borderRadius: 10, border: '1px solid #111', background: '#111', color: '#fff', cursor: 'pointer' }

export default function App() {
  const [page, setPage] = useState('dashboard')
  const [user, setUser] = useState<User | null>(null)

  const [inviteMode, setInviteMode] = useState(false)
useEffect(() => {
  const h = window.location.hash.toLowerCase()
  const q = window.location.search.toLowerCase()
  if (h.includes('type=invite') || h.includes('type=recovery') || q.includes('type=invite') || q.includes('type=recovery')) {
    setInviteMode(true)
  }
}, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setUser({ email: data.user.email })
    })
  }, [])

  const logout = async () => {
    await supabase.auth.signOut()
    setUser(null)
  }

  // Se è un link di invito o recovery, mostra la pagina di set password
if (inviteMode) {
  return <AcceptInvite onDone={()=>{ setInviteMode(false); window.location.replace(window.location.origin) }} />
}

  if (!user) return <LoginView onLogged={setUser} />

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#111', color: '#fff', fontWeight: 800, display: 'grid', placeItems: 'center' }}>A+</div>
          <div>
            <div style={{ fontWeight: 800 }}>Adv+ Monitor</div>
            <div style={{ fontSize: 12, color: '#666' }}>Logged as {user.email}</div>
          </div>
        </div>
        <Nav current={page} set={setPage} />
        <button onClick={logout} style={{ ...cta, background: '#fff', color: '#111' }}>Logout</button>
      </div>

      <div>
        {page === 'dashboard' && <Dashboard />}
        {page === 'leads' && <Placeholder title="Leads" />}
        {page === 'calendar' && <Placeholder title="Calendario" />}
        {page === 'reports' && <Placeholder title="Report" />}
        {page === 'goals' && <Placeholder title="Obiettivi" />}
        {page === 'import' && <ImportLeads />}
        {page === 'admin' && <AdminUsers />}
      </div>
    </div>
  )
}

function Placeholder({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 16, padding: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: '#666' }}>{subtitle || 'Schermata in preparazione (collegheremo i dati Supabase qui).'}</div>
    </div>
  )
}
