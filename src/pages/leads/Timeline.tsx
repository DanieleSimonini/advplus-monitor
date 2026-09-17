import React from 'react'
import { Badge, Button, EmptyState, Icon, IconButton, type BadgeTone, type IconName } from '../../ui'
import { formatDateTime, relativeTime } from '../../lib/format'

/**
 * Elenco cronologico di eventi collegati a un lead.
 *
 * Le cinque schede della scheda lead (contatti, appuntamenti, promemoria,
 * proposte, contratti) erano cinque blocchi quasi identici copiati e incollati,
 * con piccole differenze di comportamento nate per errore. Ora la parte comune
 * — form in testa, elenco, modifica in linea, eliminazione — sta qui.
 */

export type TimelineItem = {
  id: string
  ts: string
  title: string
  meta?: React.ReactNode
  notes?: string | null
  tone?: BadgeTone
  badge?: string
  icon?: IconName
}

export function Timeline({
  items,
  loading,
  emptyTitle,
  emptyText,
  onEdit,
  onDelete,
  editingId,
}: {
  items: TimelineItem[]
  loading?: boolean
  emptyTitle: string
  emptyText: string
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  editingId: string | null
}) {
  if (loading) {
    return (
      <div className="gu-stack-sm" aria-hidden="true">
        {[0, 1, 2].map(i => (
          <div key={i} className="gu-skeleton" style={{ height: 58, borderRadius: 10 }} />
        ))}
      </div>
    )
  }

  if (!items.length) {
    return <EmptyState icon="clock" title={emptyTitle} text={emptyText} />
  }

  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--gu-space-2)' }}>
      {items.map(item => (
        <li
          key={item.id}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--gu-space-3)',
            padding: 'var(--gu-space-3)',
            border: '1px solid',
            borderColor: editingId === item.id ? 'var(--gu-primary)' : 'var(--gu-border)',
            background: editingId === item.id ? 'var(--gu-primary-soft)' : 'var(--gu-surface)',
            borderRadius: 'var(--gu-radius-md)',
          }}
        >
          {item.icon && (
            <span
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 30,
                height: 30,
                flex: 'none',
                borderRadius: 'var(--gu-radius-md)',
                background: 'var(--gu-n-100)',
                color: 'var(--gu-text-muted)',
              }}
            >
              <Icon name={item.icon} size={15} />
            </span>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="gu-row" style={{ gap: 'var(--gu-space-2)' }}>
              <span style={{ fontWeight: 600, fontSize: 'var(--gu-text-md)' }}>{item.title}</span>
              {item.badge && <Badge tone={item.tone || 'neutral'}>{item.badge}</Badge>}
            </div>
            <div style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)' }}>
              <time dateTime={item.ts}>{formatDateTime(item.ts)}</time>
              <span aria-hidden="true"> · </span>
              {relativeTime(item.ts)}
              {item.meta && (
                <>
                  <span aria-hidden="true"> · </span>
                  {item.meta}
                </>
              )}
            </div>
            {item.notes && (
              <p style={{ fontSize: 'var(--gu-text-sm)', color: 'var(--gu-text-muted)', marginTop: 4 }}>{item.notes}</p>
            )}
          </div>

          <div className="gu-row-tight" style={{ flex: 'none' }}>
            <IconButton icon="edit" label="Modifica" size="sm" onClick={() => onEdit(item.id)} />
            <IconButton icon="trash" label="Elimina" size="sm" tone="danger" onClick={() => onDelete(item.id)} />
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Riquadro del form in cima alla scheda, con stato "nuovo" o "in modifica". */
export function TimelineForm({
  editing,
  onSubmit,
  onCancel,
  submitLabel,
  saving,
  disabled,
  children,
}: {
  editing: boolean
  onSubmit: () => void
  onCancel: () => void
  submitLabel: string
  saving?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        onSubmit()
      }}
      style={{
        display: 'grid',
        gap: 'var(--gu-space-3)',
        padding: 'var(--gu-space-3)',
        background: 'var(--gu-n-25)',
        border: '1px solid var(--gu-border)',
        borderRadius: 'var(--gu-radius-md)',
      }}
    >
      {children}
      <div className="gu-row" style={{ justifyContent: 'flex-end' }}>
        {editing && (
          <Button variant="ghost" onClick={onCancel}>
            Annulla
          </Button>
        )}
        <Button type="submit" variant="primary" icon={editing ? 'check' : 'plus'} loading={saving} disabled={disabled}>
          {editing ? 'Salva modifiche' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
