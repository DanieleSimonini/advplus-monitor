import React, { useState } from 'react'
import { supabase } from '../supabaseClient'

// Percorsi dei loghi (stessi usati in RootApp)
const GUIDEUP_LOGO = '/brand-guideup.png'
const APLUS_LOGO = '/brand-aplus.png'

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
      // RootApp ascolta onAuthStateChange e reindirizza all’app
      setOk('Accesso riuscito. Sto entrando…')
    }catch(ex:any){ setErr(ex.message || 'Login fallito') }
    finally{ setLoading(false) }
  }

  async function doMagicLink(){
    setErr(''); setOk(''); setLoading(true)
    try{
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options:{ emailRedirectTo: window.location.origin }
      })
      if (error) throw error
      setOk('Email inviata. Controlla la posta (anche spam) e apri il link.')
    }catch(ex:any){ setErr(ex.message || 'Invio link fallito') }
    finally{ setLoading(false) }
  }

  async function doForgot(){
    setErr(''); setOk(''); setLoading(true)
    try{
      // Dopo il click in email atterra su /reset per impostare la nuova password
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset`,
      })
      if (error) throw error
      setOk('Email inviata. Controlla la posta (anche spam) e apri il link per reimpostare la password.')
    }catch(ex:any){ setErr(ex.message || 'Invio reset fallito') }
    finally{ setLoading(false) }
  }

  return (
    <div style={{ minHeight:'100vh', background:'#f7f8fb', display:'grid', placeItems:'center', padding:'24px' }}>
      <div style={{ width:'min(920px, 92vw)' }}>
        {/* Header con i due loghi */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <img src={GUIDEUP_LOGO} alt="GuideUp" style={{ height:48, objectFit:'contain' }} />
          </div>
          <div>
            <img src={APLUS_LOGO} alt="AdvisoryPlus" style={{ height:40, objectFit:'contain' }} />
          </div>
        </div>

        {/* Card login */}
        <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:16, padding:24, display:'grid', gap:16 }}>
          <div style={{ fontSize:22, fontWeight:800, marginBottom:4 }}>Accedi</div>
          <form onSubmit={doSignIn} style={{ display:'grid', gap:10, maxWidth:420 }}>
            <label style={{ display:'grid', gap:6 }}>
              <span style={{ fontSize:12, color:'#555' }}>Email</span>
              <input type="email" required value={email} onChange={e=>setEmail(e.target.value)}
                style={{ padding:'10px 12px', border:'1px solid #ddd', borderRadius:8 }} />
            </label>
            <label style={{ display:'grid', gap:6 }}>
              <span style={{ fontSize:12, color:'#555' }}>Password</span>
              <input type="password" required value={password} onChange={e=>setPassword(e.target.value)}
                style={{ padding:'10px 12px', border:'1px solid #ddd', borderRadius:8 }} />
            </label>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <button type="submit" disabled={loading}
                style={{ padding:'10px 12px', borderRadius:8, border:'1px solid #0b57d0', background:'#0b57d0', color:'#fff', cursor:'pointer' }}>
                {loading ? 'Accesso…' : 'Entra'}
              </button>
              <button type="button" onClick={doMagicLink} disabled={loading || !email}
                style={{ padding:'10px 12px', borderRadius:8, border:'1px solid #ddd', background:'#fff', cursor:'pointer' }}>
                Link via email
              </button>
              <button type="button" onClick={doForgot} disabled={loading || !email}
                style={{ padding:'10px 12px', borderRadius:8, border:'1px solid #ddd', background:'#fff', cursor:'pointer' }}>
                Password dimenticata?
              </button>
            </div>
          </form>

          {err && <div style={{ color:'#c00' }}>{err}</div>}
          {ok && <div style={{ color:'#0a0' }}>{ok}</div>}
        </div>
      </div>
    </div>
  )
}
