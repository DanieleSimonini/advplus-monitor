import React, { useState } from 'react'
import Icon from './Icon'
import { Badge, Button, cx } from './primitives'

/**
 * Barra dei filtri.
 *
 * Due problemi che risolve rispetto a prima:
 *
 * 1. Su telefono i filtri erano cinque select in fila che andavano a capo,
 *    un muro sopra ogni pagina. Qui sotto i 760px stanno chiusi dietro un
 *    pulsante che dice quanti filtri sono attivi.
 * 2. Non si vedeva MAI quali filtri fossero attivi: la pagina Lead calcolava
 *    già l'elenco e lo usava solo per decidere se mostrare "Azzera". Adesso
 *    ogni filtro attivo è un chip che si toglie da solo.
 */

export function FilterBar({
  activeCount,
  onReset,
  chips,
  children,
}: {
  /** Quanti filtri si discostano dal valore predefinito. */
  activeCount: number
  onReset?: () => void
  /** Chip dei filtri attivi, mostrati sotto ai controlli. */
  chips?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <section className="gu-filterbar" aria-label="Filtri">
      <div className="gu-filterbar__toggle">
        <Button icon="filter" onClick={() => setOpen(v => !v)} aria-expanded={open}>
          Filtri
          {activeCount > 0 && <Badge tone="primary">{activeCount}</Badge>}
        </Button>
      </div>

      <div className={cx('gu-filters', 'gu-filterbar__controls')} data-open={open}>{children}</div>

      {chips && <div className="gu-filterbar__chips">{chips}</div>}

      {activeCount > 0 && onReset && (
        <div className="gu-filterbar__reset">
          <Button variant="ghost" size="sm" icon="x" onClick={onReset}>
            Azzera i filtri
          </Button>
        </div>
      )}
    </section>
  )
}

/** Chip di un filtro attivo: dice cosa sta escludendo e lo toglie con un click. */
export function ActiveFilter({ label, value, onRemove }: { label: string; value: string; onRemove: () => void }) {
  return (
    <span className="gu-active-filter">
      <span className="gu-active-filter__label">{label}:</span>
      <span className="gu-active-filter__value">{value}</span>
      <button type="button" onClick={onRemove} aria-label={`Rimuovi il filtro ${label}: ${value}`}>
        <Icon name="x" size={12} />
      </button>
    </span>
  )
}

/**
 * Conteggio dei risultati.
 * Serve a rispondere alla domanda "perché la lista è così corta": senza,
 * non si distingue un portafoglio vuoto da un filtro troppo stretto.
 */
export function ResultCount({
  shown,
  total,
  noun = 'lead',
  loading,
}: {
  shown: number
  total: number
  noun?: string
  loading?: boolean
}) {
  return (
    <span className="gu-result-count" role="status" aria-live="polite">
      {loading ? (
        'Caricamento…'
      ) : shown === total ? (
        <>
          <strong>{total}</strong> {noun}
        </>
      ) : (
        <>
          <strong>{shown}</strong> {noun} su {total}
        </>
      )}
    </span>
  )
}
