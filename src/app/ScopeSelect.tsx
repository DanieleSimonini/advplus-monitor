import { SelectField } from '../ui'
import { groupScopeOptions, parseScope, serializeScope, type Scope, type ScopeOption } from '../lib/useAdvisors'

/** Selettore "di chi sto guardando i dati", identico in tutte le pagine. */
export function ScopeSelect({
  value,
  onChange,
  options,
  label = 'Perimetro',
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
  if (options.length <= 1) {
    return (
      <div className="gu-field">
        <span className="gu-field__label">{label}</span>
        <div style={{ height: 'var(--gu-control-h)', display: 'flex', alignItems: 'center', fontWeight: 600 }}>
          I miei dati
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

/** Selettore di intervallo mensile (dal / al), usato da Dashboard e Report. */
export function MonthRange({
  from,
  to,
  onChange,
}: {
  from: string
  to: string
  onChange: (next: { from: string; to: string }) => void
}) {
  return (
    <>
      <div className="gu-field">
        <label className="gu-field__label" htmlFor="gu-month-from">
          Dal mese
        </label>
        <input
          id="gu-month-from"
          className="gu-input"
          type="month"
          value={from}
          max={to}
          onChange={e => onChange({ from: e.target.value || from, to })}
          style={{ width: 168 }}
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
          value={to}
          min={from}
          onChange={e => onChange({ from, to: e.target.value || to })}
          style={{ width: 168 }}
        />
      </div>
    </>
  )
}
