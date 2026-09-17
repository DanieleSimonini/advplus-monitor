import React, { useId } from 'react'
import Icon, { type IconName } from './Icon'
import { cx } from './primitives'

/**
 * Campi form con label sempre visibile e collegata (mai solo placeholder),
 * hint ed errore annunciati via aria-describedby.
 */

type FieldProps = {
  label: string
  hint?: string
  error?: string | null
  required?: boolean
  className?: string
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode
}

export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cx('gu-field', className)}>
      <label className="gu-field__label" htmlFor={id}>
        {label}
        {required && (
          <span className="gu-field__required" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && !error && (
        <span className="gu-field__hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="gu-field__error" id={errId}>
          <Icon name="alert" size={13} />
          {error}
        </span>
      )}
    </div>
  )
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cx('gu-input', className)} {...rest} />
  },
)

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cx('gu-select', className)} {...rest}>
        {children}
      </select>
    )
  },
)

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx('gu-textarea', className)} {...rest} />
  },
)

/** Campo testo con label + input in un colpo solo (il caso più frequente). */
export function TextField({
  label,
  hint,
  error,
  required,
  className,
  ...input
}: {
  label: string
  hint?: string
  error?: string | null
  required?: boolean
  className?: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <Input id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} required={required} {...input} />
      )}
    </Field>
  )
}

export function SelectField({
  label,
  hint,
  error,
  required,
  className,
  children,
  ...select
}: {
  label: string
  hint?: string
  error?: string | null
  required?: boolean
  className?: string
  children: React.ReactNode
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <Select id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} {...select}>
          {children}
        </Select>
      )}
    </Field>
  )
}

export function TextareaField({
  label,
  hint,
  error,
  className,
  ...area
}: {
  label: string
  hint?: string
  error?: string | null
  className?: string
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy, invalid }) => (
        <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} {...area} />
      )}
    </Field>
  )
}

/** Input di ricerca con icona e pulsante "pulisci". */
export function SearchInput({
  value,
  onValueChange,
  placeholder = 'Cerca…',
  label,
  id: idProp,
}: {
  value: string
  onValueChange: (v: string) => void
  placeholder?: string
  label: string
  id?: string
}) {
  const autoId = useId()
  const id = idProp || autoId
  return (
    <div className="gu-field">
      <label className="gu-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="gu-input-group">
        <span className="gu-input-group__icon">
          <Icon name="search" size={15} />
        </span>
        <Input
          id={id}
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={e => onValueChange(e.target.value)}
        />
        {value && (
          <button
            type="button"
            className="gu-icon-btn gu-icon-btn--sm gu-input-group__clear"
            aria-label="Cancella ricerca"
            onClick={() => onValueChange('')}
          >
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: React.ReactNode
  disabled?: boolean
}) {
  return (
    <label className={cx('gu-check', disabled && 'gu-check--disabled')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function RadioGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  error,
  required,
}: {
  label: string
  value: T | null
  options: { value: T; label: string; icon?: IconName }[]
  onChange: (v: T) => void
  error?: string | null
  required?: boolean
}) {
  const name = useId()
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 'var(--gu-space-1)' }}>
      <legend className="gu-field__label" style={{ padding: 0 }}>
        {label}
        {required && (
          <span className="gu-field__required" aria-hidden="true">
            *
          </span>
        )}
      </legend>
      <div className="gu-row" style={{ gap: 'var(--gu-space-4)' }}>
        {options.map(o => (
          <label key={o.value} className="gu-check">
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {error && (
        <span className="gu-field__error">
          <Icon name="alert" size={13} />
          {error}
        </span>
      )}
    </fieldset>
  )
}
