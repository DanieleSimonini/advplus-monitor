import React, { useCallback, useContext, useEffect, useRef, useState, createContext } from 'react'
import { Button, IconButton } from './primitives'

/**
 * Modale accessibile: chiusura con Esc, click sullo sfondo, focus intrappolato
 * e restituito all'elemento che l'ha aperta, scroll di pagina bloccato.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 520,
  closeOnBackdrop = true,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
  closeOnBackdrop?: boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const restoreTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreTo.current = document.activeElement as HTMLElement | null

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const node = ref.current
    const first = node?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first || node)?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !node) return
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null)
      if (!items.length) return
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      restoreTo.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="gu-overlay"
      onMouseDown={e => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        className="gu-modal"
        style={{ ['--gu-modal-w' as string]: `${width}px` }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="gu-modal__header">
          <div style={{ minWidth: 0 }}>
            <h2 className="gu-modal__title">{title}</h2>
            {description && <p className="gu-modal__desc">{description}</p>}
          </div>
          <IconButton icon="x" label="Chiudi" onClick={onClose} />
        </header>
        <div className="gu-modal__body">{children}</div>
        {footer && <footer className="gu-modal__footer">{footer}</footer>}
      </div>
    </div>
  )
}

/* ========================================================================== */
/* Conferma — sostituisce window.confirm()                                     */
/* ========================================================================== */

type ConfirmOptions = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
}

type ConfirmState = ConfirmOptions & { resolve: (ok: boolean) => void }

const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>(async () => false)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null)

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>(resolve => setState({ ...opts, resolve })),
    [],
  )

  const close = useCallback(
    (ok: boolean) => {
      setState(s => {
        s?.resolve(ok)
        return null
      })
    },
    [],
  )

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title || ''}
        description={state?.description}
        width={440}
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              {state?.cancelLabel || 'Annulla'}
            </Button>
            <Button variant={state?.tone === 'primary' ? 'primary' : 'danger'} onClick={() => close(true)}>
              {state?.confirmLabel || 'Conferma'}
            </Button>
          </>
        }
      >
        <p style={{ color: 'var(--gu-text-muted)' }}>
          {state?.tone === 'danger' || !state?.tone
            ? 'Questa operazione non può essere annullata.'
            : 'Confermi di voler procedere?'}
        </p>
      </Modal>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  return useContext(ConfirmContext)
}
