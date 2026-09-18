/**
 * Gestione date e ore — punto unico di verità.
 *
 * Perché esiste questo file: prima ogni pagina convertiva le date a modo suo.
 * In alcuni punti il valore grezzo di <input type="datetime-local"> finiva nel
 * database così com'era (quindi senza fuso, interpretato come UTC da Postgres),
 * in altri passava da new Date(x).toISOString() (quindi convertito davvero).
 * Risultato: lo stesso campo `ts` conteneva due semantiche diverse e gli
 * appuntamenti risultavano spostati di un'ora o due a seconda di dove erano
 * stati inseriti. Da qui in avanti si passa sempre e solo da queste funzioni.
 */

const TS_INVALID = 'Data/ora non valida'

/** Valore per <input type="datetime-local"> a partire da un timestamp ISO. */
export function toLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Valore per <input type="date"> a partire da un timestamp ISO. */
export function toDateInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Converte il valore di <input type="datetime-local"> in ISO UTC.
 * Lancia se il valore è vuoto o non valido: prima il codice faceva
 * `new Date(x).toISOString() || fallback`, ma || non intercetta mai niente
 * perché toISOString() su una data non valida solleva RangeError.
 */
export function fromLocalInput(value: string): string {
  const d = new Date(value)
  if (!value || Number.isNaN(d.getTime())) throw new Error(TS_INVALID)
  return d.toISOString()
}

/** Come fromLocalInput ma con fallback esplicito su "adesso". */
export function fromLocalInputOrNow(value: string): string {
  try {
    return fromLocalInput(value)
  } catch {
    return new Date().toISOString()
  }
}

/** Vero se il valore del campo è compilato e rappresenta una data valida. */
export function isValidLocalInput(value: string): boolean {
  return !!value && !Number.isNaN(new Date(value).getTime())
}

/**
 * ISO con offset esplicito (+02:00), richiesto dalle Edge Function email
 * per costruire l'ICS nell'ora locale corretta.
 */
export function toIsoWithOffset(d: Date): string {
  const offsetMin = d.getTimezoneOffset()
  const sign = offsetMin > 0 ? '-' : '+'
  const abs = Math.abs(offsetMin)
  const pad = (n: number) => String(Math.floor(n)).padStart(2, '0')
  const base = new Date(d.getTime() - offsetMin * 60_000).toISOString().slice(0, 19)
  return `${base}${sign}${pad(abs / 60)}:${pad(abs % 60)}`
}

/* ------------------------------------------------------------------------ */
/* Mesi e intervalli                                                         */
/* ------------------------------------------------------------------------ */

export type MonthKey = string // 'YYYY-MM'

export function monthKeyOf(d: Date): MonthKey {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function addMonths(key: MonthKey, delta: number): MonthKey {
  const [y, m] = key.split('-').map(Number)
  return monthKeyOf(new Date(y, m - 1 + delta, 1))
}

export function parseMonthKey(key: MonthKey): { year: number; month: number } {
  const [y, m] = key.split('-').map(Number)
  return { year: y, month: m }
}

/** Intervallo [start, end) in ISO che copre interamente i mesi indicati. */
export function monthRangeIso(from: MonthKey, to: MonthKey): { start: string; end: string } {
  const a = parseMonthKey(from)
  const b = parseMonthKey(to)
  return {
    start: new Date(a.year, a.month - 1, 1).toISOString(),
    end: new Date(b.year, b.month, 1).toISOString(),
  }
}

/**
 * Stesso intervallo ma in formato 'YYYY-MM-DD'.
 * Serve per proposals.ts e contracts.ts che sono colonne `date`, non
 * `timestamptz`: confrontarle con un ISO completo funziona solo per coercizione
 * e sui bordi del mese può includere o escludere un giorno di troppo.
 */
export function monthRangeDate(from: MonthKey, to: MonthKey): { start: string; end: string } {
  const a = parseMonthKey(from)
  const b = parseMonthKey(to)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { start: fmt(new Date(a.year, a.month - 1, 1)), end: fmt(new Date(b.year, b.month, 1)) }
}

export function listMonths(from: MonthKey, to: MonthKey): { year: number; month: number; key: MonthKey }[] {
  const a = parseMonthKey(from)
  const b = parseMonthKey(to)
  const out: { year: number; month: number; key: MonthKey }[] = []
  let y = a.year
  let m = a.month
  // Limite di sicurezza: evita di generare migliaia di righe se l'utente
  // scrive a mano un intervallo assurdo nel campo mese.
  while ((y < b.year || (y === b.year && m <= b.month)) && out.length < 120) {
    out.push({ year: y, month: m, key: `${y}-${String(m).padStart(2, '0')}` })
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

/* ------------------------------------------------------------------------ */
/* Giorni                                                                    */
/* ------------------------------------------------------------------------ */

export function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
export function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
/** Lunedì come primo giorno della settimana (convenzione italiana). */
export function startOfWeek(d: Date) {
  const x = startOfDay(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}
export function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
export function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
