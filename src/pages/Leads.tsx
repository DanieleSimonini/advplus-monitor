import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Icon,
  Pagination,
  SearchInput,
  SelectField,
  SkeletonRows,
  useConfirm,
  useToast,
} from '../ui'
import { PageHeader } from '../app/AppShell'
import { useAuth } from '../auth/AuthProvider'
import { useAdvisors } from '../lib/useAdvisors'
import { fetchAllPages, inChunks, uniq } from '../lib/db'
import { LEAD_FIELDS, leadName, type Lead } from '../lib/domain'
import { displayName, downloadCsv, errorMessage, formatCurrency, relativeTime } from '../lib/format'
import {
  LeadDetail,
  emptyLeadForm,
  leadToForm,
  validateLead,
  type LeadFormErrors,
  type LeadFormState,
} from './leads/LeadDetail'

const PAGE_SIZE = 25

type Stage = 'all' | 'none' | 'contacted' | 'appointment' | 'proposal' | 'contract'

const STAGE_OPTIONS: { value: Stage; label: string }[] = [
  { value: 'all', label: 'Tutti gli stadi' },
  { value: 'none', label: 'Mai contattati' },
  { value: 'contacted', label: 'Contattati' },
  { value: 'appointment', label: 'Con appuntamento' },
  { value: 'proposal', label: 'Con proposta' },
  { value: 'contract', label: 'Con contratto' },
]

const STAGE_TABLE: Record<Exclude<Stage, 'all' | 'none'>, 'activities' | 'appointments' | 'proposals' | 'contracts'> = {
  contacted: 'activities',
  appointment: 'appointments',
  proposal: 'proposals',
  contract: 'contracts',
}

type SortKey = 'last_name' | 'first_name' | 'created_desc' | 'last_activity'

const SORT_OPTIONS: { value: SortKey; label: string; aggregate?: boolean }[] = [
  { value: 'last_name', label: 'Cognome (A → Z)' },
  { value: 'first_name', label: 'Nome (A → Z)' },
  { value: 'created_desc', label: 'Caricati di recente' },
  { value: 'last_activity', label: 'Contattati di recente', aggregate: true },
]

type Aggregate = {
  contacts: number
  appointments: number
  proposals: number
  contracts: number
  production: number
  lastContact?: string
}

