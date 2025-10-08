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

function getUrlTokensDebug(u: string){
  const out: string[] = []
  const hasHash = u.includes('#')
  const hasQ = u.includes('?')
  if (hasHash) out.push('#present')
  if (hasQ) out.push('?present')
  const frag = u.split('#')[1] || ''
  const query = u.split('?')[1]?.split('#')[0] || ''
  const hasAT = frag.includes('access_token=') || query.includes('access_token=')
  const hasRT = frag.includes('refresh_token=') || query.includes('refresh_token=')
  const hasType = frag.includes('type=') || query.includes('type=')
  out.push(`hasAT=${hasAT}`, `hasRT=${hasRT}`, `hasType=${hasType}`)
  return out.join(' · ')
}

// aggiungi/lascia questo helper in alto (se non c’è già)
function withTimeout<T>(p: Promise<T>, ms = 15000, label = 'operazione'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

// --- PATCH useEffect ---
useEffect(() => {
  let cancelled = false

  ;(async () => {
    const href = typeof window !== 'undefined' ? window.location.href : ''
    const urlDbg = href ? getUrlTokensDebug(href) : 'no href'

    try {
      // Prova a creare la sessione da URL (hash o query) ma con timeout
      if (href && (href.includes('access_token=') || href.includes('refresh_token=') || href.includes('type='))) {
        await withTimeout(supabase.auth.exchangeCodeForSession(href), 12000, 'exchangeCodeForSession')
      }
    } catch (e:any) {
      // non blocchiamo: segnaliamo nel debug
      if (!cancelled) setDebug(`exchange error: ${e?.message || e} · url: ${urlDbg}`)
    }

    try {
      // Leggi la sessione con timeout
      const { data } = await withTimeout(supabase.auth.getSession(), 8000, 'getSession')
      const email = data.session?.user?.email || ''
      if (!cancelled) {
        setDebug(prev => (prev ? prev + ' · ' : '') + `url: ${urlDbg} · hasSession=${!!data.session} · user=${email || '-'}`)
        setCanReset(!!data.session)
      }
    } catch (e:any) {
      if (!cancelled) {
        setDebug(prev => (prev ? prev + ' · ' : '') + `getSession error: ${e?.message || e} · url: ${urlDbg}`)
        setCanReset(false)
      }
    } finally {
      if (!cancelled) setLoading(false)
    }
  })()

  // failsafe extra: anche se qualcosa rimane sospeso, sblocca il loading dopo 4s
  const hardFallback = setTimeout(() => { if (!cancelled) setLoading(false) }, 4000)

  return () => { cancelled = true; clearTimeout(hardFallback) }
}, [])


export default function ResetPasswordPage() {
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [canReset, setCanReset] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [debug, setDebug] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const href = typeof window !== 'undefined' ? window.location.href : ''
        const urlDbg = href ? getUrlTokensDebug(href) : 'no href'
        // prova sempre l'exchange (gestisce hash e query)
        if (href && (href.includes('access_token=') || href.includes('refresh_token=') || href.includes('type='))) {
          await supabase.auth.exchangeCodeForSession(href)
        }
        const { data } = await supabase.auth.getSession()
        const email = data.session?.user?.email || ''
        setDebug(`url: ${urlDbg} · hasSession=${!!data.session} · user=${email || '-'}`)
        setCanReset(!!data.session)
      } catch (e:any) {
        setDebug(`exchange error: ${e?.message||e}`)
        setCanReset(false)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    setErr(''); setOk('')

    if (pwd.length < 8) { setErr('La password deve avere almeno 8 caratteri.'); return }
    if (pwd !== pwd2)   { setErr('Le password non coincidono.'); return }

    setSaving(true)
    try {
      // 1) aggiorna con timeout
      const { error } = await withTimeout(
        supabase.auth.updateUser({ password: pwd }),
        15000,
        'updateUser'
      )
      if ((error as any)) throw (error as any)

      setOk('Password aggiornata. Reindirizzo al login…')

      // 2) prova signOut con timeout, ma non bloccare il redirect se va lungo
      try {
        await withTimeout(supabase.auth.signOut(), 8000, 'signOut')
      } catch(_) { /* no-op: forziamo ugualmente il redirect */ }

      // 3) redirect immediato
      window.location.replace('/login?reset=ok')
    } catch (ex:any) {
      const msg = ex?.message || String(ex)
      console.error('updateUser/signOut error', ex)
      setErr(`Errore: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ padding: 24 }}>Caricamento…</div>

  if (!canReset) {
    return (
      <div style={{ margin: '40px auto', ...card }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>DEBUG: {debug}</div>
        Link non valido o scaduto (mancano i token nell’URL). Torna al <a href="/login">login</a> e richiedi un nuovo reset/invito.
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f7f8fb', padding: 24 }}>
      <div style={card}>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>Imposta nuova password</div>

        {/* Ribbon di debug – lo rimuoveremo quando tutto è ok */}
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
