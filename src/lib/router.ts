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
 *
 * Oltre alla sezione l'hash porta anche i filtri, come querystring:
 *
 *   #/lead/<id-selezionato>?avanzamento=mai&contatto=60&ordina=trascurati
 *
 * Senza questo, ogni filtro impostato spariva al primo refresh, il tasto
 * Indietro non lo annullava e non si poteva condividere una vista.
 */

export type RouteId = 'today' | 'dashboard' | 'leads' | 'import' | 'goals' | 'report' | 'calendar' | 'admin'

export const DEFAULT_ROUTE: RouteId = 'today'

/** Percorso pubblico -> identificativo interno. */
const PATHS: Record<RouteId, string> = {
  today: 'oggi',
  dashboard: 'dashboard',
  leads: 'lead',
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

// I vecchi indirizzi restano validi: chi ha un segnalibro su #/leads non deve
// trovarsi sulla pagina sbagliata.
const ALIASES: Record<string, RouteId> = { leads: 'leads' }

export type Query = Record<string, string>

export type Route = {
  id: RouteId
  /** Secondo segmento: su #/lead/<id> è l'id del lead selezionato. */
  param: string | null
  /** Parametri dopo il "?": i filtri della pagina. */
  query: Query
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const qIndex = raw.indexOf('?')
  const path = qIndex === -1 ? raw : raw.slice(0, qIndex)
  const search = qIndex === -1 ? '' : raw.slice(qIndex + 1)

  const [head, param] = path.split('/')
  const id = BY_PATH[head] || ALIASES[head] || DEFAULT_ROUTE

  const query: Query = {}
  if (search) {
    for (const [k, v] of new URLSearchParams(search)) {
      if (v !== '') query[k] = v
    }
  }

  return { id, param: param ? decodeURIComponent(param) : null, query }
}

function serializeQuery(query?: Query | null): string {
  if (!query) return ''
  const params = new URLSearchParams()
  // Ordine stabile: due viste identiche devono produrre lo stesso indirizzo,
  // altrimenti il confronto con l'hash corrente fallisce e si accumula
  // cronologia inutile.
  for (const key of Object.keys(query).sort()) {
    const value = query[key]
    if (value !== '' && value !== undefined && value !== null) params.set(key, value)
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

export function hrefFor(id: RouteId, param?: string | null, query?: Query | null) {
  return `#/${PATHS[id]}${param ? `/${encodeURIComponent(param)}` : ''}${serializeQuery(query)}`
}

export type NavOptions = { param?: string | null; query?: Query | null; replace?: boolean }

export function navigate(id: RouteId, options: NavOptions = {}) {
  const href = hrefFor(id, options.param, options.query)
  if (window.location.hash === href) return
  if (options.replace) {
    window.history.replaceState(null, '', href)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    window.location.hash = href
  }
}

export type NavigateFn = (id: RouteId, options?: NavOptions) => void

export function useRoute(): [Route, NavigateFn] {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash))

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    // Primo accesso senza hash: normalizza l'URL sulla pagina iniziale.
    if (!window.location.hash) window.history.replaceState(null, '', hrefFor(DEFAULT_ROUTE))
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const go = useCallback<NavigateFn>((id, options) => {
    navigate(id, options)
  }, [])

  return [route, go]
}
