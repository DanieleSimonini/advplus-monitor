import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NavigateFn, Query, Route, RouteId } from './router'

/**
 * Stato dei filtri di una pagina, tenuto nell'indirizzo.
 *
 * Prima ogni filtro era uno useState locale. Conseguenze quotidiane:
 * un refresh riportava tutto ai valori di partenza, il tasto Indietro usciva
 * dalla pagina invece di annullare l'ultimo filtro, e non si poteva mandare a
 * un collega il link di una vista ("guarda questi qui").
 *
 * Qui i filtri stanno nella querystring dell'hash, quindi sono condivisibili e
 * navigabili, e l'ultima combinazione usata viene ricordata per pagina: chi
 * lavora sempre sullo stesso taglio non deve reimpostarlo ogni mattina.
 */

const MEMORY_PREFIX = 'guideup.filtri.'

function readMemory(routeId: RouteId): Query | null {
  try {
    const raw = window.localStorage.getItem(MEMORY_PREFIX + routeId)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Query) : null
  } catch {
    // Modalità privata, storage pieno o disattivato: la memoria dei filtri è
    // una comodità, non deve mai impedire di usare la pagina.
    return null
  }
}

function writeMemory(routeId: RouteId, query: Query) {
  try {
    window.localStorage.setItem(MEMORY_PREFIX + routeId, JSON.stringify(query))
  } catch {
    /* vedi sopra */
  }
}

export type FilterDefaults<T extends string> = Record<T, string>

export type FiltersApi<T extends string> = {
  /** Valori correnti, già con i default applicati. */
  values: Record<T, string>
  /** Imposta un filtro (stringa vuota = torna al valore predefinito). */
  set: (key: T, value: string) => void
  /** Imposta più filtri insieme, con una sola voce di cronologia. */
  patch: (next: Partial<Record<T, string>>) => void
  /** Riporta tutto ai valori predefiniti e dimentica la combinazione salvata. */
  reset: () => void
  /** Filtri diversi dal valore predefinito, per i chip e per il conteggio. */
  active: { key: T; value: string }[]
}

export function useFilters<T extends string>(
  route: Route,
  go: NavigateFn,
  defaults: FilterDefaults<T>,
): FiltersApi<T> {
  const keys = useMemo(() => Object.keys(defaults) as T[], [defaults])
  const restored = useRef(false)

  // Al primo ingresso su una pagina senza filtri nell'indirizzo si ripristina
  // l'ultima combinazione usata. Con `replace` per non lasciare in cronologia
  // una voce "pagina vuota" su cui il tasto Indietro rimbalzerebbe.
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    if (Object.keys(route.query).length) return
    const remembered = readMemory(route.id)
    if (!remembered || !Object.keys(remembered).length) return
    const kept: Query = {}
    for (const k of keys) if (remembered[k] && remembered[k] !== defaults[k]) kept[k] = remembered[k]
    if (Object.keys(kept).length) go(route.id, { param: route.param, query: kept, replace: true })
  }, [route.id, route.param, route.query, keys, defaults, go])

  const values = useMemo(() => {
    const out = {} as Record<T, string>
    for (const k of keys) out[k] = route.query[k] ?? defaults[k]
    return out
  }, [route.query, keys, defaults])

  const apply = useCallback(
    (next: Partial<Record<T, string>>) => {
      const query: Query = { ...route.query }
      for (const [k, v] of Object.entries(next) as [T, string][]) {
        // Solo ciò che si discosta dal valore predefinito finisce nell'indirizzo:
        // un link con dentro tutti i default sarebbe illeggibile.
        if (v === '' || v === defaults[k]) delete query[k]
        else query[k] = v
      }
      writeMemory(route.id, query)
      go(route.id, { param: route.param, query })
    },
    [route.id, route.param, route.query, defaults, go],
  )

  const set = useCallback((key: T, value: string) => apply({ [key]: value } as Partial<Record<T, string>>), [apply])

  const reset = useCallback(() => {
    writeMemory(route.id, {})
    go(route.id, { param: route.param, query: {} })
  }, [route.id, route.param, go])

  const active = useMemo(
    () => keys.filter(k => values[k] !== defaults[k]).map(k => ({ key: k, value: values[k] })),
    [keys, values, defaults],
  )

  return { values, set, patch: apply, reset, active }
}

/**
 * Valore che si aggiorna solo quando l'utente smette di digitare.
 * Serve alla ricerca: senza, ogni tasto premuto scatenava una query e una voce
 * di cronologia.
 */
export function useDebounced<V>(value: V, delay = 300): V {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}
