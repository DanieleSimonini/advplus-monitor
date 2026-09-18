import React from 'react'
import Icon, { type IconName } from './Icon'

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

/* ========================================================================== */
/* Button                                                                      */
/* ========================================================================== */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger' | 'danger-soft'

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  icon?: IconName
  iconRight?: IconName
  block?: boolean
  /** Mostra lo spinner e blocca il click: ogni azione async deve darne conto. */
  loading?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  block,
  loading,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'gu-btn',
        `gu-btn--${variant}`,
        size !== 'md' && `gu-btn--${size}`,
        block && 'gu-btn--block',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="gu-spinner" /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={size === 'sm' ? 14 : 16} /> : null}
    </button>
  )
}

/* ========================================================================== */
/* IconButton — richiede sempre un'etichetta accessibile                       */
/* ========================================================================== */

export type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  icon: IconName
  label: string
  size?: 'sm' | 'md'
  tone?: 'default' | 'danger'
}

export function IconButton({ icon, label, size = 'md', tone = 'default', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx('gu-icon-btn', size === 'sm' && 'gu-icon-btn--sm', tone === 'danger' && 'gu-icon-btn--danger', className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 14 : 16} />
    </button>
  )
}

/* ========================================================================== */
/* Badge                                                                       */
/* ========================================================================== */

export type BadgeTone = 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger'

export function Badge({
  tone = 'neutral',
  dot,
  children,
  className,
}: {
  tone?: BadgeTone
  dot?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={cx('gu-badge', `gu-badge--${tone}`, className)}>
      {dot && <span className="gu-badge__dot" />}
      {children}
    </span>
  )
}

/* ========================================================================== */
/* Avatar                                                                      */
/* ========================================================================== */

export function initialsOf(name?: string | null, fallback = '?') {
  const src = (name || '').trim()
  if (!src) return fallback
  const parts = src.split(/[\s.@_-]+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2)
  return (parts[0][0] + parts[parts.length - 1][0])
}

export function Avatar({
  name,
  size = 'md',
  tone = 'primary',
}: {
  name?: string | null
  size?: 'sm' | 'md' | 'lg'
  tone?: 'primary' | 'accent'
}) {
  return (
    <span
      className={cx('gu-avatar', size !== 'md' && `gu-avatar--${size}`, tone === 'accent' && 'gu-avatar--accent')}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  )
}

/* ========================================================================== */
/* Spinner / Skeleton                                                          */
/* ========================================================================== */

export function Spinner({ label = 'Caricamento' }: { label?: string }) {
  return (
    <span className="gu-row-tight" role="status">
      <span className="gu-spinner" />
      <span className="gu-sr-only">{label}</span>
    </span>
  )
}

export function Skeleton({ height = 16, width = '100%', radius }: { height?: number | string; width?: number | string; radius?: number }) {
  return <div className="gu-skeleton" style={{ height, width, borderRadius: radius }} aria-hidden="true" />
}

/** Placeholder di caricamento per una lista/tabella. */
export function SkeletonRows({ rows = 5, height = 44 }: { rows?: number; height?: number }) {
  return (
    <div className="gu-stack-sm" aria-hidden="true" style={{ padding: 'var(--gu-space-3)' }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} radius={8} />
      ))}
    </div>
  )
}

/* ========================================================================== */
/* Alert inline                                                                */
/* ========================================================================== */

const ALERT_ICON: Record<string, IconName> = {
  info: 'info',
  success: 'checkCircle',
  warning: 'alert',
  danger: 'xCircle',
}

export function Alert({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger'
  title?: string
  children?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className={`gu-alert gu-alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={ALERT_ICON[tone]} size={18} className="gu-alert__icon" />
      <div className="gu-alert__body">
        {title && <div className="gu-alert__title">{title}</div>}
        {children && <div>{children}</div>}
      </div>
      {action && <div style={{ marginLeft: 'auto', flex: 'none' }}>{action}</div>}
    </div>
  )
}

/* ========================================================================== */
/* Empty state                                                                 */
/* ========================================================================== */

export function EmptyState({
  icon = 'inbox',
  title,
  text,
  action,
}: {
  icon?: IconName
  title: string
  text?: string
  action?: React.ReactNode
}) {
  return (
    <div className="gu-empty">
      <div className="gu-empty__icon">
        <Icon name={icon} size={22} />
      </div>
      <div className="gu-empty__title">{title}</div>
      {text && <p className="gu-empty__text">{text}</p>}
      {action}
    </div>
  )
}

/* ========================================================================== */
/* Filtri                                                                      */
/* ========================================================================== */

export function FilterChip({
  active,
  onToggle,
  children,
  icon,
}: {
  active: boolean
  onToggle: () => void
  children: React.ReactNode
  icon?: IconName
}) {
  return (
    <button type="button" className="gu-filter-chip" aria-pressed={active} onClick={onToggle}>
      {icon ? <Icon name={icon} size={14} /> : <span className="gu-filter-chip__dot" />}
      {children}
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: { value: T; label: string; icon?: IconName }[]
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div className="gu-segmented" role="group" aria-label={ariaLabel}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          className="gu-segmented__item"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={14} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ========================================================================== */
/* Progress / Bullet                                                           */
/* ========================================================================== */

export function toneForRatio(ratio: number): 'success' | 'warning' | 'danger' {
  if (ratio >= 1) return 'success'
  if (ratio >= 0.7) return 'warning'
  return 'danger'
}

export function Progress({ ratio, label }: { ratio: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100
  return (
    <div
      className="gu-progress"
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={`gu-progress__fill gu-progress__fill--${toneForRatio(ratio)}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export { cx }
