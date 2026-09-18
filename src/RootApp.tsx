import { useEffect } from 'react'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { ConfirmProvider, EmptyState, Spinner, ToastProvider } from './ui'
import { AppShell, isRouteAllowed, navFor } from './app/AppShell'
import { useRoute, type RouteId } from './lib/router'
import LoginPage, { NoProfilePage } from './pages/Login'
import ResetPasswordPage from './pages/ResetPassword'
import DashboardPage from './pages/Dashboard'
import LeadsPage from './pages/Leads'
import CalendarPage from './pages/Calendar'
import GoalsPage from './pages/Goals'
import ReportPage from './pages/Report'
import ImportLeadsPage from './pages/ImportLeads'
import AdminUsersPage from './pages/AdminUsers'

const PAGE_META: Record<RouteId, { title: string; subtitle?: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'Andamento della pipeline' },
  leads: { title: 'Lead', subtitle: 'Anagrafiche e attività commerciali' },
  calendar: { title: 'Calendario', subtitle: 'Appuntamenti della rete' },
  goals: { title: 'Obiettivi', subtitle: 'Target annuali e mensili' },
  report: { title: 'Report', subtitle: 'Risultati a confronto con gli obiettivi' },
  import: { title: 'Importa lead', subtitle: 'Caricamento massivo da file CSV' },
  admin: { title: 'Utenti', subtitle: 'Gestione della rete e degli inviti' },
}

export default function RootApp() {
  // La pagina di reset password arriva da un link email su /reset e deve
  // funzionare prima di qualunque controllo di profilo.
  if (typeof window !== 'undefined' && window.location.pathname === '/reset') {
    return (
      <ToastProvider>
        <ResetPasswordPage />
      </ToastProvider>
    )
  }

  return (
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthenticatedApp />
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  )
}

function AuthenticatedApp() {
  const { status, role, signOut } = useAuth()
  const [route, go] = useRoute()

  // Se l'URL punta a una sezione non consentita per il ruolo, riportiamo alla
  // prima voce disponibile invece di mostrare "Accesso negato".
  useEffect(() => {
    if (status.state !== 'ready') return
    if (!isRouteAllowed(route.id, role)) {
      const first = navFor(role)[0]
      if (first) go(first.id, null, true)
    }
  }, [status.state, route.id, role, go])

  useEffect(() => {
    const meta = PAGE_META[route.id]
    document.title = meta ? `${meta.title} · GuideUp` : 'GuideUp'
  }, [route.id])

  if (status.state === 'loading') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', gap: 12 }}>
        <img src="/guideup-logo.png" alt="GuideUp" style={{ height: 34, width: 'auto' }} />
        <Spinner label="Caricamento della sessione" />
      </div>
    )
  }

  if (status.state === 'anonymous') return <LoginPage />
  if (status.state === 'unprovisioned') return <NoProfilePage email={status.email} onSignOut={() => void signOut()} />

  const meta = PAGE_META[route.id]
  const allowed = isRouteAllowed(route.id, role)

  return (
    <AppShell route={route} onNavigate={go} title={meta.title} subtitle={meta.subtitle}>
      {!allowed ? (
        <EmptyState
          icon="shield"
          title="Sezione non disponibile"
          text="Il tuo ruolo non ha accesso a questa sezione. Ti stiamo riportando alla dashboard."
        />
      ) : (
        <PageBody route={route.id} param={route.param} onNavigate={go} />
      )}
    </AppShell>
  )
}

function PageBody({
  route,
  param,
  onNavigate,
}: {
  route: RouteId
  param: string | null
  onNavigate: (id: RouteId, param?: string | null, replace?: boolean) => void
}) {
  switch (route) {
    case 'dashboard':
      return <DashboardPage onOpenLeads={() => onNavigate('leads')} />
    case 'leads':
      return <LeadsPage selectedId={param} onSelect={id => onNavigate('leads', id, true)} />
    case 'calendar':
      return <CalendarPage onOpenLead={id => onNavigate('leads', id)} />
    case 'goals':
      return <GoalsPage />
    case 'report':
      return <ReportPage />
    case 'import':
      return <ImportLeadsPage onDone={() => onNavigate('leads')} />
    case 'admin':
      return <AdminUsersPage />
    default:
      return null
  }
}
