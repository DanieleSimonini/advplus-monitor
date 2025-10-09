import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function SetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  // Estrai token e verifica utente dall'URL
  useEffect(() => {
    const extractTokenAndUser = async () => {
      // Supabase mette il token nell'hash (#) dell'URL
      const hashParams = new URLSearchParams(window.location.hash.substring(1))
      const token = hashParams.get('access_token') || searchParams.get('token')
      
      if (!token) {
        setError('Link non valido o scaduto')
        return
      }

      setAccessToken(token)

      // Verifica il token e ottieni l'email dell'utente
      const { data: { user }, error: userError } = await supabase.auth.getUser(token)
      
      if (userError || !user) {
        setError('Link non valido o scaduto')
        return
      }

      setUserEmail(user.email || null)
    }

    extractTokenAndUser()
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validazioni
    if (password.length < 8) {
      setError('La password deve essere di almeno 8 caratteri')
      return
    }

    if (password !== confirmPassword) {
      setError('Le password non coincidono')
      return
    }

    if (!accessToken) {
      setError('Token mancante. Richiedi un nuovo link.')
      return
    }

    if (!userEmail) {
      setError('Email utente non trovata. Richiedi un nuovo link.')
      return
    }

    setLoading(true)

    try {
      // 1. Chiama l'endpoint per impostare la password
      const response = await fetch('/api/set_password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ password }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Errore durante l\'impostazione della password')
      }

      console.log('Password impostata con successo')

      // 2. IMPORTANTE: Fai il login automatico con le nuove credenziali
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: password,
      })

      if (signInError) {
        console.error('Errore durante il login automatico:', signInError)
        // Se il login automatico fallisce, redirect al login manuale
        setError('Password impostata! Effettua il login manualmente.')
        setTimeout(() => {
          navigate('/login', { 
            state: { message: 'Password impostata con successo! Effettua il login.' }
          })
        }, 2000)
        return
      }

      if (signInData.session) {
        console.log('Login automatico riuscito')
        // Login riuscito! Redirect alla dashboard
        navigate('/dashboard', { replace: true })
      } else {
        // Nessuna sessione creata, redirect al login
        navigate('/login', { 
          state: { message: 'Password impostata con successo! Effettua il login.' }
        })
      }

    } catch (err: any) {
      console.error('Errore:', err)
      setError(err.message || 'Si è verificato un errore')
      setLoading(false)
    }
  }

  if (!accessToken && !error) {
    return (
      <div className="loading-container">
        <p>Verifica in corso...</p>
      </div>
    )
  }

  return (
    <div className="set-password-container">
      <div className="logo-container">
        <img src="/logo.svg" alt="GuideUp" />
      </div>

      <div className="set-password-card">
        <h1>Imposta la tua password</h1>
        
        {userEmail && (
          <p className="user-email">Account: <strong>{userEmail}</strong></p>
        )}

        {error && (
          <div className="error-message" style={{ 
            padding: '12px', 
            marginBottom: '20px', 
            backgroundColor: '#fee', 
            color: '#c00',
            borderRadius: '4px'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="password">Nuova Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimo 8 caratteri"
              required
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Conferma Password</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Ripeti la password"
              required
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          <button 
            type="submit" 
            className="btn-primary"
            disabled={loading}
          >
            {loading ? 'Caricamento...' : 'Imposta Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
