import React, { useState } from 'react'
import { supabase } from '../supabaseClient'
import { Alert, Button, Card, CardBody, Icon, TextField } from '../ui'
import { errorMessage } from '../lib/format'

const GUIDEUP_LOGO = '/guideup-logo.png'
const APLUS_LOGO = '/advisoryplus-logo.svg'

const POINTS = [
  'Tutta la pipeline commerciale in una schermata',
  'Obiettivi, andamento e scostamenti sempre aggiornati',
  'Appuntamenti e promemoria con invito al calendario',
]

type Mode = 'password' | 'link'

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<null | 'signin' | 'link' | 'reset'>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  async function run(kind: 'signin' | 'link' | 'reset', fn: () => Promise<void>) {
    setError('')
    setInfo('')
    setBusy(kind)
    try {
      await fn()
    } catch (e) {
      setError(errorMessage(e, 'Operazione non riuscita'))
    } finally {
      setBusy(null)
    }
  }

  const signIn = (e: React.FormEvent) => {
    e.preventDefault()
    // Un pulsante disattivato non dice perché: meglio lasciarlo attivo e
    // spiegare che cosa manca al momento del clic.
    if (!emailValid) {
      setError('Inserisci un indirizzo email valido.')
      return
    }
    if (mode === 'password' && !password) {
      setError('Inserisci la password, oppure richiedi un link di accesso via email.')
      return
    }
    if (mode === 'link') {
      void run('link', async () => {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        setInfo('Ti abbiamo inviato un link di accesso. Controlla la posta, anche nello spam.')
      })
      return
    }
    void run('signin', async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) {
        // Supabase risponde sempre "Invalid login credentials": inutile per chi
        // legge, perché non distingue password sbagliata da account inesistente.
        throw new Error(
          error.message.toLowerCase().includes('invalid login')
            ? 'Email o password non corretti. Se non hai mai impostato una password, usa "Password dimenticata".'
            : error.message,
        )
      }
    })
  }

  const forgot = () =>
    run('reset', async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset`,
      })
      if (error) throw error
      setInfo('Ti abbiamo inviato il link per impostare una nuova password.')
    })

  return (
    <div className="gu-auth">
      <aside className="gu-auth__aside">
        <div />

        <div style={{ display: 'grid', gap: 'var(--gu-space-6)' }}>
          <h1 className="gu-auth__claim">
            Trasforma il processo in <em>progresso.</em>
          </h1>
          <div className="gu-auth__points">
            {POINTS.map(p => (
              <div className="gu-auth__point" key={p}>
                <Icon name="checkCircle" size={18} />
                <span>{p}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="gu-auth__partner">
          <span style={{ fontSize: 'var(--gu-text-xs)' }}>Powered by</span>
          <span className="gu-plaque gu-plaque--sm">
            <img src={APLUS_LOGO} alt="AdvisoryPlus" />
          </span>
        </div>
      </aside>

      <main className="gu-auth__main">
        <div className="gu-auth__card">
          {/* Il logo sta qui, non nel pannello scuro: a colori pieni su fondo
              chiaro e nello stesso punto in cui compare da telefono. */}
          <img src={GUIDEUP_LOGO} alt="GuideUp" className="gu-auth__logo" />

          <div>
            <h2 style={{ fontSize: 'var(--gu-text-2xl)', fontWeight: 800, letterSpacing: '-0.025em' }}>Accedi</h2>
            <p style={{ color: 'var(--gu-text-subtle)', marginTop: 4 }}>
              Entra con le credenziali della tua rete.
            </p>
          </div>

          <Card>
            <CardBody>
              <form onSubmit={signIn} className="gu-stack">
                <TextField
                  label="Email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="nome@advisoryplus.it"
                />

                {mode === 'password' && (
                  <TextField
                    label="Password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                )}

                {error && <Alert tone="danger">{error}</Alert>}
                {info && <Alert tone="success">{info}</Alert>}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  block
                  loading={busy === 'signin' || busy === 'link'}
                >
                  {mode === 'password' ? 'Entra' : 'Inviami il link di accesso'}
                </Button>

                <div className="gu-row" style={{ justifyContent: 'space-between' }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setMode(m => (m === 'password' ? 'link' : 'password'))
                      setError('')
                      setInfo('')
                    }}
                  >
                    {mode === 'password' ? 'Accedi con link via email' : 'Accedi con password'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={forgot}
                    loading={busy === 'reset'}
                    disabled={!emailValid}
                    title={emailValid ? undefined : 'Inserisci prima la tua email'}
                  >
                    Password dimenticata?
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>

          <p style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)', textAlign: 'center' }}>
            L'accesso è riservato agli advisor abilitati. Per un nuovo account contatta l'amministratore della rete.
          </p>
        </div>
      </main>
    </div>
  )
}

/**
 * Autenticato in Supabase ma senza profilo in `advisors`.
 * Prima l'utente finiva in un ciclo: login riuscito, schermata di login di
 * nuovo, nessuna spiegazione.
 */
export function NoProfilePage({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div className="gu-auth">
      <aside className="gu-auth__aside">
        <div />
        <h1 className="gu-auth__claim">
          Manca solo <em>l'abilitazione.</em>
        </h1>
        <div className="gu-auth__partner">
          <span style={{ fontSize: 'var(--gu-text-xs)' }}>Powered by</span>
          <span className="gu-plaque gu-plaque--sm">
            <img src={APLUS_LOGO} alt="AdvisoryPlus" />
          </span>
        </div>
      </aside>
      <main className="gu-auth__main">
        <div className="gu-auth__card">
          <img src={GUIDEUP_LOGO} alt="GuideUp" className="gu-auth__logo" />
          <Card>
            <CardBody>
              <div className="gu-stack">
                <Alert tone="warning" title="Account non ancora abilitato">
                  L'accesso con <strong>{email}</strong> è andato a buon fine, ma a questo indirizzo non è associato
                  nessun profilo advisor.
                </Alert>
                <p style={{ color: 'var(--gu-text-muted)' }}>
                  Chiedi a un amministratore di creare il tuo profilo dalla sezione <strong>Utenti</strong>, usando
                  esattamente questo indirizzo email. Al prossimo accesso troverai tutto pronto.
                </p>
                <Button variant="secondary" icon="logout" onClick={onSignOut} block>
                  Esci e usa un altro account
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </main>
    </div>
  )
}
