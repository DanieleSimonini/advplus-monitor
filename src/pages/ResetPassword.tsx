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
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [canReset, setCanReset] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [debug, setDebug] = useState<string>('')

  // 1) Attiva la sessione dall’URL (invito/reset). Copre sia #access_token che ?access_token
  useEffect(() => {
    (async () => {
      try {
        const href = typeof window !== 'undefined' ? window.location.href : ''
        if (href && (href.includes('access_token=') || href.includes('refresh_token='))) {
          // Supabase v2: estrae token da URL (hash o query) e crea la sessione
          await supabase.auth.exchangeCodeForSession(href)
        }
      } catch (e: any) {
        // No-op (continuiamo e verifichiamo se c’è già sessione)
      } finally {
        const { data } = await supabase.auth.getSession()
        const email = data.session?.user?.email || ''
        setDebug(`hasSession=${!!data.session} user=${email || '-'}`)
        setCanReset(!!data.session)
        setLoading(false)
      }
    })()
  }, [])

  // 2) Salvataggio nuova password
  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setOk('')

    if (pwd.length < 8) { setErr('La password deve avere almeno 8 caratteri.'); return }
    if (pwd !== pwd2)   { setErr('Le password non coincidono.'); return }

    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd })
      if (error) throw error

      setOk('Password aggiornata. Reindirizzo al login…')

      // Chiudi la sessione “recovery” e vai al login (replace evita il “torna indietro”)
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
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>DEBUG: {debug}</div>
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

        {/* Mini ribbon debug – utile ora, poi lo rimuoviamo */}
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>DEBUG: {debug}</div>

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
        {ok  && <div style={{ color: '#0a0', marginTop: 8 }}>{ok}</div>}
      </div>
    </div>
  )
}

