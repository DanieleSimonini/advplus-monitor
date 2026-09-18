import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Icon,
  IconButton,
  Modal,
  SearchInput,
  SelectField,
  SkeletonRows,
  TextField,
  useConfirm,
  useToast,
} from '../ui'
import { PageHeader } from '../app/AppShell'
import { useAuth } from '../auth/AuthProvider'
import { ADVISOR_FIELDS, ROLES, isActiveAdvisor, roleTone, type Advisor, type Role } from '../lib/domain'
import { displayName, errorMessage } from '../lib/format'

type Draft = {
  id: string | null
  full_name: string
  email: string
  role: Role
  team_lead_user_id: string
}

const EMPTY_DRAFT: Draft = { id: null, full_name: '', email: '', role: 'Junior', team_lead_user_id: '' }

export default function AdminUsersPage() {
  const { me } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()

  const [rows, setRows] = useState<Advisor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | ''>('')
  // Prima le tre statistiche in cima segnalavano un problema (utenti
  // disattivati, utenti mai entrati) senza dare il modo di guardarlo: non
  // c'era nessun filtro di stato e i disattivati restavano mescolati agli altri.
  const [statusFilter, setStatusFilter] = useState<'tutti' | 'attivi' | 'disattivati' | 'attesa'>('tutti')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [inviting, setInviting] = useState<string | null>(null)
  const [reassign, setReassign] = useState<{ advisor: Advisor; count: number; to: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error } = await supabase.from('advisors').select(ADVISOR_FIELDS).order('full_name', { ascending: true })
      if (error) throw error
      setRows((data || []) as Advisor[])
    } catch (e) {
      setError(errorMessage(e, 'Impossibile caricare gli utenti'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const teamLeads = useMemo(() => rows.filter(r => (r.role === 'Team Lead' || r.role === 'Admin') && r.user_id), [rows])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter(r => {
      if (roleFilter && r.role !== roleFilter) return false
      if (statusFilter === 'attivi' && !isActiveAdvisor(r)) return false
      if (statusFilter === 'disattivati' && isActiveAdvisor(r)) return false
      if (statusFilter === 'attesa' && r.user_id) return false
      if (!term) return true
      return `${r.full_name || ''} ${r.email}`.toLowerCase().includes(term)
    })
  }, [rows, search, roleFilter, statusFilter])

  const stats = useMemo(
    () => ({
      total: rows.length,
      active: rows.filter(isActiveAdvisor).length,
      pending: rows.filter(r => !r.user_id).length,
    }),
    [rows],
  )

  function nameOfUser(userId?: string | null) {
    if (!userId) return '—'
    const a = rows.find(r => r.user_id === userId)
    return a ? displayName(a) : '—'
  }

  /**
   * Invio dell'invito.
   *
   * La versione precedente chiamava la Edge Function con una fetch manuale
   * passando la chiave anonima come Bearer: la funzione riceveva quindi un
   * token che non identifica nessuno e non poteva verificare che a invitare
   * fosse davvero un Admin. `functions.invoke` allega il JWT dell'utente
   * collegato, che è quello che serve per fare i controlli lato server.
   */
  async function sendInvite(payload: { email: string; role: Role; full_name?: string }) {
    const attempts: string[] = ['invite', 'smtp_invite']
    const failures: string[] = []
    for (const fn of attempts) {
      try {
        const { error } = await supabase.functions.invoke(fn, { body: payload })
        if (error) throw error
        return fn
      } catch (e) {
        failures.push(`${fn}: ${errorMessage(e)}`)
      }
    }
    throw new Error(failures.join(' — '))
  }

  async function invite(advisor: Advisor) {
    setInviting(advisor.id)
    try {
      await sendInvite({ email: advisor.email, role: advisor.role, full_name: advisor.full_name || undefined })
      toast.success('Invito inviato', advisor.email)
    } catch (e) {
      toast.error('Invio non riuscito', errorMessage(e))
    } finally {
      setInviting(null)
    }
  }

  async function save() {
    if (!draft) return
    const email = draft.email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Indirizzo email non valido')
      return
    }
    if (draft.role === 'Junior' && !draft.team_lead_user_id) {
      toast.error('Un Junior deve avere un responsabile', 'Serve per calcolare i dati di team.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        full_name: draft.full_name.trim() || null,
        email,
        role: draft.role,
        team_lead_user_id: draft.team_lead_user_id || null,
      }

      if (draft.id) {
        const { error } = await supabase.from('advisors').update(payload).eq('id', draft.id)
        if (error) throw error
        toast.success('Utente aggiornato')
      } else {
        if (rows.some(r => r.email.toLowerCase() === email)) {
          throw new Error('Esiste già un utente con questa email')
        }
        const { error } = await supabase.from('advisors').insert(payload)
        if (error) throw error
        try {
          await sendInvite({ email, role: draft.role, full_name: payload.full_name || undefined })
          toast.success('Utente creato e invito inviato', email)
        } catch (e) {
          toast.error('Utente creato, ma invito non inviato', errorMessage(e))
        }
      }
      setDraft(null)
      await load()
    } catch (e) {
      toast.error('Salvataggio non riuscito', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  /** Disattiva senza cancellare: i dati storici restano attribuiti. */
  async function toggleActive(advisor: Advisor) {
    const disabling = isActiveAdvisor(advisor)
    const ok = await confirm({
      title: disabling ? `Disattivare ${displayName(advisor)}?` : `Riattivare ${displayName(advisor)}?`,
      description: disabling
        ? "L'utente non potrà più accedere e sparirà dai filtri, ma lead, appuntamenti e produzione restano collegati a lui."
        : "L'utente tornerà operativo e visibile nei filtri.",
      confirmLabel: disabling ? 'Disattiva' : 'Riattiva',
      tone: disabling ? 'danger' : 'primary',
    })
    if (!ok) return
    try {
      const { error } = await supabase
        .from('advisors')
        .update({ is_active: !disabling, disabled: disabling })
        .eq('id', advisor.id)
      if (error) throw error
      toast.success(disabling ? 'Utente disattivato' : 'Utente riattivato')
      await load()
    } catch (e) {
      toast.error('Operazione non riuscita', errorMessage(e))
    }
  }

  async function requestDelete(advisor: Advisor) {
    if (advisor.user_id && advisor.user_id === me?.user_id) {
      toast.error('Non puoi eliminare il tuo stesso profilo')
      return
    }
    try {
      let count = 0
      if (advisor.user_id) {
        const res = await supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('owner_id', advisor.user_id)
        if (res.error) throw res.error
        count = res.count || 0
      }

      if (count > 0) {
        setReassign({ advisor, count, to: '' })
        return
      }

      const ok = await confirm({
        title: `Eliminare ${displayName(advisor)}?`,
        description: 'Il profilo verrà rimosso definitivamente. Per conservare lo storico usa invece la disattivazione.',
        confirmLabel: 'Elimina',
      })
      if (!ok) return

      const { error } = await supabase.from('advisors').delete().eq('id', advisor.id)
      if (error) throw error
      toast.success('Utente eliminato')
      await load()
    } catch (e) {
      toast.error('Eliminazione non riuscita', errorMessage(e))
    }
  }

  async function confirmReassign() {
    if (!reassign || !reassign.to) return
    try {
      const { error: updErr } = await supabase
        .from('leads')
        .update({ owner_id: reassign.to })
        .eq('owner_id', reassign.advisor.user_id!)
      if (updErr) throw updErr

      const { error: delErr } = await supabase.from('advisors').delete().eq('id', reassign.advisor.id)
      if (delErr) throw delErr

      toast.success(`${reassign.count} lead riassegnati`, 'Profilo eliminato')
      setReassign(null)
      await load()
    } catch (e) {
      toast.error('Operazione non riuscita', errorMessage(e))
    }
  }

  const orphanJuniors = rows.filter(r => r.role === 'Junior' && !r.team_lead_user_id && isActiveAdvisor(r))

  return (
    <>
      <PageHeader
        title="Utenti"
        description="Advisor della rete, ruoli, responsabili e inviti."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            Nuovo utente
          </Button>
        }
      />

      {/* Le statistiche sono anche i filtri: si clicca il numero e si vede chi c'è dietro. */}
      <div className="gu-grid gu-grid--3">
        <StatFilter
          label="Utenti totali"
          value={stats.total}
          active={statusFilter === 'tutti'}
          onClick={() => setStatusFilter('tutti')}
        />
        <StatFilter
          label="Attivi"
          value={stats.active}
          active={statusFilter === 'attivi'}
          onClick={() => setStatusFilter(s => (s === 'attivi' ? 'tutti' : 'attivi'))}
        />
        <StatFilter
          label="In attesa del primo accesso"
          value={stats.pending}
          active={statusFilter === 'attesa'}
          onClick={() => setStatusFilter(s => (s === 'attesa' ? 'tutti' : 'attesa'))}
        />
      </div>

      {error && <Alert tone="danger" title="Errore">{error}</Alert>}

      {orphanJuniors.length > 0 && (
        <Alert tone="warning" title={`${orphanJuniors.length} Junior senza responsabile`}>
          I loro dati non rientrano in nessun team e non compaiono nei report di squadra:{' '}
          {orphanJuniors.map(j => displayName(j)).join(', ')}.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Rete commerciale"
          subtitle={`${filtered.length} utenti visualizzati`}
          icon="users"
          actions={
            <div className="gu-row" style={{ flexWrap: 'nowrap' }}>
              <div style={{ width: 220 }}>
                <SearchInput label="Cerca" value={search} onValueChange={setSearch} placeholder="Nome o email" />
              </div>
              <SelectField label="Ruolo" value={roleFilter} onChange={e => setRoleFilter(e.target.value as Role | '')}>
                <option value="">Tutti</option>
                {ROLES.map(r => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Stato"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
              >
                <option value="tutti">Tutti</option>
                <option value="attivi">Solo attivi</option>
                <option value="disattivati">Solo disattivati</option>
                <option value="attesa">Mai entrati</option>
              </SelectField>
            </div>
          }
        />
        <CardBody style={{ padding: 0 }}>
          {loading ? (
            <SkeletonRows rows={5} />
          ) : filtered.length === 0 ? (
            <EmptyState icon="users" title="Nessun utente trovato" text="Prova a modificare i criteri di ricerca." />
          ) : (
            <div className="gu-table-wrap">
              <table className="gu-table">
                <thead>
                  <tr>
                    <th scope="col">Utente</th>
                    <th scope="col">Ruolo</th>
                    <th scope="col">Responsabile</th>
                    <th scope="col">Stato</th>
                    <th scope="col" className="gu-table__actions">
                      Azioni
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(a => {
                    const active = isActiveAdvisor(a)
                    return (
                      <tr key={a.id} style={active ? undefined : { opacity: 0.6 }}>
                        <td>
                          <div className="gu-row-tight" style={{ gap: 'var(--gu-space-2)' }}>
                            <Avatar name={displayName(a)} tone={a.role === 'Junior' ? 'accent' : 'primary'} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600 }} className="gu-truncate">
                                {displayName(a)}
                              </div>
                              <div
                                style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)' }}
                                className="gu-truncate"
                              >
                                {a.email}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <Badge tone={roleTone(a.role)}>{a.role}</Badge>
                        </td>
                        <td style={{ fontSize: 'var(--gu-text-sm)' }}>{nameOfUser(a.team_lead_user_id)}</td>
                        <td>
                          {!active ? (
                            <Badge tone="neutral" dot>
                              Disattivato
                            </Badge>
                          ) : !a.user_id ? (
                            <Badge tone="warning" dot>
                              Invito da accettare
                            </Badge>
                          ) : (
                            <Badge tone="success" dot>
                              Attivo
                            </Badge>
                          )}
                        </td>
                        <td className="gu-table__actions">
                          <div className="gu-row-tight" style={{ justifyContent: 'flex-end' }}>
                            <IconButton
                              icon="send"
                              label={`Invia invito a ${a.email}`}
                              size="sm"
                              disabled={inviting === a.id}
                              onClick={() => void invite(a)}
                            />
                            <IconButton
                              icon="edit"
                              label={`Modifica ${displayName(a)}`}
                              size="sm"
                              onClick={() =>
                                setDraft({
                                  id: a.id,
                                  full_name: a.full_name || '',
                                  email: a.email,
                                  role: a.role,
                                  team_lead_user_id: a.team_lead_user_id || '',
                                })
                              }
                            />
                            <IconButton
                              icon={active ? 'pause' : 'play'}
                              label={active ? `Disattiva ${displayName(a)}` : `Riattiva ${displayName(a)}`}
                              size="sm"
                              onClick={() => void toggleActive(a)}
                            />
                            <IconButton
                              icon="trash"
                              label={`Elimina ${displayName(a)}`}
                              size="sm"
                              tone="danger"
                              onClick={() => void requestDelete(a)}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Creazione / modifica */}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Modifica utente' : 'Nuovo utente'}
        description={draft?.id ? undefined : "Alla creazione viene inviato automaticamente l'invito via email."}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Annulla
            </Button>
            <Button variant="primary" icon="check" onClick={save} loading={saving}>
              {draft?.id ? 'Salva' : 'Crea e invita'}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="gu-stack">
            <TextField
              label="Nome e cognome"
              value={draft.full_name}
              onChange={e => setDraft({ ...draft, full_name: e.target.value })}
              autoComplete="name"
            />
            <TextField
              label="Email"
              type="email"
              required
              value={draft.email}
              onChange={e => setDraft({ ...draft, email: e.target.value })}
              hint={draft.id ? "Modifica l'anagrafica, non l'indirizzo usato per accedere." : undefined}
            />
            <SelectField
              label="Ruolo"
              value={draft.role}
              onChange={e => setDraft({ ...draft, role: e.target.value as Role })}
            >
              {ROLES.map(r => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Responsabile"
              required={draft.role === 'Junior'}
              value={draft.team_lead_user_id}
              onChange={e => setDraft({ ...draft, team_lead_user_id: e.target.value })}
              hint="Determina in quale team confluiscono i dati di questo advisor."
            >
              <option value="">— Nessuno —</option>
              {teamLeads
                .filter(t => t.id !== draft.id)
                .map(t => (
                  <option key={t.user_id!} value={t.user_id!}>
                    {displayName(t)} ({t.role})
                  </option>
                ))}
            </SelectField>
            {draft.role === 'Junior' && !draft.team_lead_user_id && (
              <Alert tone="warning">
                Senza responsabile questo Junior non comparirà in nessun report di team.
              </Alert>
            )}
          </div>
        )}
      </Modal>

      {/* Riassegnazione lead prima dell'eliminazione */}
      <Modal
        open={!!reassign}
        onClose={() => setReassign(null)}
        title="Riassegna i lead prima di eliminare"
        description={
          reassign
            ? `${displayName(reassign.advisor)} ha ${reassign.count} lead in carico. Scegli a chi passarli.`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setReassign(null)}>
              Annulla
            </Button>
            <Button variant="danger" onClick={confirmReassign} disabled={!reassign?.to}>
              Riassegna ed elimina
            </Button>
          </>
        }
      >
        {reassign && (
          <div className="gu-stack">
            <Alert tone="info">
              Se vuoi solo togliere l'accesso senza spostare nulla, chiudi questa finestra e usa la{' '}
              <strong>disattivazione</strong>: lo storico resta attribuito alla persona corretta.
            </Alert>
            <SelectField
              label="Nuovo assegnatario"
              required
              value={reassign.to}
              onChange={e => setReassign({ ...reassign, to: e.target.value })}
            >
              <option value="">— Seleziona —</option>
              {rows
                .filter(r => r.user_id && r.user_id !== reassign.advisor.user_id && isActiveAdvisor(r))
                .map(r => (
                  <option key={r.user_id!} value={r.user_id!}>
                    {displayName(r)} — {r.role}
                  </option>
                ))}
            </SelectField>
          </div>
        )}
      </Modal>

      <Alert tone="info" title="Come funziona l'accesso">
        <span className="gu-row-tight" style={{ gap: 6 }}>
          <Icon name="info" size={14} />
          L'utente creato qui riceve un invito via email e imposta la password al primo accesso. Finché non accede, lo
          stato resta «Invito da accettare».
        </span>
      </Alert>
    </>
  )
}

/** Riquadro statistico che è anche un filtro: il numero si clicca. */
function StatFilter({
  label,
  value,
  active,
  onClick,
}: {
  label: string
  value: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="gu-statfilter"
      data-active={active}
      aria-pressed={active}
      onClick={onClick}
    >
      <span style={{ color: 'var(--gu-text-subtle)', fontSize: 'var(--gu-text-sm)', textAlign: 'left' }}>{label}</span>
      <strong style={{ fontSize: 'var(--gu-text-xl)' }}>{value}</strong>
    </button>
  )
}
