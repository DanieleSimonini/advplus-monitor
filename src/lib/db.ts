import { supabase } from '../supabaseClient'

/**
 * Utility di accesso ai dati.
 *
 * Due problemi che questo file risolve e che prima erano latenti:
 *
 * 1. `.in('lead_id', ids)` con migliaia di id costruisce una query string
 *    lunghissima: oltre ~8 KB i proxy iniziano a rispondere 414 e la pagina
 *    smette di funzionare senza un errore comprensibile. Qui gli id vengono
 *    spezzati in blocchi.
 *
 * 2. PostgREST restituisce al massimo 1000 righe per richiesta. Il codice
 *    precedente faceva `select()` senza range e dava per scontato di avere
 *    tutto: superati i 1000 lead, i totali erano semplicemente sbagliati, in
 *    silenzio. `fetchAllPages` continua a paginare finché ci sono dati.
 */

export const PAGE_MAX = 1000
const IN_CHUNK = 150

export function chunk<T>(items: T[], size = IN_CHUNK): T[][] {
  if (items.length <= size) return items.length ? [items] : []
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Esegue la stessa query su blocchi di id e concatena i risultati. */
export async function inChunks<T>(ids: string[], run: (slice: string[]) => Promise<T[]>): Promise<T[]> {
  const blocks = chunk(ids)
  if (!blocks.length) return []
  const results = await Promise.all(blocks.map(run))
  return results.flat()
}

type QueryBuilder = {
  range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/** Scorre tutte le pagine di una query finché non finiscono le righe. */
export async function fetchAllPages<T>(build: () => QueryBuilder, hardLimit = 20000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < hardLimit; from += PAGE_MAX) {
    const { data, error } = await build().range(from, from + PAGE_MAX - 1)
    if (error) throw new Error(error.message)
    const rows = (data || []) as T[]
    out.push(...rows)
    if (rows.length < PAGE_MAX) break
  }
  return out
}

/** Conteggio esatto senza scaricare le righe. */
export async function countWhere(
  table: string,
  apply: (q: ReturnType<typeof supabase.from>) => unknown,
): Promise<number> {
  const base = supabase.from(table).select('id', { count: 'exact', head: true })
  const q = apply(base as never) as unknown as PromiseLike<{ count: number | null; error: { message: string } | null }>
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count || 0
}

/** Rimuove i duplicati mantenendo l'ordine. */
export function uniq<T>(items: (T | null | undefined)[]): T[] {
  return Array.from(new Set(items.filter((x): x is T => x !== null && x !== undefined)))
}

/** Indicizza un elenco per chiave. */
export function indexBy<T>(items: T[], key: (item: T) => string | null | undefined): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of items) {
    const k = key(item)
    if (k) map.set(k, item)
  }
  return map
}

/** Raggruppa un elenco per chiave. */
export function groupBy<T>(items: T[], key: (item: T) => string | null | undefined): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    if (!k) continue
    const arr = map.get(k)
    if (arr) arr.push(item)
    else map.set(k, [item])
  }
  return map
}
