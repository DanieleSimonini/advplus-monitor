/**
 * Ricerca testuale su più colonne.
 *
 * Il problema di prima: il termine veniva ripulito da virgole e parentesi
 * perché spezzerebbero la sintassi di `or()` di PostgREST, e poi usato come un
 * unico pattern. Cercare "Rossi, Mario" diventava quindi `%Rossi  Mario%`, che
 * non corrisponde a nulla — la ricerca non dava errore, semplicemente non
 * trovava niente. E anche senza virgola, "Rossi Mario" non poteva funzionare:
 * il cognome sta in una colonna e il nome in un'altra, nessuna delle due
 * contiene entrambe le parole.
 *
 * Qui il termine viene spezzato in parole e OGNI parola deve trovarsi in
 * ALMENO UNA delle colonne. Chiamate `.or()` successive vengono messe in AND da
 * PostgREST, che è esattamente quello che serve.
 */

const MAX_TOKENS = 4

type Orable<T> = { or: (filter: string) => T }

export function tokenize(term: string): string[] {
  return term
    .split(/[\s,;()]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2)
    .slice(0, MAX_TOKENS)
}

/** Neutralizza i caratteri jolly di LIKE, che altrimenti l'utente inserirebbe senza saperlo. */
function escapeLike(token: string) {
  return token.replace(/[%_\\]/g, ch => `\\${ch}`)
}

export function applyTextSearch<T>(query: T, term: string, columns: string[]): T {
  const tokens = tokenize(term)
  let q = query as unknown as Orable<T>
  let out = query
  for (const token of tokens) {
    const like = `%${escapeLike(token)}%`
    out = q.or(columns.map(c => `${c}.ilike.${like}`).join(','))
    q = out as unknown as Orable<T>
  }
  return out
}

/** Vero se vale la pena interrogare il server. */
export function isSearchable(term: string) {
  return tokenize(term).length > 0
}
