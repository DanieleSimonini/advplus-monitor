import React, { useState } from 'react'
import { supabase } from '../supabaseClient'

// usa gli stessi path di RootApp
const GUIDEUP_LOGO = '/guideup-logo.png'
const APLUS_LOGO   = '/advisoryplus-logo.svg'

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
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset`,
      })
      if (error) throw error
      setOk('Email inviata. Apri il link per reimpostare la password.')
    }catch(ex:any){ setErr(ex.message || 'Invio reset fallito') }
    finally{ setLoading(false) }
  }

  return (
    <div style={{ minHeight:'100vh', background:'#f7f8fb', display:'grid', placeItems:'center', padding:'24px' }}>
      <div style={{ width:'min(920px, 92vw)', display:'grid', gap:20 }}>
        {/* Header loghi */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', alignItems:'center' }}>
          <div style={{ justifySelf:'start' }}>
            <img src={GUIDEUP_LOGO} alt="GuideUp" style={{ height:56, width:'auto', display:'block', objectFit:'contain' }} />
          </div>
          <div style={{ justifySelf:'end' }}>
            <img src={APLUS_LOGO} alt="AdvisoryPlus" style={{ height:48, width:'auto', display:'block', objectFit:'contain' }} />
          </div>
        </div>

        {/* Card login centrata */}
        <div style={{ background:'#fff', border:'1px solid #eee', borderRadius:16, padding:28 }}>
          <div style={{ display:'grid', gap:16, justifyItems:'center' }}>
            <h1 style={{ margin:0, fontSize:26 }}>Accedi</h1>

            <form onSubmit={doSignIn} style={{ display:'grid', gap:12, width:'min(520px, 92vw)' }}>
              <label style={{ display:'grid', gap:6 }}>
                <span style={{ fontSize:12, color:'#555' }}>Email</span>
                <input
                  type="email" required value={email} onChange={e=>setEmail(e.target.value)}
                  style={{ padding:'12px', border:'1px solid #ddd', borderRadius:10 }}
                />
              </label>

              <label style={{ display:'grid', gap:6 }}>
                <span style={{ fontSize:12, color:'#555' }}>Password</span>
                <input
                  type="password" required value={password} onChange={e=>setPassword(e.target.value)}
                  style={{ padding:'12px', border:'1px solid #ddd', borderRadius:10 }}
                />
              </label>

              <div style={{ display:'flex', gap:10, justifyContent:'center', marginTop:6, flexWrap:'wrap' }}>
                <button type="submit" disabled={loading}
                  style={{ padding:'10px 14px', borderRadius:10, border:'1px solid #0b57d0', background:'#0b57d0', color:'#fff', minWidth:110 }}>
                  {loading ? 'Accesso…' : 'Entra'}
                </button>
                <button type="button" onClick={doMagicLink} disabled={loading || !email}
                  style={{ padding:'10px 14px', borderRadius:10, border:'1px solid #ddd', background:'#fff', minWidth:150 }}>
                  Link via email
                </button>
                <button type="button" onClick={doForgot} disabled={loading || !email}
                  style={{ padding:'10px 14px', borderRadius:10, border:'1px solid #ddd', background:'#fff', minWidth:190 }}>
                  Password dimenticata?
                </button>
              </div>
            </form>

            {err && <div style={{ color:'#c00' }}>{err}</div>}
            {ok && <div style={{ color:'#0a0' }}>{ok}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
