import React, { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const box: React.CSSProperties = { background:'#fff', border:'1px solid #eee', borderRadius:16, padding:16, maxWidth:420, margin:'8vh auto' }
const ipt: React.CSSProperties = { padding:'10px 12px', borderRadius:10, border:'1px solid #ddd', width:'100%' }
const cta: React.CSSProperties = { padding:'10px 12px', borderRadius:10, border:'1px solid #111', background:'#111', color:'#fff', cursor:'pointer', width:'100%' }

function hasInviteOrRecoveryInUrl() {
  // Supabase mette info in hash o query; copriamo entrambi
  const h = window.location.hash.toLowerCase()
  const q = window.location.search.toLowerCase()
  return h.includes('type=invite') || h.includes('type=recovery') || q.includes('type=invite') || q.includes('type=recovery')
}

export default function AcceptInvite({ onDone }: { onDone: ()=>void }) {
  const [email, setEmail] = useState<string>('')
  const [pwd1, setPwd1] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [info, setInfo] = useState<string>('Verifica invito in corso…')
  const [error, setError] = useState<string>('')

  useEffect(() => {
    (async () => {
      // Se l’utente è già autenticato via magic link, getUser() lo vede
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.email) {
        setEmail(user.email)
        setInfo(`Invito per ${user.email}. Imposta una password per completare l’attivazione.`)
      } else {
        if (!hasInviteOrRecoveryInUrl()) {
          setInfo('Nessun invito valido trovato. Controlla il link ricevuto via email.')
        } else {
          // In molti casi Supabase crea già la sessione. Se non la vedi, l’utente deve cliccare di nuovo il link.
          setInfo('Token invito rilevato. Se non vedi la tua email qui sotto, riapri il link dalla mail.')
        }
      }
    })()
  }, [])

  const setPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!pwd1 || pwd1.length < 8) { setError('La password deve avere almeno 8 caratteri.'); return }
    if (pwd1 !== pwd2) { setError('Le password non coincidono.'); return }

    const { error } = await supabase.auth.updateUser({ password: pwd1 })
    if (error) { setError(error.message); return }

    alert('Password impostata correttamente. Ora puoi accedere con email e password.')
    onDone()
  }

  return (
    <div style={box}>
      <div style={{ fontWeight:700, marginBottom:8 }}>Attiva il tuo account</div>
      <div style={{ fontSize:13, color:'#555', marginBottom:12 }}>{info}</div>

      <form onSubmit={setPassword} style={{ display:'grid', gap:10 }}>
        <input value={email} readOnly placeholder="Email invitata" style={ipt} />
        <input type="password" placeholder="Nuova password" value={pwd1} onChange={e=>setPwd1(e.target.value)} style={ipt} />
        <input type="password" placeholder="Conferma password" value={pwd2} onChange={e=>setPwd2(e.target.value)} style={ipt} />
        <button type="submit" style={cta}>Imposta password</button>
      </form>
      {error && <div style={{ color:'#c00', marginTop:8 }}>{error}</div>}
    </div>
  )
}
