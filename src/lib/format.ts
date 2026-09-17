const nf = new Intl.NumberFormat('it-IT')
const nfCompact = new Intl.NumberFormat('it-IT', { notation: 'compact', maximumFractionDigits: 1 })
const cf = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const cfCents = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })
const dtLong = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' })
const dtDate = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' })
const dtDay = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
const dtTime = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']

export const formatNumber = (n: number) => nf.format(n || 0)
export const formatCompact = (n: number) => nfCompact.format(n || 0)
export const formatCurrency = (n: number) => cf.format(n || 0)
export const formatCurrencyCents = (n: number) => cfCents.format(n || 0)

export function formatPercent(n: number, digits = 1) {
  return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: digits }).format(n || 0)}%`
}

/** Ratio (0..n) formattato come percentuale, con trattino se non calcolabile. */
export function formatRatio(actual: number, target: number, digits = 0) {
  if (!target) return '—'
  return formatPercent((actual / target) * 100, digits)
}

export function formatDateTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dtLong.format(d)
}

export function formatDate(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dtDate.format(d)
}

export function formatTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dtTime.format(d)
}

export function formatFullDay(d: Date) {
  return dtDay.format(d)
}

/** Etichetta compatta per asse temporale: 'set 25'. */
export function monthLabel(year: number, month: number) {
  return `${MONTHS[month - 1]} ${String(year).slice(2)}`
}

/** "3 giorni fa", "tra 2 ore" — per capire a colpo d'occhio quanto è vecchio un dato. */
export function relativeTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const diffMs = d.getTime() - Date.now()
  const abs = Math.abs(diffMs)
  const rtf = new Intl.RelativeTimeFormat('it-IT', { numeric: 'auto' })
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000000],
    ['month', 2592000000],
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
  ]
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diffMs / ms), unit)
  }
  return 'adesso'
}

/** Nome visualizzabile di una persona, con fallback sensati. */
export function displayName(p?: { full_name?: string | null; email?: string | null } | null, fallback = '—') {
  if (!p) return fallback
  const n = (p.full_name || '').trim()
  if (n) return n
  return (p.email || '').trim() || fallback
}

/** Cella CSV: quota sempre, raddoppia le virgolette, neutralizza le formule. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""'
  let s = String(value)
  // Una cella che inizia con = + - @ viene eseguita come formula da Excel:
  // è la classica CSV injection quando i dati arrivano da un campo libero.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const body = [
    headers.map(csvCell).join(';'),
    ...rows.map(r => headers.map(h => csvCell(r[h])).join(';')),
  ].join('\r\n')
  // BOM: senza, Excel in italiano rompe gli accenti.
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Messaggio leggibile da un errore Supabase o da un throw qualunque. */
export function errorMessage(e: unknown, fallback = 'Si è verificato un errore'): string {
  if (!e) return fallback
  if (typeof e === 'string') return e
  const any = e as { message?: string; error_description?: string; details?: string; hint?: string }
  return any.message || any.error_description || any.details || any.hint || fallback
}
