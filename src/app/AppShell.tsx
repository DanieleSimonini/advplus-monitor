import React, { useEffect, useRef, useState } from 'react'
import { Avatar, Icon, IconButton, type IconName } from '../ui'
import { useAuth } from '../auth/AuthProvider'
import { hrefFor, type Route, type RouteId } from '../lib/router'
import { displayName } from '../lib/format'
import type { Role } from '../lib/domain'

const GUIDEUP_LOGO = '/guideup-logo.png'
const APLUS_LOGO = '/advisoryplus-logo.svg'

type NavEntry = {
  id: RouteId
  label: string
  icon: IconName
  /** Ruoli ammessi. Assente = tutti. */
  roles?: Role[]
  section?: string
}

/**
 * Voci di menu con visibilità per ruolo.
 * Prima la barra mostrava "Admin" a chiunque: un Junior ci cliccava, otteneva
 * "Accesso negato" e imparava che l'applicazione è ostile. Quello che non puoi
 * usare non deve comparire.
 */
const NAV: NavEntry[] = [
  { id: 'today', label: 'Oggi', icon: 'sparkle' },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'leads', label: 'Lead', icon: 'leads' },
  { id: 'calendar', label: 'Calendario', icon: 'calendar' },
  { id: 'goals', label: 'Obiettivi', icon: 'target', section: 'Performance' },
  { id: 'report', label: 'Report', icon: 'report' },
  { id: 'import', label: 'Importa lead', icon: 'import', roles: ['Admin', 'Team Lead'], section: 'Gestione' },
  { id: 'admin', label: 'Utenti', icon: 'admin', roles: ['Admin'] },
]

export function navFor(role: Role | null): NavEntry[] {
  if (!role) return []
  return NAV.filter(n => !n.roles || n.roles.includes(role))
}

export function isRouteAllowed(id: RouteId, role: Role | null) {
  return navFor(role).some(n => n.id === id)
}

export function AppShell({
  route,
  onNavigate,
  title,
  subtitle,
  search,
  children,
}: {
  route: Route
  onNavigate: (id: RouteId) => void
  title: string
  subtitle?: string
  /** Ricerca globale, montata nella topbar. */
  search?: React.ReactNode
  children: React.ReactNode
}) {
  const { me, role, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const entries = navFor(role)

  // Chiude il menu utente su click esterno o Esc.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Il drawer mobile si chiude cambiando pagina.
  useEffect(() => {
    setNavOpen(false)
  }, [route.id])

  let currentSection: string | undefined

  return (
    <div className="gu-shell">
      <a className="gu-skip-link" href="#gu-main-content">
        Vai al contenuto
      </a>

      {navOpen && <div className="gu-sidebar-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}

      <aside className="gu-sidebar" data-open={navOpen} aria-label="Navigazione principale">
        <div className="gu-sidebar__brand">
          <span className="gu-plaque">
            <img src={GUIDEUP_LOGO} alt="GuideUp" className="gu-sidebar__logo" />
          </span>
        </div>

        <nav className="gu-sidebar__nav">
          {entries.map(entry => {
            const showSection = entry.section && entry.section !== currentSection
            if (entry.section) currentSection = entry.section
            return (
              <React.Fragment key={entry.id}>
                {showSection && <div className="gu-sidebar__section">{entry.section}</div>}
                <a
                  className="gu-navitem"
                  href={hrefFor(entry.id)}
                  aria-current={route.id === entry.id ? 'page' : undefined}
                  onClick={e => {
                    // Navigazione interna, ma il link resta un vero <a>:
                    // si può aprire in una nuova scheda e copiare l'indirizzo.
                    if (e.metaKey || e.ctrlKey || e.shiftKey) return
                    e.preventDefault()
                    onNavigate(entry.id)
                  }}
                >
                  <Icon name={entry.icon} size={17} className="gu-navitem__icon" />
                  <span className="gu-navitem__label">{entry.label}</span>
                </a>
              </React.Fragment>
            )
          })}
        </nav>

        <div className="gu-sidebar__footer">
          <div className="gu-sidebar__payoff">Turn process into progress.</div>
          <div className="gu-sidebar__partner">
            <span className="gu-plaque gu-plaque--sm">
              <img src={APLUS_LOGO} alt="AdvisoryPlus" />
            </span>
          </div>
        </div>
      </aside>

      <div className="gu-main">
        <header className="gu-topbar">
          <IconButton
            icon="menu"
            label="Apri il menu"
            className="gu-topbar__burger"
            onClick={() => setNavOpen(v => !v)}
          />
          <div style={{ minWidth: 0 }}>
            <div className="gu-topbar__title gu-truncate">{title}</div>
            {subtitle && <div className="gu-topbar__sub gu-truncate">{subtitle}</div>}
          </div>

          <div className="gu-spacer" />

          {search}

          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="gu-user"
              onClick={() => setMenuOpen(v => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="gu-user__meta">
                <span className="gu-user__name">{displayName(me)}</span>
                <span className="gu-user__role">{role}</span>
              </span>
              <Avatar name={displayName(me)} />
              <Icon name="chevronDown" size={14} style={{ color: 'var(--gu-text-subtle)' }} />
            </button>

            {menuOpen && (
              <div className="gu-menu" role="menu">
                <div className="gu-menu__header">
                  <div style={{ fontWeight: 600, fontSize: 'var(--gu-text-md)' }}>{displayName(me)}</div>
                  <div style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)' }}>{me?.email}</div>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="gu-menu__item gu-menu__item--danger"
                  onClick={() => {
                    setMenuOpen(false)
                    void signOut()
                  }}
                >
                  <Icon name="logout" size={15} />
                  Esci
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="gu-content" id="gu-main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  )
}

/** Intestazione di pagina con titolo, descrizione e azioni. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="gu-page-head">
      <div>
        <h1 className="gu-page-head__title">{title}</h1>
        {description && <p className="gu-page-head__desc">{description}</p>}
      </div>
      {actions && <div className="gu-row">{actions}</div>}
    </div>
  )
}
