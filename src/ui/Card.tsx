import React from 'react'
import Icon, { type IconName } from './Icon'
import { cx } from './primitives'

export function Card({
  children,
  className,
  interactive,
  style,
}: {
  children: React.ReactNode
  className?: string
  interactive?: boolean
  style?: React.CSSProperties
}) {
  return (
    <section className={cx('gu-card', interactive && 'gu-card--interactive', className)} style={style}>
      {children}
    </section>
  )
}

export function CardHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  icon?: IconName
}) {
  return (
    <header className="gu-card__header">
      <div className="gu-row-tight" style={{ gap: 'var(--gu-space-2)', minWidth: 0 }}>
        {icon && <Icon name={icon} size={16} style={{ color: 'var(--gu-text-subtle)' }} />}
        <div style={{ minWidth: 0 }}>
          <h2 className="gu-card__title">{title}</h2>
          {subtitle && <div className="gu-card__subtitle">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="gu-row" style={{ flexWrap: 'nowrap' }}>{actions}</div>}
    </header>
  )
}

export function CardBody({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cx('gu-card__body', className)} style={style}>
      {children}
    </div>
  )
}

export function CardFooter({ children }: { children: React.ReactNode }) {
  return <footer className="gu-card__footer">{children}</footer>
}

/* ========================================================================== */
/* Stat / KPI                                                                  */
/* ========================================================================== */

export function Stat({
  label,
  value,
  hint,
  tone,
  icon,
  loading,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'primary' | 'accent' | 'warning' | 'danger'
  icon?: IconName
  loading?: boolean
}) {
  return (
    <div className={cx('gu-stat', tone && `gu-stat--${tone}`)}>
      <div className="gu-stat__label">
        {icon && <Icon name={icon} size={13} />}
        {label}
      </div>
      {loading ? (
        <div className="gu-skeleton" style={{ height: 30, width: '60%', borderRadius: 6 }} aria-hidden="true" />
      ) : (
        <div className="gu-stat__value">{value}</div>
      )}
      {hint && <div className="gu-stat__hint">{hint}</div>}
    </div>
  )
}
