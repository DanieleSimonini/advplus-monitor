import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Alert, Button, Card, CardBody, Icon, TextField } from '../ui'
import { errorMessage } from '../lib/format'

const GUIDEUP_LOGO = '/guideup-logo.png'
const MIN_LENGTH = 8

type Phase = 'checking' | 'ready' | 'invalid' | 'saved'

export default function ResetPasswordPage() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  /**
   * Il link di reset arriva con i token nel frammento dell'URL (flusso implicito)
   * oppure con un parametro `code` (flusso PKCE). Il client Supabase è
   * configurato con detectSessionInUrl, quindi nel primo caso la sessione si
   * crea da sola: basta aspettarla. Nel secondo va scambiato il codice.
   *
   * La versione precedente mostrava a video un riquadro di debug con lo stato
   * dei token: informazione inutile per chi legge e che fa sembrare rotta una
   * pagina che funziona.
   */
  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
        const url = new URL(window.location.href)
        const code = url.searchParams.get('code')
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) throw error
        }

        // Il frammento viene elaborato dal client subito dopo il caricamento.
        for (let i = 0; i < 12; i++) {
          const { data } = await supabase.auth.getSession()
          if (!alive) return
          if (data.session) {
            setPhase('ready')
            // I token restano nell'URL: vanno tolti dalla barra degli indirizzi
            // e dalla cronologia.
            window.history.replaceState(null, '', '/reset')
            return
          }
          await new Promise(r => setTimeout(r, 250))
        }
        if (alive) setPhase('invalid')
      } catch {
        if (alive) setPhase('invalid')
      }
    })()

    return () => {
      alive = false
    }
  }, [])

  const strength = useMemo(() => scorePassword(password), [password])

  const passwordError =
    touched && password.length > 0 && password.length < MIN_LENGTH
      ? `La password deve avere almeno ${MIN_LENGTH} caratteri`
      : null
  const confirmError = touched && confirm.length > 0 && confirm !== password ? 'Le password non coincidono' : null
  const canSubmit = password.length >= MIN_LENGTH && password === confirm

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    setSaving(true)
    setError('')
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Sessione scaduta. Riapri il link che hai ricevuto via email.')

      const res = await fetch('/api/set_password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `Errore ${res.status}`)

      await supabase.auth.signOut().catch(() => {})
      setPhase('saved')
    } catch (ex) {
      setError(errorMessage(ex, 'Non è stato possibile aggiornare la password'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--gu-space-6)' }}>
      <div style={{ width: 'min(100%, 420px)', display: 'grid', gap: 'var(--gu-space-5)', justifyItems: 'center' }}>
        <img src={GUIDEUP_LOGO} alt="GuideUp" style={{ height: 34, width: 'auto' }} />

        {phase === 'checking' && (
          <Card>
            <CardBody>
              <div className="gu-row-tight" style={{ justifyContent: 'center', color: 'var(--gu-text-muted)' }}>
                <span className="gu-spinner" />
                Verifica del link in corso…
              </div>
            </CardBody>
          </Card>
        )}

        {phase === 'invalid' && (
          <Card>
            <CardBody className="gu-stack">
              <Alert tone="danger" title="Link non valido o scaduto">
                I link per impostare la password valgono per un tempo limitato e possono essere usati una sola volta.
              </Alert>
              <Button variant="primary" block onClick={() => window.location.replace('/')}>
                Torna all'accesso e richiedi un nuovo link
              </Button>
            </CardBody>
          </Card>
        )}

        {phase === 'saved' && (
          <Card>
            <CardBody className="gu-stack">
              <div style={{ display: 'grid', justifyItems: 'center', gap: 'var(--gu-space-2)', textAlign: 'center' }}>
                <span
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: 'var(--gu-success-soft)',
                    color: 'var(--gu-success-fg)',
                  }}
                >
                  <Icon name="checkCircle" size={24} />
                </span>
                <h1 style={{ fontSize: 'var(--gu-text-xl)' }}>Password aggiornata</h1>
                <p style={{ color: 'var(--gu-text-muted)' }}>Ora puoi accedere a GuideUp con la nuova password.</p>
              </div>
              <Button variant="primary" block onClick={() => window.location.replace('/')}>
                Vai all'accesso
              </Button>
            </CardBody>
          </Card>
        )}

        {phase === 'ready' && (
          <Card style={{ width: '100%' }}>
            <CardBody>
              <form onSubmit={submit} className="gu-stack">
                <div>
                  <h1 style={{ fontSize: 'var(--gu-text-xl)' }}>Imposta la password</h1>
                  <p style={{ color: 'var(--gu-text-subtle)', marginTop: 4 }}>
                    Scegli una password di almeno {MIN_LENGTH} caratteri.
                  </p>
                </div>

                <TextField
                  label="Nuova password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  error={passwordError}
                  onBlur={() => setTouched(true)}
                  onChange={e => setPassword(e.target.value)}
                />

                {password.length > 0 && (
                  <div>
                    <div className="gu-progress" style={{ height: 5 }}>
                      <div
                        className={`gu-progress__fill gu-progress__fill--${
                          strength.level === 3 ? 'success' : strength.level === 2 ? 'warning' : 'danger'
                        }`}
                        style={{ width: `${(strength.level / 3) * 100}%` }}
                      />
                    </div>
                    <div style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)', marginTop: 4 }}>
                      Sicurezza: {strength.label}
                    </div>
                  </div>
                )}

                <TextField
                  label="Conferma password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  error={confirmError}
                  onBlur={() => setTouched(true)}
                  onChange={e => setConfirm(e.target.value)}
                />

                {error && <Alert tone="danger">{error}</Alert>}

                <Button type="submit" variant="primary" size="lg" block loading={saving} disabled={!canSubmit}>
                  Salva password
                </Button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  )
}

function scorePassword(pwd: string): { level: 0 | 1 | 2 | 3; label: string } {
  if (!pwd) return { level: 0, label: '—' }
  let score = 0
  if (pwd.length >= MIN_LENGTH) score++
  if (pwd.length >= 12) score++
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++
  if (/\d/.test(pwd)) score++
  if (/[^A-Za-z0-9]/.test(pwd)) score++
  if (score <= 2) return { level: 1, label: 'debole' }
  if (score <= 3) return { level: 2, label: 'discreta' }
  return { level: 3, label: 'buona' }
}