export default function LeadsPage({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const { me, isAdmin, isTeamLead } = useAuth()
  const { visible: advisors, byUserId } = useAdvisors()
  const toast = useToast()
  const confirm = useConfirm()

  const canAssign = isAdmin || isTeamLead

  // --- filtri ---
  const [ownerFilter, setOwnerFilter] = useState('')
  const [stage, setStage] = useState<Stage>('all')
  const [onlyWorking, setOnlyWorking] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('last_name')
  const [page, setPage] = useState(1)

  // --- dati ---
  const [rows, setRows] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [aggregates, setAggregates] = useState<Record<string, Aggregate>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  // --- scheda ---
  const [selected, setSelected] = useState<Lead | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<LeadFormState>(() => emptyLeadForm(me?.user_id || null))
  const [formErrors, setFormErrors] = useState<LeadFormErrors>({})
  const [saving, setSaving] = useState(false)

  const requestId = useRef(0)

  // La ricerca aspetta che l'utente smetta di scrivere: prima ogni tasto
  // scatenava un ricalcolo completo della lista.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [ownerFilter, stage, onlyWorking, debouncedSearch, sort])

  const needsFullScan = stage !== 'all' || SORT_OPTIONS.find(s => s.value === sort)?.aggregate === true

  const load = useCallback(async () => {
    const rid = ++requestId.current
    setLoading(true)
    setError('')
    try {
      let pageRows: Lead[] = []
      let count = 0

      if (!needsFullScan) {
        const base = () => {
          let q = supabase.from('leads').select(LEAD_FIELDS, { count: 'exact' })
          if (ownerFilter) q = q.eq('owner_id', ownerFilter)
          if (onlyWorking) q = q.eq('is_working', true)
          if (debouncedSearch) q = q.or(searchFilter(debouncedSearch))
          return applySort(q, sort)
        }
        const from = (page - 1) * PAGE_SIZE
        const { data, count: c, error } = await base().range(from, from + PAGE_SIZE - 1)
        if (error) throw error
        pageRows = (data || []) as Lead[]
        count = c || 0
      } else {
        // Filtro per stadio o ordinamento per ultima attività: serve l'insieme
        // completo degli id prima di poter impaginare. Si scaricano solo gli id,
        // non le righe intere.
        const candidates = await fetchAllPages<{ id: string }>(() => {
          let q = supabase.from('leads').select('id')
          if (ownerFilter) q = q.eq('owner_id', ownerFilter)
          if (onlyWorking) q = q.eq('is_working', true)
          if (debouncedSearch) q = q.or(searchFilter(debouncedSearch))
          return q as never
        })
        const candidateIds = candidates.map(c => c.id)

        let keep = candidateIds
        let lastActivity = new Map<string, string>()

        if (stage === 'none' || stage === 'contacted' || sort === 'last_activity') {
          const acts = await inChunks(candidateIds, slice =>
            fetchAllPages<{ lead_id: string; ts: string }>(
              () => supabase.from('activities').select('lead_id,ts').in('lead_id', slice) as never,
            ),
          )
          lastActivity = latestByLead(acts)
          if (stage === 'none') keep = candidateIds.filter(id => !lastActivity.has(id))
          if (stage === 'contacted') keep = candidateIds.filter(id => lastActivity.has(id))
        }

        if (stage === 'appointment' || stage === 'proposal' || stage === 'contract') {
          const table = STAGE_TABLE[stage]
          const child = await inChunks(candidateIds, slice =>
            fetchAllPages<{ lead_id: string }>(
              () => supabase.from(table).select('lead_id').in('lead_id', slice) as never,
            ),
          )
          const withStage = new Set(uniq(child.map(c => c.lead_id)))
          keep = candidateIds.filter(id => withStage.has(id))
        }

        count = keep.length

        if (sort === 'last_activity') {
          keep = [...keep].sort((a, b) => (lastActivity.get(b) || '').localeCompare(lastActivity.get(a) || ''))
        }

        const from = (page - 1) * PAGE_SIZE
        const pageIds = keep.slice(from, from + PAGE_SIZE)
        if (pageIds.length) {
          const { data, error } = await supabase.from('leads').select(LEAD_FIELDS).in('id', pageIds)
          if (error) throw error
          const byId = new Map((data || []).map(r => [(r as Lead).id, r as Lead]))
          const ordered = pageIds.map(id => byId.get(id)).filter((x): x is Lead => !!x)
          pageRows = sort === 'last_activity' ? ordered : sortClient(ordered, sort)
        }
      }

      if (rid !== requestId.current) return // risposta sorpassata da una più recente
      setRows(pageRows)
      setTotal(count)
      setAggregates(await loadAggregates(pageRows.map(r => r.id)))
    } catch (e) {
      if (rid !== requestId.current) return
      setError(errorMessage(e, 'Impossibile caricare i lead'))
      setRows([])
      setTotal(0)
    } finally {
      if (rid === requestId.current) setLoading(false)
    }
  }, [ownerFilter, stage, onlyWorking, debouncedSearch, sort, page, needsFullScan])

  useEffect(() => {
    void load()
  }, [load])

  // Un lead richiamato dall'URL (#/leads/<id>) viene caricato anche se non è
  // nella pagina corrente della lista.
  useEffect(() => {
    if (!selectedId) {
      setSelected(null)
      return
    }
    const inPage = rows.find(r => r.id === selectedId)
    if (inPage) {
      setSelected(inPage)
      setForm(leadToForm(inPage))
      setCreating(false)
      return
    }
    let alive = true
    void supabase
      .from('leads')
      .select(LEAD_FIELDS)
      .eq('id', selectedId)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive || !data) return
        setSelected(data as Lead)
        setForm(leadToForm(data as Lead))
        setCreating(false)
      })
    return () => {
      alive = false
    }
  }, [selectedId, rows])

  function startCreate() {
    setCreating(true)
    setSelected(null)
    setFormErrors({})
    setForm(emptyLeadForm(canAssign ? null : me?.user_id || null))
    onSelect(null)
  }

  async function saveLead() {
    const errors = validateLead(form)
    setFormErrors(errors)
    if (Object.keys(errors).length) {
      toast.error('Controlla i campi evidenziati')
      return
    }
    setSaving(true)
    try {
      const payload = {
        owner_id: form.owner_id || me?.user_id || null,
        is_agency_client: form.is_agency_client,
        first_name: form.first_name.trim() || null,
        last_name: form.last_name.trim() || null,
        company_name: form.company_name.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        city: form.city.trim() || null,
        address: form.address.trim() || null,
        source: form.source || null,
        is_working: form.is_working,
      }

      if (selected) {
        const { error } = await supabase.from('leads').update(payload).eq('id', selected.id)
        if (error) throw error
        toast.success('Lead aggiornato')
      } else {
        const { data, error } = await supabase.from('leads').insert(payload).select(LEAD_FIELDS).single()
        if (error) throw error
        toast.success('Lead creato', 'Ora puoi registrare contatti e appuntamenti.')
        setCreating(false)
        onSelect((data as Lead).id)
      }
      await load()
    } catch (e) {
      toast.error('Salvataggio non riuscito', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function deleteLead() {
    if (!selected) return
    const ok = await confirm({
      title: `Eliminare ${leadName(selected)}?`,
      description: 'Verranno eliminati anche contatti, appuntamenti, proposte e contratti collegati.',
      confirmLabel: 'Elimina definitivamente',
    })
    if (!ok) return
    try {
      const { error } = await supabase.from('leads').delete().eq('id', selected.id)
      if (error) throw error
      toast.success('Lead eliminato')
      onSelect(null)
      setSelected(null)
      await load()
    } catch (e) {
      toast.error('Eliminazione non riuscita', errorMessage(e))
    }
  }

  async function exportCsv() {
    setExporting(true)
    try {
      const all = await fetchAllPages<Lead>(() => {
        let q = supabase.from('leads').select(LEAD_FIELDS)
        if (ownerFilter) q = q.eq('owner_id', ownerFilter)
        if (onlyWorking) q = q.eq('is_working', true)
        if (debouncedSearch) q = q.or(searchFilter(debouncedSearch))
        return q as never
      })
      const aggs = await loadAggregates(all.map(l => l.id))
      downloadCsv(
        `guideup_lead_${new Date().toISOString().slice(0, 10)}.csv`,
        all.map(l => {
          const a = aggs[l.id]
          return {
            Assegnatario: displayName(byUserId.get(l.owner_id || '')),
            Nome: l.first_name || '',
            Cognome: l.last_name || '',
            'Ragione sociale': l.company_name || '',
            Email: l.email || '',
            Telefono: l.phone || '',
            Città: l.city || '',
            Indirizzo: l.address || '',
            'Già cliente': l.is_agency_client ? 'Sì' : 'No',
            Fonte: l.source || '',
            'In lavorazione': (l.is_working ?? true) ? 'Sì' : 'No',
            'Caricato il': l.created_at || '',
            Contatti: a?.contacts || 0,
            'Ultimo contatto': a?.lastContact || '',
            Appuntamenti: a?.appointments || 0,
            Proposte: a?.proposals || 0,
            Contratti: a?.contracts || 0,
            'Produzione €': a?.production || 0,
          }
        }),
      )
      toast.success('Esportazione completata', `${all.length} lead esportati`)
    } catch (e) {
      toast.error('Esportazione non riuscita', errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  const activeFilters = [ownerFilter && 'assegnatario', stage !== 'all' && 'stadio', !onlyWorking && 'sospesi', debouncedSearch && 'ricerca'].filter(Boolean)
  const showDetail = !!selected || creating

  return (
    <>
      <PageHeader
        title="Lead"
        description="Anagrafiche, attività e stato di avanzamento del portafoglio."
        actions={
          <>
            <Button icon="download" onClick={exportCsv} loading={exporting}>
              Esporta
            </Button>
            <Button variant="primary" icon="plus" onClick={startCreate}>
              Nuovo lead
            </Button>
          </>
        }
      />

      <div className="gu-filters">
        <div className="gu-filters__group gu-filters__group--grow" style={{ maxWidth: 320 }}>
          <SearchInput
            label="Cerca"
            value={search}
            onValueChange={setSearch}
            placeholder="Cognome, nome, azienda, email…"
          />
        </div>

        {canAssign && (
          <SelectField
            label="Assegnatario"
            value={ownerFilter}
            onChange={e => setOwnerFilter(e.target.value)}
            style={{ minWidth: 170 }}
          >
            <option value="">Tutti</option>
            {advisors
              .filter(a => a.user_id)
              .map(a => (
                <option key={a.user_id!} value={a.user_id!}>
                  {displayName(a)}
                </option>
              ))}
          </SelectField>
        )}

        <SelectField label="Stadio" value={stage} onChange={e => setStage(e.target.value as Stage)} style={{ minWidth: 165 }}>
          {STAGE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>

        <SelectField label="Stato" value={onlyWorking ? 'working' : 'all'} onChange={e => setOnlyWorking(e.target.value === 'working')} style={{ minWidth: 155 }}>
          <option value="working">Solo in lavorazione</option>
          <option value="all">Inclusi i sospesi</option>
        </SelectField>

        <SelectField label="Ordina per" value={sort} onChange={e => setSort(e.target.value as SortKey)} style={{ minWidth: 185 }}>
          {SORT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>

        {activeFilters.length > 0 && (
          <Button
            variant="ghost"
            icon="x"
            onClick={() => {
              setOwnerFilter('')
              setStage('all')
              setOnlyWorking(true)
              setSearch('')
              setSort('last_name')
            }}
          >
            Azzera filtri
          </Button>
        )}
      </div>

      {error && <Alert tone="danger" title="Errore">{error}</Alert>}

      <div className="gu-leads">
        <div className={`gu-leads__list${showDetail ? ' gu-leads__list--hidden-mobile' : ''}`}>
          <Card className="gu-leads__card">
            {loading ? (
              <SkeletonRows rows={6} height={64} />
            ) : rows.length === 0 ? (
              <EmptyState
                icon="leads"
                title={activeFilters.length ? 'Nessun lead con questi filtri' : 'Nessun lead in portafoglio'}
                text={
                  activeFilters.length
                    ? 'Prova ad allargare la ricerca o ad azzerare i filtri.'
                    : 'Crea il primo lead oppure importa un elenco da file CSV.'
                }
                action={
                  <Button variant="primary" icon="plus" onClick={startCreate}>
                    Nuovo lead
                  </Button>
                }
              />
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 'var(--gu-space-2)', display: 'grid', gap: 4 }}>
                {rows.map(lead => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    aggregate={aggregates[lead.id]}
                    owner={displayName(byUserId.get(lead.owner_id || ''), '')}
                    selected={selected?.id === lead.id}
                    onClick={() => {
                      setCreating(false)
                      setFormErrors({})
                      onSelect(lead.id)
                    }}
                  />
                ))}
              </ul>
            )}
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} loading={loading} />
          </Card>
        </div>

        <div className={`gu-leads__detail${showDetail ? '' : ' gu-leads__detail--hidden-mobile'}`}>
          {showDetail ? (
            <>
              <div className="gu-leads__back">
                <Button
                  variant="ghost"
                  icon="chevronLeft"
                  onClick={() => {
                    setCreating(false)
                    onSelect(null)
                  }}
                >
                  Torna all'elenco
                </Button>
              </div>
              <LeadDetail
                lead={selected}
                form={form}
                onFormChange={patch => setForm(f => ({ ...f, ...patch }))}
                errors={formErrors}
                onSave={saveLead}
                onCancel={() => {
                  setCreating(false)
                  onSelect(null)
                }}
                onDelete={deleteLead}
                saving={saving}
                assignableAdvisors={advisors}
                canAssign={canAssign}
                advisorsByUserId={byUserId}
              />
            </>
          ) : (
            <Card>
              <CardBody>
                <EmptyState
                  icon="user"
                  title="Seleziona un lead"
                  text="Scegli un lead dall'elenco per vedere anagrafica, contatti, appuntamenti, proposte e contratti."
                />
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

/* ========================================================================== */
/* Riga dell'elenco                                                            */
/* ========================================================================== */

function LeadRow({
  lead,
  aggregate,
  owner,
  selected,
  onClick,
}: {
  lead: Lead
  aggregate?: Aggregate
  owner: string
  selected: boolean
  onClick: () => void
}) {
  const stale = !aggregate?.contacts
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={selected ? 'true' : undefined}
        style={{
          display: 'grid',
          gap: 4,
          width: '100%',
          textAlign: 'left',
          padding: 'var(--gu-space-3)',
          border: '1px solid',
          borderColor: selected ? 'var(--gu-primary)' : 'transparent',
          background: selected ? 'var(--gu-primary-soft)' : 'transparent',
          borderRadius: 'var(--gu-radius-md)',
          transition: 'background-color var(--gu-duration) var(--gu-ease)',
        }}
        onMouseEnter={e => {
          if (!selected) e.currentTarget.style.background = 'var(--gu-n-50)'
        }}
        onMouseLeave={e => {
          if (!selected) e.currentTarget.style.background = 'transparent'
        }}
      >
        <div className="gu-row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontWeight: 600 }} className="gu-truncate">
            {leadName(lead)}
          </span>
          {lead.is_working === false && <Badge tone="neutral">Sospeso</Badge>}
          {lead.is_agency_client && <Badge tone="accent">Cliente</Badge>}
        </div>

        <div className="gu-row-tight" style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)', gap: 6 }}>
          <Icon name={lead.email ? 'mail' : 'phone'} size={12} />
          <span className="gu-truncate">{lead.email || lead.phone || 'Nessun recapito'}</span>
          {owner && (
            <>
              <span aria-hidden="true">·</span>
              <span className="gu-truncate">{owner}</span>
            </>
          )}
        </div>

        <div className="gu-row-tight" style={{ gap: 6, fontSize: 'var(--gu-text-xs)' }}>
          {stale ? (
            <Badge tone="warning" dot>
              Mai contattato
            </Badge>
          ) : (
            <span style={{ color: 'var(--gu-text-subtle)' }}>
              Ultimo contatto {relativeTime(aggregate?.lastContact)}
            </span>
          )}
          {!!aggregate?.appointments && <Badge tone="primary">{aggregate.appointments} app.</Badge>}
          {!!aggregate?.proposals && <Badge tone="neutral">{aggregate.proposals} prop.</Badge>}
          {!!aggregate?.contracts && <Badge tone="success">{formatCurrency(aggregate.production)}</Badge>}
        </div>
      </button>
    </li>
  )
}

/* ========================================================================== */
/* Query di supporto                                                           */
/* ========================================================================== */

/** Ricerca su più colonne. Le virgole vanno rimosse: spezzerebbero il filtro or(). */
function searchFilter(term: string) {
  const safe = term.replace(/[,()]/g, ' ').trim()
  const like = `%${safe}%`
  return ['last_name', 'first_name', 'company_name', 'email', 'phone'].map(c => `${c}.ilike.${like}`).join(',')
}

function applySort<T>(q: T, sort: SortKey): T {
  const query = q as unknown as {
    order: (col: string, opts: { ascending: boolean; nullsFirst?: boolean }) => T
  }
  switch (sort) {
    case 'first_name':
      return query.order('first_name', { ascending: true, nullsFirst: false })
    case 'created_desc':
      return query.order('created_at', { ascending: false })
    case 'last_name':
    default:
      return query.order('last_name', { ascending: true, nullsFirst: false })
  }
}

function sortClient(rows: Lead[], sort: SortKey) {
  const collator = new Intl.Collator('it')
  return [...rows].sort((a, b) => {
    if (sort === 'created_desc') return (b.created_at || '').localeCompare(a.created_at || '')
    if (sort === 'first_name') return collator.compare(a.first_name || '', b.first_name || '')
    return collator.compare(a.last_name || '', b.last_name || '')
  })
}

function latestByLead(rows: { lead_id: string; ts: string }[]) {
  const map = new Map<string, string>()
  for (const r of rows) {
    const cur = map.get(r.lead_id)
    if (!cur || r.ts > cur) map.set(r.lead_id, r.ts)
  }
  return map
}

/** Aggregati dei soli lead mostrati: poche decine di id, una manciata di query. */
async function loadAggregates(leadIds: string[]): Promise<Record<string, Aggregate>> {
  if (!leadIds.length) return {}
  const [acts, apps, props, ctrs] = await Promise.all([
    inChunks(leadIds, s => fetchAllPages<any>(() => supabase.from('activities').select('lead_id,ts').in('lead_id', s) as never)),
    inChunks(leadIds, s => fetchAllPages<any>(() => supabase.from('appointments').select('lead_id').in('lead_id', s) as never)),
    inChunks(leadIds, s => fetchAllPages<any>(() => supabase.from('proposals').select('lead_id').in('lead_id', s) as never)),
    inChunks(leadIds, s =>
      fetchAllPages<any>(() => supabase.from('contracts').select('lead_id,amount,premium_annual').in('lead_id', s) as never),
    ),
  ])

  const out: Record<string, Aggregate> = {}
  const ensure = (id: string) =>
    (out[id] ||= { contacts: 0, appointments: 0, proposals: 0, contracts: 0, production: 0 })

  for (const r of acts) {
    const a = ensure(r.lead_id)
    a.contacts++
    if (!a.lastContact || r.ts > a.lastContact) a.lastContact = r.ts
  }
  for (const r of apps) ensure(r.lead_id).appointments++
  for (const r of props) ensure(r.lead_id).proposals++
  for (const r of ctrs) {
    const a = ensure(r.lead_id)
    a.contracts++
    a.production += Number(r.amount ?? r.premium_annual ?? 0)
  }
  return out
}
