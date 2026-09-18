import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Icon, Modal, Spinner } from '../ui'
import { useDebounced } from '../lib/filters'
import { applyTextSearch, isSearchable } from '../lib/search'
import { LEAD_FIELDS, leadName, type Lead } from '../lib/domain'
import { displayName } from '../lib/format'
import { useAdvisors } from '../lib/useAdvisors'

/**
 * Ricerca globale.
 *
 * Prima per trovare un lead bisognava essere nella pagina Lead, azzerare i
 * filtri e cercare lì. Con un cliente al telefono è troppo tardi: qui si apre
 * da qualunque pagina con Ctrl/Cmd + K e si va dritti alla scheda.
 */
export function GlobalSearch({ onOpenLead }: { onOpenLead: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [rows, setRows] = useState<Lead[]>([])
  const [loading, setLoading] = useState(false)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { byUserId } = useAdvisors()
  const debounced = useDebounced(term, 250)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) {
      setTerm('')
      setRows([])
      setCursor(0)
      return
    }
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!isSearchable(debounced)) {
      setRows([])
      return
    }
    let alive = true
    setLoading(true)
    void applyTextSearch(supabase.from('leads').select(LEAD_FIELDS), debounced, [
      'last_name',
      'first_name',
      'company_name',
      'email',
      'phone',
    ])
      .limit(8)
      .then(({ data }) => {
        if (!alive) return
        setRows((data || []) as Lead[])
        setCursor(0)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [debounced])

  const hint = useMemo(() => (navigator.platform.toLowerCase().includes('mac') ? '⌘K' : 'Ctrl K'), [])

  function choose(lead: Lead) {
    setOpen(false)
    onOpenLead(lead.id)
  }

  return (
    <>
      <button type="button" className="gu-globalsearch" onClick={() => setOpen(true)}>
        <Icon name="search" size={15} />
        <span className="gu-globalsearch__label">Cerca un lead</span>
        <kbd>{hint}</kbd>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Cerca un lead" width={560}>
        <div className="gu-stack-sm">
          <div className="gu-input-group">
            <span className="gu-input-group__icon">
              <Icon name="search" size={15} />
            </span>
            <input
              ref={inputRef}
              className="gu-input"
              type="search"
              value={term}
              placeholder="Cognome, azienda, email, telefono…"
              aria-label="Cerca un lead"
              onChange={e => setTerm(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setCursor(c => Math.min(c + 1, rows.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setCursor(c => Math.max(0, c - 1))
                } else if (e.key === 'Enter' && rows[cursor]) {
                  e.preventDefault()
                  choose(rows[cursor])
                }
              }}
            />
          </div>

          {loading && <Spinner label="Ricerca in corso" />}

          {!loading && isSearchable(term) && rows.length === 0 && (
            <p style={{ color: 'var(--gu-text-subtle)', fontSize: 'var(--gu-text-sm)' }}>
              Nessun lead trovato. La ricerca guarda cognome, nome, ragione sociale, email e telefono.
            </p>
          )}

          {rows.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
              {rows.map((lead, i) => (
                <li key={lead.id}>
                  <button
                    type="button"
                    className="gu-menu__item"
                    style={{
                      minHeight: 44,
                      background: i === cursor ? 'var(--gu-primary-soft)' : undefined,
                    }}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => choose(lead)}
                  >
                    <Icon name="user" size={15} />
                    <span style={{ display: 'grid', minWidth: 0, textAlign: 'left' }}>
                      <span className="gu-truncate" style={{ fontWeight: 600 }}>
                        {leadName(lead)}
                      </span>
                      <span className="gu-truncate" style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)' }}>
                        {[lead.email || lead.phone, displayName(byUserId.get(lead.owner_id || ''), '')]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  )
}
