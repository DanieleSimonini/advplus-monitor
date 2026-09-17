import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Icon, { type IconName } from './Icon'
import { IconButton } from './primitives'

/**
 * Notifiche non bloccanti: sostituiscono alert().
 * alert() blocca il thread, non è stilabile, non dice se l'operazione è andata
 * a buon fine o no e su mobile è un incubo.
 */

type ToastTone = 'success' | 'error' | 'info'

type Toast = {
  id: number
  tone: ToastTone
  title: string
  text?: string
  duration: number
}

type ToastApi = {
  success: (title: string, text?: string) => void
  error: (title: string, text?: string) => void
  info: (title: string, text?: string) => void
}

const ICONS: Record<ToastTone, IconName> = {
  success: 'checkCircle',
  error: 'xCircle',
  info: 'info',
}

const ToastContext = createContext<ToastApi>({
  success: () => {},
  error: () => {},
  info: () => {},
})

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts(list => list.filter(t => t.id !== id))
  }, [])

  const push = useCallback((tone: ToastTone, title: string, text?: string) => {
    const id = ++seq.current
    // Gli errori restano più a lungo: vanno letti, spesso copiati.
    const duration = tone === 'error' ? 9000 : 4000
    setToasts(list => [...list.slice(-3), { id, tone, title, text, duration }])
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, text) => push('success', title, text),
      error: (title, text) => push('error', title, text),
      info: (title, text) => push('info', title, text),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="gu-toasts" role="region" aria-label="Notifiche">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), toast.duration)
    return () => clearTimeout(t)
  }, [toast.id, toast.duration, onDismiss])

  return (
    <div
      className={`gu-toast gu-toast--${toast.tone}`}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
    >
      <Icon name={ICONS[toast.tone]} size={18} className="gu-toast__icon" />
      <div className="gu-toast__body">
        <div className="gu-toast__title">{toast.title}</div>
        {toast.text && <div className="gu-toast__text">{toast.text}</div>}
      </div>
      <IconButton icon="x" label="Chiudi notifica" size="sm" onClick={() => onDismiss(toast.id)} />
    </div>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
