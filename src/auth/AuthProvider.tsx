import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { ADVISOR_FIELDS, type Advisor, type Role } from '../lib/domain'

/**
 * Stato di autenticazione + profilo advisor.
 *
 * Note sul profilo: il codice precedente, se non trovava una riga in
 * `advisors`, provava a crearne una con ruolo Junior. Quella INSERT non può
 * riuscire: sulla tabella `advisors` esistono solo policy di inserimento per
 * Admin (`p_advisors_all`) e per i Team Lead sui Junior (che peraltro è scritta
 * con il ruolo 'TeamLead' invece di 'Team Lead', quindi non corrisponde mai a
 * nulla). Il risultato era un fallimento silenzioso con l'utente bloccato su
 * una schermata di login che si riapriva all'infinito.
 * Ora il caso viene riconosciuto e spiegato.
 */

export type AuthStatus =
  | { state: 'loading' }
  | { state: 'anonymous' }
  /** Autenticato ma senza riga in `advisors`: serve un invito da un Admin. */
  | { state: 'unprovisioned'; email: string }
  | { state: 'ready'; me: Advisor }

type AuthContextValue = {
  status: AuthStatus
  me: Advisor | null
  role: Role | null
  isAdmin: boolean
  isTeamLead: boolean
  isJunior: boolean
  signOut: () => Promise<void>
  reload: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  status: { state: 'loading' },
  me: null,
  role: null,
  isAdmin: false,
  isTeamLead: false,
  isJunior: false,
  signOut: async () => {},
  reload: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>({ state: 'loading' })
  const loadingRef = useRef(false)

  const loadProfile = useCallback(async (userId: string, email: string) => {
    if (loadingRef.current) return
    loadingRef.current = true
    try {
      // 1) collegamento diretto tramite user_id
      const byUid = await supabase.from('advisors').select(ADVISOR_FIELDS).eq('user_id', userId).maybeSingle()
      if (byUid.data) {
        setStatus({ state: 'ready', me: byUid.data as Advisor })
        return
      }

      // 2) l'invito crea la riga con la sola email: la colleghiamo al primo accesso.
      //    È l'unica scrittura consentita dalla policy `advisors_set_user_id_once`.
      const byEmail = await supabase.from('advisors').select(ADVISOR_FIELDS).ilike('email', email).maybeSingle()
      if (byEmail.data) {
        const row = byEmail.data as Advisor
        if (!row.user_id) {
          const linked = await supabase
            .from('advisors')
            .update({ user_id: userId })
            .eq('id', row.id)
            .select(ADVISOR_FIELDS)
            .maybeSingle()
          if (linked.data) {
            setStatus({ state: 'ready', me: linked.data as Advisor })
            return
          }
        }
        setStatus({ state: 'ready', me: { ...row, user_id: row.user_id || userId } })
        return
      }

      setStatus({ state: 'unprovisioned', email })
    } catch {
      setStatus({ state: 'unprovisioned', email })
    } finally {
      loadingRef.current = false
    }
  }, [])

  const syncSession = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    const session = data.session
    if (!session?.user) {
      setStatus({ state: 'anonymous' })
      return
    }
    await loadProfile(session.user.id, session.user.email || '')
  }, [loadProfile])

  useEffect(() => {
    let alive = true

    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!alive) return
      if (data.session?.user) {
        await loadProfile(data.session.user.id, data.session.user.email || '')
      } else {
        // La sessione può essere solo scaduta in memoria: un refresh la recupera.
        const refreshed = await supabase.auth.refreshSession()
        if (!alive) return
        if (refreshed.data.session?.user) {
          await loadProfile(refreshed.data.session.user.id, refreshed.data.session.user.email || '')
        } else {
          setStatus({ state: 'anonymous' })
        }
      }
    })()

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return
      if (event === 'TOKEN_REFRESHED') return // nessun impatto sul profilo
      if (!session?.user) {
        setStatus({ state: 'anonymous' })
        return
      }
      void loadProfile(session.user.id, session.user.email || '')
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  // Al ritorno in primo piano la sessione può essere scaduta mentre il tab era
  // in background (i browser rallentano i timer): si riallinea senza sfarfallii.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void supabase.auth.getSession().then(({ data }) => {
        if (!data.session) void syncSession()
      })
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [syncSession])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setStatus({ state: 'anonymous' })
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    const me = status.state === 'ready' ? status.me : null
    return {
      status,
      me,
      role: me?.role || null,
      isAdmin: me?.role === 'Admin',
      isTeamLead: me?.role === 'Team Lead',
      isJunior: me?.role === 'Junior',
      signOut,
      reload: syncSession,
    }
  }, [status, signOut, syncSession])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

/** Profilo garantito non nullo: da usare dentro le pagine dell'area protetta. */
export function useMe(): Advisor {
  const { me } = useAuth()
  if (!me) throw new Error('useMe() richiede un profilo caricato')
  return me
}
