import React, { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const card: React.CSSProperties = {
  maxWidth: 480,
  width: 'min(92vw, 480px)',
  background: '#fff',
  border: '1px solid #eee',
  borderRadius: 16,
  padding: 24,
}

export default function ResetPasswordPage() {
  const [pwd, setPwd] = useState<string>('')
  const [pwd2, setPwd2] = useState<string>('')
  const [err, setErr] = useState<string>('')
  const [ok, setOk] = useState<string>('')
  const [canReset, setCanReset] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  const [saving, setSaving] = useState<boolean>(false)

  // Attiva la sessione dalla URL (invito/reset: #access_token, type=recovery|signup)
  useEffect(() => {
    (async () => {
      try {
        const hash = typeof window !== 'undefined' ? window.location.hash : ''
        if (hash && hash.includes('access_token')) {
          // Supabase v2 helper: crea la sessione dal fragment
          await supabase.auth.exchangeCodeForSession(hash)
        }
      } catch (e) {
        // no-op (lato UI mostriamo form solo se la sessione è valida)
      } finally {
        const { data } = await supabase.auth.getSession()
        setCanReset(!!data.session)
        setLoading(false)
      }
    })()
  }, [])

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setOk('')

    if (pwd.length < 8) {
      setErr('La password deve avere almeno 8 caratteri.')
      return
    }
    if (pwd !== pwd2) {
      setErr('Le password non coincidono.')
      return
    }

    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd })
      if (error) throw error
      setOk('Password aggiornata. Reindirizzo al login…')

      // Chiudi la sessione “recovery” e torna al login
      await supabase.auth.signOut()
      window.location.replace('/login?reset=ok')
    } catch (ex: any) {
      setErr(ex?.message || 'Aggiornamento password fallito')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div style={{ padding: 24 }}>Caricamento…</div>
  }

  if (!canReset) {
    return (
      <div style={{ margin: '40px auto', ...card }}>
        Link non valido o scaduto. Torna al <a href="/login">login</a> e richiedi un nuovo reset.
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#f7f8fb',
        padding: 24,
      }}
    >
      <div style={card}>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>Imposta nuova password</div>

        <form onSubmit={onSave} style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#555' }}>Nuova password</span>
            <input
              type="password"
              required
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              style={{ padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8 }}
            />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#555' }}>Conferma password</span>
            <input
              type="password"
              required
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              style={{ padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8 }}
            />
          </label>

          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #0b57d0',
              background: '#0b57d0',
              color: '#fff',
            }}
          >
            {saving ? 'Salvataggio…' : 'Salva'}
          </button>
        </form>

        {err && <div style={{ color: '#c00', marginTop: 8 }}>{err}</div>}
        {ok && <div style={{ color: '#0a0', marginTop: 8 }}>{ok}</div>}
      </div>
    </div>
  )
}
