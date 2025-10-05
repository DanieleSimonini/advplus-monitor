import React, { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function LoginPage(){
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [loading, setLoading] = useState(false)

  async function doSignIn(e:React.FormEvent){
    e.preventDefault()
    setErr(''); setOk(''); setLoading(true)
    try{
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      setOk('Accesso riuscito. Reindirizzo…')
      // RootApp ascolta onAuthStateChange e tornerà in dashboard; forziamo anche un refresh per sicurezza
      setTimeout(()=>{ window.location.href = '/' }, 300)
    }catch(ex:any){ setErr(ex.message || 'Login fallito') }
    finally{ setLoading(false) }
  }

  async function doMagicLink(){
    setErr(''); setOk(''); setLoading(true)
    try{
      const { error } = await supabase.auth.signInWithOtp({ email, options:{ emailRedirectTo: window.location.origin } })
      if (error) throw error
      setOk('Email inviata. Controlla la posta (anche spam) e apri il link.')
    }catch(ex:any){ setErr(ex.message || 'Invio link fallito') }
    finally{ setLoading(false) }
  }

  return (
    <div style={{ maxWidth:420, margin:'40px auto', padding:24, border:'1px solid #eee', borderRadius:16, background:'#fff' }}>
      <div style={{ fontSize:22, fontWeight:800, marginBottom:12 }}>Accedi a Adv+ Monitor</div>

      <form onSubmit={doSignIn} style={{ display:'grid', gap:10 }}>
        <label style={{ display:'grid', gap:6 }}>
          <span style={{ fontSize:12, color:'#555' }}>Email</span>
          <input type="email" required value={email} onChange={e=>setEmail(e.target.value)} style={{ padding:'10px 12px', border:'1px solid #ddd', borderRadius:8 }} />
        </label>
        <label style={{ display:'grid', gap:6 }}>
          <span style={{ fontSize:12, color:'#555' }}>Password</span>
          <input type="password" required value={password} onChange={e=>setPassword(e.target.value)} style={{ padding:'10px 12px', border:'1px solid #ddd', borderRadius:8 }} />
        </label>
        <button type="submit" disabled={loading} style={{ padding:'10px 12px', borderRadius:8, border:'1px solid #111', background:'#111', color:'#fff', cursor:'pointer' }}>
          {loading ? 'Accesso…' : 'Entra'}
        </button>
      </form>

      <div style={{ marginTop:12, display:'flex', gap:8, alignItems:'center' }}>
        <div style={{ height:1, background:'#eee', flex:1 }} />
        <div style={{ fontSize:12, color:'#999' }}>oppure</div>
        <div style={{ height:1, background:'#eee', flex:1 }} />
      </div>

      <div style={{ marginTop:12, display:'grid', gap:10 }}>
        <button onClick={doMagicLink} disabled={loading || !email} style={{ padding:'10px 12px', borderRadius:8, border:'1px solid #ddd', background:'#fff', cursor:'pointer' }}>Link via email</button>
      </div>

      {err && <div style={{ marginTop:12, color:'#c00' }}>{err}</div>}
      {ok && <div style={{ marginTop:12, color:'#0a0' }}>{ok}</div>}
    </div>
  )
}
