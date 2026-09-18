import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { parseScope, serializeScope, useAdvisors, type Scope } from '../lib/useAdvisors'
import type { NavigateFn, Route } from '../lib/router'

/**
 * "Di chi sto guardando i dati", una volta sola per tutta l'applicazione.
 *
 * Prima ogni pagina teneva il proprio scope in uno useState inizializzato dal
 * valore predefinito del ruolo: passando da Dashboard a Report a Calendario la
 * selezione si azzerava ogni volta. E lo stesso concetto aveva quattro nomi
 * diversi nell'interfaccia — Perimetro, Assegnatario, Advisor, Utenti.
 * Adesso il valore è uno, si chiama "Advisor" ovunque e segue l'utente da una
 * pagina all'altra.
 */

const STORAGE_KEY = 'guideup.advisor'

type ScopeContextValue = {
  scope: Scope | null
  setScope: (s: Scope) => void
}

const ScopeContext = createContext<ScopeContextValue>({ scope: null, setScope: () => {} })

export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const { defaultScope, scopeOptions, loading } = useAdvisors()
  const [scope, setScopeState] = useState<Scope | null>(null)

  // Il valore salvato viene accettato solo se è ancora una scelta legittima:
  // un Team Lead che perde un Junior non deve restare agganciato a un
  // perimetro che ora gli restituirebbe una pagina vuota.
  useEffect(() => {
    if (scope || loading || !scopeOptions.length) return
    let restored: Scope | null = null
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (saved && scopeOptions.some(o => o.value === saved)) restored = parseScope(saved)
    } catch {
      /* storage non disponibile: si riparte dal valore predefinito */
    }
    setScopeState(restored || defaultScope)
  }, [scope, loading, scopeOptions, defaultScope])

  const setScope = useCallback((next: Scope) => {
    setScopeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, serializeScope(next))
    } catch {
      /* vedi sopra */
    }
  }, [])

  const value = useMemo(() => ({ scope, setScope }), [scope, setScope])

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
}

export function useScope() {
  return useContext(ScopeContext)
}

/**
 * Come useScope, ma tiene anche allineato il parametro `chi` nell'indirizzo:
 * così una vista si può mandare a un collega comprensiva di chi si sta
 * guardando. L'indirizzo, se presente, ha la precedenza sulla memoria.
 */
export function useScopeParam(route: Route, go: NavigateFn): ScopeContextValue {
  const { scope, setScope } = useScope()
  const { scopeOptions } = useAdvisors()
  const fromUrl = route.query.chi

  useEffect(() => {
    if (!fromUrl || !scopeOptions.length) return
    if (!scopeOptions.some(o => o.value === fromUrl)) return
    if (scope && serializeScope(scope) === fromUrl) return
    setScope(parseScope(fromUrl))
  }, [fromUrl, scopeOptions, scope, setScope])

  const setAndSync = useCallback(
    (next: Scope) => {
      setScope(next)
      const query = { ...route.query, chi: serializeScope(next) }
      go(route.id, { param: route.param, query })
    },
    [setScope, go, route.id, route.param, route.query],
  )

  return { scope, setScope: setAndSync }
}
