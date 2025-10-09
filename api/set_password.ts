import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

interface SetPasswordResponse {
  ok?: boolean
  error?: string
  details?: string
  message?: string
}

export async function setPasswordAfterInvite(password: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    // 1. Ottieni la sessione corrente (dopo che l'utente ha cliccato sul link di invito)
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError || !session?.access_token) {
      console.error('Session error:', sessionError)
      return {
        success: false,
        error: 'Sessione non valida. Clicca di nuovo sul link di invito.'
      }
    }

    console.log('Session found, setting password...')

    // 2. Chiama l'API per impostare la password
    const response = await fetch('/api/set_password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ password })
    })

    const data: SetPasswordResponse = await response.json()

    if (!response.ok) {
      console.error('API error:', response.status, data)
      return {
        success: false,
        error: data.error || data.details || 'Errore durante l\'impostazione della password'
      }
    }

    console.log('Password set successfully')
    
    // 3. Opzionale: Aggiorna la sessione
    await supabase.auth.refreshSession()

    return { success: true }

  } catch (error: any) {
    console.error('Unexpected error:', error)
    return {
      success: false,
      error: error.message || 'Errore imprevisto'
    }
  }
}

// Esempio di uso in un componente React
export function SetPasswordForm() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate() // o il tuo router

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validazioni
    if (password.length < 8) {
      setError('La password deve essere di almeno 8 caratteri')
      return
    }

    if (password !== confirmPassword) {
      setError('Le password non corrispondono')
      return
    }

    setLoading(true)

    try {
      const result = await setPasswordAfterInvite(password)
      
      if (result.success) {
        // Successo! Reindirizza alla dashboard o alla prossima schermata
        navigate('/dashboard')
      } else {
        setError(result.error || 'Errore durante l\'impostazione della password')
      }
    } catch (error: any) {
      setError(error.message || 'Errore imprevisto')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Imposta la tua password</h2>
      
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div>
        <label>Password (min 8 caratteri)</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          disabled={loading}
        />
      </div>

      <div>
        <label>Conferma Password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
          disabled={loading}
        />
      </div>

      <button type="submit" disabled={loading}>
        {loading ? 'Impostazione in corso...' : 'Imposta Password'}
      </button>
    </form>
  )
}
