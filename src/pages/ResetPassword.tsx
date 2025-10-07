import React, { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

export default function ResetPasswordPage(){
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [canReset, setCanReset] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(()=>{ (async()=>{
    // Se il link è valido, Supabase crea una sessione temporanea di recovery
    const { data } = await supabase.auth.getSession()
    setCanReset(!!data.session)
    setLoading(false)
  })() },[])

  async function onSave(e:React.FormEvent){
    e.preventDefault()
    setErr(''); setOk('')
    if (pwd.length < 8) return setErr('La password deve avere almeno 8 caratteri.')
    if (pwd !== pwd2) return setErr('Le password non coincidono.')
    try{
      const { error } = await supabase.auth.updateUser({ password: pwd })
      if (error) throw error
      setOk('Password aggiornata. Ora puoi accedere.')
      // opzionale: signOut e redirect a /login
      setTimeout(async()=>{
        await supabase.auth.signOut()
        window.location.href = '/login'
      }, 1200)
    }catch(ex:any){ setErr(ex.message || 'Aggiornamento password fallito') }
  }

  if (loading) return <div style={{ padding:24 }}>Caricamento…</div>

  if (!canReset){
    return (
      <div style={{ maxWidth:480, margin:'40px auto', padding:24, border:'1px solid #eee', borderRadius:16, background:'#fff' }}>
        Link non valido o scaduto. Torna al <a href="/login">login</a> e richiedi un nuovo reset.
      </div>
    )
  }

  return (
    <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:'#f7f8fb', padding:24 }}>
      <div style={{ maxWidth:480, width:'min(92vw, 480px)', background:'#fff', border:'1px solid #eee', borderRadius:16, padding:24 }}>
        <div style={{ fontSize:20, fontWeight:800, marginBottom:12 }}>Imposta nuova password</div>
        <form onSubmit={onSave} style={{ display:'grid', gap:10 }}>
          <label style={{ display:'grid', gap:6 }}>
            <span style={{ fontSize:12, color:'#555' }}>Nuova password</span>
            <input type="password" value={pwd} onChange={e=>setPwd(e.target.value)}
              style={{ padding:'10px 12px', border:'1px solid #ddd', borderRadius:8 }} />
          </label>
          <label style={{ display:'grid', gap:6 }}>
            <span style={{ fontSize:12, color:'#555' }}>Conferma password</span>
            <input type="password" value={pwd2} onChange={e=>setPwd2(e.target.value)}
              style={{ padding:'10px 12px', border:'1px solid #ddd', borderRadius:8 }} />
          </label>
          <button type="submit" style={{ padding:'10px 12px', borderRadius:8, border:'1px solid #0b57d0', background:'#0b57d0', color:'#fff' }}>
            Salva
          </button>
        </form>
        {err && <div style={{ color:'#c00', marginTop:8 }}>{err}</div>}
        {ok && <div style={{ color:'#0a0', marginTop:8 }}>{ok}</div>}
      </div>
    </div>
  )
}
