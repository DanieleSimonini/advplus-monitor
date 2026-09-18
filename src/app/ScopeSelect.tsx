import { useState } from 'react'
import { SelectField } from '../ui'
import { groupScopeOptions, parseScope, serializeScope, type Scope, type ScopeOption } from '../lib/useAdvisors'
import { addMonths, monthKeyOf, parseMonthKey } from '../lib/datetime'

/**
 * Selettore "di chi sto guardando i dati".
 *
 * Si chiama "Advisor" e non più "Perimetro": è la parola che si usa in
 * azienda, mentre "perimetro" è gergo che non dice niente a chi apre
 * l'applicazione per la prima volta. Ed è la stessa etichetta usata dalla
 * pagina Lead e dagli Obiettivi, che prima dicevano "Assegnatario" e
 * "Advisor" per la stessa identica scelta.
 */
export function ScopeSelect({
  value,
  onChange,
  options,
  label = 'Advisor',
  hint,
}: {
  value: Scope
  onChange: (s: Scope) => void
  options: ScopeOption[]
  label?: string
  hint?: string
}) {
  const { flat, groups } = groupScopeOptions(options)

  // Con una sola opzione (Junior) la select non serve: mostriamo il dato secco.
  // L'etichetta del valore è la stessa dell'opzione equivalente per gli altri
  // ruoli, non una terza formula ("I miei dati") come prima.
  if (options.length <= 1) {
    return (
      <div className="gu-field">
        <span className="gu-field__label">{label}</span>
        <div style={{ height: 'var(--gu-control-h)', display: 'flex', alignItems: 'center', fontWeight: 600 }}>
          Solo me
        </div>
      </div>
    )
  }

  return (
    <SelectField
      label={label}
      hint={hint}
      value={serializeScope(value)}
      onChange={e => onChange(parseScope(e.target.value))}
      style={{ minWidth: 200 }}
    >
      {flat.map(o => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {groups.map(([group, items]) => (
        <optgroup key={group} label={group}>
          {items.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </SelectField>
  )
}

/* ========================================================================== */
/* Periodo                                                                     */
/* ========================================================================== */

export type Period = { from: string; to: string }

/**
 * Scorciatoie di periodo. Prima si potevano impostare solo i due estremi a
 * mano: per guardare "quest'anno" servivano due menu a tendina e sei click.
 */
export const PERIOD_PRESETS = [
  { value: 'mese', label: 'Mese corrente' },
  { value: 'trimestre', label: 'Ultimi 3 mesi' },
  { value: 'anno', label: "Anno in corso" },
  { value: 'dodici', label: 'Ultimi 12 mesi' },
  { value: 'custom', label: 'Personalizzato…' },
] as const

export type PeriodPreset = (typeof PERIOD_PRESETS)[number]['value']

export function periodFromPreset(preset: PeriodPreset, today = new Date()): Period {
  const now = monthKeyOf(today)
  switch (preset) {
    case 'mese':
      return { from: now, to: now }
    case 'trimestre':
      return { from: addMonths(now, -2), to: now }
    case 'anno':
      return { from: `${today.getFullYear()}-01`, to: now }
    case 'dodici':
      return { from: addMonths(now, -11), to: now }
    default:
      return { from: addMonths(now, -5), to: now }
  }
}

/** Riconosce se il periodo corrente corrisponde a una delle scorciatoie. */
export function presetOf(period: Period, today = new Date()): PeriodPreset {
  for (const p of PERIOD_PRESETS) {
    if (p.value === 'custom') continue
    const candidate = periodFromPreset(p.value, today)
    if (candidate.from === period.from && candidate.to === period.to) return p.value
  }
  return 'custom'
}

export function serializePeriod(p: Period) {
  return p.from === p.to ? p.from : `${p.from}_${p.to}`
}

export function parsePeriod(raw: string | undefined, fallback: Period): Period {
  if (!raw) return fallback
  const [from, to] = raw.split('_')
  const valid = (v?: string) => !!v && /^\d{4}-\d{2}$/.test(v) && parseMonthKey(v).month >= 1 && parseMonthKey(v).month <= 12
  if (!valid(from)) return fallback
  return { from, to: valid(to) ? to : from }
}

/** Selettore di periodo: scorciatoie più i due estremi quando servono. */
export function PeriodSelect({ value, onChange }: { value: Period; onChange: (next: Period) => void }) {
  // Se il periodo corrente non coincide con nessuna scorciatoia siamo già in
  // "personalizzato"; `forced` copre il caso opposto, cioè l'utente che sceglie
  // Personalizzato partendo da un periodo che invece coinciderebbe.
  const [forced, setForced] = useState(false)
  const preset = forced ? 'custom' : presetOf(value)

  return (
    <>
      <SelectField
        label="Periodo"
        value={preset}
        onChange={e => {
          const next = e.target.value as PeriodPreset
          if (next === 'custom') {
            setForced(true)
            return
          }
          setForced(false)
          onChange(periodFromPreset(next))
        }}
        style={{ minWidth: 165 }}
      >
        {PERIOD_PRESETS.map(p => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </SelectField>

      {preset === 'custom' && (
        <>
          <div className="gu-field">
            <label className="gu-field__label" htmlFor="gu-month-from">
              Dal mese
            </label>
            <input
              id="gu-month-from"
              className="gu-input"
              type="month"
              value={value.from}
              max={value.to}
              onChange={e => onChange({ from: e.target.value || value.from, to: value.to })}
              style={{ width: 160 }}
            />
          </div>
          <div className="gu-field">
            <label className="gu-field__label" htmlFor="gu-month-to">
              Al mese
            </label>
            <input
              id="gu-month-to"
              className="gu-input"
              type="month"
              value={value.to}
              min={value.from}
              onChange={e => onChange({ from: value.from, to: e.target.value || value.to })}
              style={{ width: 160 }}
            />
          </div>
        </>
      )}
    </>
  )
}
