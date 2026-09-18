import { useCallback, useEffect, useState } from 'react'

/**
 * Router minimo basato su hash.
 *
 * Prima la sezione attiva era solo uno useState: non si poteva mandare a un
 * collega il link di una pagina, il tasto Indietro del browser usciva
 * dall'applicazione e un refresh riportava sempre alla dashboard.
 *
 * L'hash è la scelta giusta qui perché vercel.json riscrive ogni percorso su
 * "/": con le rotte in path ogni link diretto tornerebbe comunque alla radice.
 */

export type RouteId = 'dashboard' | 'leads' | 'import' | 'goals' | 'report' | 'calendar' | 'admin'

export const DEFAULT_ROUTE: RouteId = 'dashboard'

/** Percorso pubblico -> identificativo interno. */
const PATHS: Record<RouteId, string> = {
  dashboard: 'dashboard',
  leads: 'leads',
  import: 'importa',
  goals: 'obiettivi',
  report: 'report',
  calendar: 'calendario',
  admin: 'utenti',
}

const BY_PATH = Object.entries(PATHS).reduce<Record<string, RouteId>>((acc, [id, path]) => {
  acc[path] = id as RouteId
  return acc
}, {})

export type Route = {
  id: RouteId
  /** Secondo segmento: su #/leads/<id> è l'id del lead selezionato. */
  param: string | null
}

function parse(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '')
  const [head, param] = clean.split('/')
  const id = BY_PATH[head] || DEFAULT_ROUTE
  return { id, param: param ? decodeURIComponent(param) : null }
}

export function hrefFor(id: RouteId, param?: string | null) {
  return `#/${PATHS[id]}${param ? `/${encodeURIComponent(param)}` : ''}`
}

export function navigate(id: RouteId, param?: string | null, replace = false) {
  const href = hrefFor(id, param)
  if (window.location.hash === href) return
  if (replace) window.history.replaceState(null, '', href)
  else window.location.hash = href
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function useRoute(): [Route, (id: RouteId, param?: string | null, replace?: boolean) => void] {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash))

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    // Primo accesso senza hash: normalizza l'URL sulla dashboard.
    if (!window.location.hash) window.history.replaceState(null, '', hrefFor(DEFAULT_ROUTE))
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const go = useCallback((id: RouteId, param?: string | null, replace?: boolean) => {
    navigate(id, param, replace)
  }, [])

  return [route, go]
}
