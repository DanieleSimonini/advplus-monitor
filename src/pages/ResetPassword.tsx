// src/pages/SetPassword.tsx
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function SetPasswordPage() {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser()
      if (userErr || !user?.email) throw new Error('Sessione non valida / utente non trovato')
      const email = user.email

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Token mancante')

      const resp = await fetch('/api/set_password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ password }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(json.error || 'Aggiornamento password fallito')

      const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password })
      if (loginErr) throw new Error('Login fallito: ' + loginErr.message)

      // reload completo per partire con sessione pulita ed evitare rimbalzi
      window.location.assign('/')
    } catch (err: any) {
      setError(err.message || 'Errore imprevisto')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-sm mx-auto mt-16 flex flex-col gap-4">
      <input
        type="password"
        placeholder="Nuova password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="border p-2 rounded"
        required
      />
      <button type="submit" disabled={loading} className="bg-blue-600 text-white py-2 rounded">
        {loading ? 'Salvataggio…' : 'Conferma password'}
      </button>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </form>
  )
}
