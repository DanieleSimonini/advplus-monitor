import React, { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function LoginPage(){
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  const signin = async ()=>{
    setError(''); setInfo(''); setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  const magic = async ()=>{
    setError(''); setInfo(''); setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({ email, options:{ emailRedirectTo: window.location.origin } })
    if (error) setError(error.message); else setInfo('Email inviata. Controlla anche la SPAM.')
    setLoading(false)
  }

  return (
    <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:'#f7f7f8' }}>
      <div style={{ width:360, background:'#fff', border:'1px solid #eee', borderRadius:16, padding:16 }}>
        <div style={{ fontWeight:800, fontSize:18, marginBottom:12 }}>Adv+ Monitor — Login</div>
        <div style={{ display:'grid', gap:12 }}>
          <div>
            <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Email</div>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} style={{ width:'100%', padding:'10px 12px', border:'1px solid #ddd', borderRadius:10 }} />
          </div>
          <div>
            <div style={{ fontSize:12, color:'#666', marginBottom:4 }}>Password</div>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} style={{ width:'100%', padding:'10px 12px', border:'1px solid #ddd', borderRadius:10 }} />
          </div>
          <button onClick={signin} disabled={loading} style={{ padding:'10px 12px', borderRadius:10, background:'#111', color:'#fff', border:'1px solid #111', cursor:'pointer' }}>
            {loading ? 'Accesso…' : 'Accedi'}
          </button>
          <button onClick={magic} disabled={loading || !email} style={{ padding:'10px 12px', borderRadius:10, background:'#fff', color:'#111', border:'1px solid #ddd', cursor:'pointer' }}>
            Link via email
          </button>
          {error && <div style={{ color:'#c00', fontSize:12 }}>{error}</div>}
          {info && <div style={{ color:'#090', fontSize:12 }}>{info}</div>}
        </div>
      </div>
    </div>
  )
}
