import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import {
  ActiveFilter,
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  FilterBar,
  Icon,
  IconButton,
  Modal,
  Pagination,
  ResultCount,
  SearchInput,
  SelectField,
  SkeletonRows,
  useConfirm,
  useToast,
} from '../ui'
import { PageHeader } from '../app/AppShell'
import { ScopeSelect } from '../app/ScopeSelect'
import { useScopeParam } from '../app/ScopeProvider'
import { useAuth } from '../auth/AuthProvider'
import { useAdvisors } from '../lib/useAdvisors'
import { useDebounced, useFilters } from '../lib/filters'
import type { NavigateFn, Route } from '../lib/router'
import { fetchAllPages } from '../lib/db'
import { daysSinceContact, loadAggregates, type Aggregate, type Aggregates } from '../lib/leadAggregates'
import {
  CLIENT_OPTIONS,
  CONTACT_AGE_OPTIONS,
  LEAD_FIELDS,
  OUTCOMES,
  PROGRESS_BY_VALUE,
  PROGRESS_STEPS,
  SORT_OPTIONS,
  SOURCE_OPTIONS,
  WORKING_OPTIONS,
  leadName,
  progressOf,
  type Lead,
  type Progress,
  type SortKey,
} from '../lib/domain'
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

const FILTER_DEFAULTS = {
  q: '',
  chi: '',
  avanzamento: 'tutti',
  lavorazione: 'attivi',
  contatto: 'sempre',
  fonte: 'tutte',
  cliente: 'tutti',
  ordina: 'cognome',
  pagina: '1',
}

type FilterKey = keyof typeof FILTER_DEFAULTS

/** Etichette dei chip: dicono cosa sta escludendo un filtro, non il suo codice. */
const CHIP_LABEL: Partial<Record<FilterKey, string>> = {
  q: 'Ricerca',
  avanzamento: 'Avanzamento',
  lavorazione: 'Lavorazione',
  contatto: 'Ultimo contatto',
  fonte: 'Fonte',
  cliente: 'Cliente',
}

function chipValue(key: FilterKey, value: string): string {
  switch (key) {
    case 'avanzamento':
      return PROGRESS_BY_VALUE.get(value as Progress)?.label || value
    case 'lavorazione':
      return WORKING_OPTIONS.find(o => o.value === value)?.label || value
    case 'contatto':
      return CONTACT_AGE_OPTIONS.find(o => o.value === value)?.label || value
    case 'fonte':
      return SOURCE_OPTIONS.find(o => o.value === value)?.label || value
    case 'cliente':
      return CLIENT_OPTIONS.find(o => o.value === value)?.label || value
    default:
      return value
  }
}

export default function LeadsPage({
  route,
  go,
  selectedId,
  onSelect,
}: {
  route: Route
  go: NavigateFn
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const { me, isAdmin, isTeamLead } = useAuth()
  const { visible: advisors, byUserId, resolveScope, scopeOptions } = useAdvisors()
  const { scope, setScope } = useScopeParam(route, go)
  const toast = useToast()
  const confirm = useConfirm()

  const canAssign = isAdmin || isTeamLead

  const filters = useFilters<FilterKey>(route, go, FILTER_DEFAULTS)
  const f = filters.values

  // La ricerca è l'unico filtro con uno stato locale: scrive nell'indirizzo
  // solo quando l'utente smette di digitare, altrimenti ogni tasto premuto
  // lascerebbe una voce in cronologia.
  const [searchDraft, setSearchDraft] = useState(f.q)
  const debouncedSearch = useDebounced(searchDraft, 350)
  useEffect(() => {
    if (debouncedSearch !== f.q) filters.patch({ q: debouncedSearch, pagina: '1' })
  }, [debouncedSearch])
  useEffect(() => {
    // Ritorno indietro col browser: il campo deve seguire l'indirizzo.
    setSearchDraft(current => (current === f.q ? current : f.q))
  }, [f.q])

  const page = Math.max(1, Number(f.pagina) || 1)
  const sort = (SORT_OPTIONS.find(o => o.value === f.ordina)?.value || 'cognome') as SortKey
  const ownerIds = useMemo(() => (scope ? resolveScope(scope) : []), [scope, resolveScope])
  const ownerKey = ownerIds.join(',')

  const [rows, setRows] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [totalUnfiltered, setTotalUnfiltered] = useState(0)
  const [aggregates, setAggregates] = useState<Aggregates>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [selection, setSelection] = useState<Set<string>>(new Set())

  const [selected, setSelected] = useState<Lead | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<LeadFormState>(() => emptyLeadForm(me?.user_id || null))
  const [formErrors, setFormErrors] = useState<LeadFormErrors>({})
  const [saving, setSaving] = useState(false)

  const requestId = useRef(0)

  /**
   * I filtri "avanzamento" e "ultimo contatto", e gli ordinamenti che leggono
   * l'attività, non si possono risolvere con una sola query: servono i conteggi
   * di tutti i candidati prima di poter impaginare.
   */
  const needsAggregates =
    f.avanzamento !== 'tutti' ||
    f.contatto !== 'sempre' ||
    SORT_OPTIONS.find(o => o.value === sort)?.needsAggregates === true

  const applyBaseFilters = useCallback(
    <Q,>(query: Q): Q => {
      let q = query as unknown as {
        in: (c: string, v: string[]) => typeof q
        eq: (c: string, v: unknown) => typeof q
        or: (v: string) => typeof q
      }
      if (ownerIds.length) q = q.in('owner_id', ownerIds)
      if (f.lavorazione === 'attivi') q = q.eq('is_working', true)
      else if (f.lavorazione === 'sospesi') q = q.eq('is_working', false)
      if (f.fonte !== 'tutte') q = q.eq('source', f.fonte)
      if (f.cliente !== 'tutti') q = q.eq('is_agency_client', f.cliente === 'si')
      if (f.q) q = q.or(searchFilter(f.q))
      return q as unknown as Q
    },
    [ownerKey, f.lavorazione, f.fonte, f.cliente, f.q],
  )

  const load = useCallback(async () => {
    const rid = ++requestId.current
    if (!ownerIds.length) {
      setRows([])
      setTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      let pageRows: Lead[] = []
      let count = 0
      let pageAggregates: Aggregates = {}

      if (!needsAggregates) {
        const from = (page - 1) * PAGE_SIZE
        const { data, count: c, error } = await applySort(
          applyBaseFilters(supabase.from('leads').select(LEAD_FIELDS, { count: 'exact' })),
          sort,
        ).range(from, from + PAGE_SIZE - 1)
        if (error) throw error
        pageRows = (data || []) as Lead[]
        count = c || 0
        pageAggregates = await loadAggregates(pageRows.map(r => r.id))
      } else {
        // Si scaricano i soli id, ma ORDINATI lato server: prima venivano letti
        // senza `order` e poi ordinati solo i 25 della pagina, quindi con un
        // filtro attivo la pagina 2 poteva contenere cognomi che vengono prima
        // di quelli della pagina 1. L'ordinamento sembrava funzionare perché
        // ogni schermata era ordinata al proprio interno.
        const candidates = await fetchAllPages<{ id: string }>(() =>
          applySort(applyBaseFilters(supabase.from('leads').select('id')), sort) as never,
        )
        const candidateIds = candidates.map(c => c.id)
        const aggs = await loadAggregates(candidateIds)

        const now = Date.now()
        const minDays = CONTACT_AGE_OPTIONS.find(o => o.value === f.contatto)?.days || 0

        let keep = candidateIds.filter(id => {
          const a = aggs[id]
          if (f.avanzamento !== 'tutti' && progressOf(a) !== f.avanzamento) return false
          if (minDays > 0) {
            const days = daysSinceContact(a, now)
            // Mai contattato = fermo da sempre: deve comparire fra i trascurati.
            if (days !== null && days < minDays) return false
          }
          return true
        })

        if (sort === 'contatto' || sort === 'trascurati') {
          const key = (id: string) => aggs[id]?.lastContact || ''
          keep = [...keep].sort((a, b) =>
            sort === 'contatto'
              ? key(b).localeCompare(key(a))
              : // "Da ricontattare": i più fermi in cima, e chi non è mai stato
                // contattato è il più fermo di tutti.
                key(a).localeCompare(key(b)),
          )
        }

        count = keep.length
        const from = (page - 1) * PAGE_SIZE
        const pageIds = keep.slice(from, from + PAGE_SIZE)
        if (pageIds.length) {
          const { data, error } = await supabase.from('leads').select(LEAD_FIELDS).in('id', pageIds)
          if (error) throw error
          const byId = new Map((data || []).map(r => [(r as Lead).id, r as Lead]))
          pageRows = pageIds.map(id => byId.get(id)).filter((x): x is Lead => !!x)
        }
        pageAggregates = aggs
      }

      if (rid !== requestId.current) return // risposta sorpassata da una più recente
      setRows(pageRows)
      setTotal(count)
      setAggregates(pageAggregates)
    } catch (e) {
      if (rid !== requestId.current) return
      setError(errorMessage(e, 'Impossibile caricare i lead'))
      setRows([])
      setTotal(0)
    } finally {
      if (rid === requestId.current) setLoading(false)
    }
  }, [applyBaseFilters, needsAggregates, f.avanzamento, f.contatto, sort, page, ownerKey])

  useEffect(() => {
    void load()
  }, [load])

  // Totale senza filtri, per poter dire "38 lead su 457": senza questo numero
  // non si distingue un portafoglio vuoto da un filtro troppo stretto.
  useEffect(() => {
    if (!ownerIds.length) {
      setTotalUnfiltered(0)
      return
    }
    let alive = true
    void supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .in('owner_id', ownerIds)
      .then(({ count }) => {
        if (alive) setTotalUnfiltered(count || 0)
      })
    return () => {
      alive = false
    }
  }, [ownerKey])

  // La selezione multipla non sopravvive a un cambio di filtro: conserverebbe
  // lead che non sono più sotto gli occhi di chi poi agisce.
  useEffect(() => {
    setSelection(new Set())
  }, [ownerKey, f.avanzamento, f.lavorazione, f.contatto, f.fonte, f.cliente, f.q, page])

  // Un lead richiamato dall'URL (#/lead/<id>) viene caricato anche se non è
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

  /** Azione rapida: registra un contatto senza aprire la scheda. */
  async function quickContact(lead: Lead, outcome: string) {
    try {
      const { error } = await supabase.from('activities').insert({
        lead_id: lead.id,
        ts: new Date().toISOString(),
        channel: 'phone',
        outcome,
        notes: null,
      })
      if (error) throw error
      toast.success('Contatto registrato', `${leadName(lead)} — ${labelOfOutcome(outcome)}`)
      await load()
    } catch (e) {
      toast.error('Registrazione non riuscita', errorMessage(e))
    }
  }

  async function exportCsv(onlySelection = false) {
    setExporting(true)
    try {
      const all = onlySelection
        ? rows.filter(r => selection.has(r.id))
        : await fetchAllPages<Lead>(() => applyBaseFilters(supabase.from('leads').select(LEAD_FIELDS)) as never)
      const aggs = onlySelection ? aggregates : await loadAggregates(all.map(l => l.id))
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
            Avanzamento: PROGRESS_BY_VALUE.get(progressOf(a))?.label || '',
            'Caricato il': l.created_at || '',
            Contatti: a?.contacts || 0,
            'Ultimo contatto': a?.lastContact || '',
            Appuntamenti: a?.appointments || 0,
            'Prossimo appuntamento': a?.nextAppointment || '',
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

  const showDetail = !!selected || creating
  const chips = filters.active.filter(a => CHIP_LABEL[a.key])

  return (
    <>
      <PageHeader
        title="Lead"
        description="Anagrafiche, attività e stato di avanzamento del portafoglio."
        actions={
          <>
            <Button icon="download" onClick={() => void exportCsv()} loading={exporting}>
              Esporta
            </Button>
            <Button variant="primary" icon="plus" onClick={startCreate}>
              Nuovo lead
            </Button>
          </>
        }
      />

      <FilterBar
        activeCount={chips.length}
        onReset={() => {
          setSearchDraft('')
          filters.reset()
        }}
        chips={
          chips.length > 0 ? (
            <>
              {chips.map(a => (
                <ActiveFilter
                  key={a.key}
                  label={CHIP_LABEL[a.key] || a.key}
                  value={chipValue(a.key, a.value)}
                  onRemove={() => {
                    if (a.key === 'q') setSearchDraft('')
                    filters.patch({ [a.key]: FILTER_DEFAULTS[a.key], pagina: '1' } as never)
                  }}
                />
              ))}
            </>
          ) : null
        }
      >
        <div className="gu-filters__group gu-filters__group--grow" style={{ maxWidth: 320 }}>
          <SearchInput
            label="Cerca"
            value={searchDraft}
            onValueChange={setSearchDraft}
            placeholder="Cognome, azienda, email, telefono…"
          />
        </div>

        {scope && scopeOptions.length > 1 && (
          <ScopeSelect value={scope} onChange={setScope} options={scopeOptions} />
        )}

        <SelectField
          label="Avanzamento"
          value={f.avanzamento}
          onChange={e => filters.patch({ avanzamento: e.target.value, pagina: '1' })}
          style={{ minWidth: 215 }}
        >
          <option value="tutti">Tutti</option>
          {PROGRESS_STEPS.map(s => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </SelectField>

        <SelectField
          label="Ultimo contatto"
          value={f.contatto}
          onChange={e => filters.patch({ contatto: e.target.value, pagina: '1' })}
          style={{ minWidth: 175 }}
        >
          {CONTACT_AGE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>

        <SelectField
          label="Lavorazione"
          value={f.lavorazione}
          onChange={e => filters.patch({ lavorazione: e.target.value, pagina: '1' })}
          style={{ minWidth: 155 }}
        >
          {WORKING_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>

        <SelectField
          label="Fonte"
          value={f.fonte}
          onChange={e => filters.patch({ fonte: e.target.value, pagina: '1' })}
          style={{ minWidth: 135 }}
        >
          {SOURCE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>

        <SelectField
          label="Cliente"
          value={f.cliente}
          onChange={e => filters.patch({ cliente: e.target.value, pagina: '1' })}
          style={{ minWidth: 175 }}
        >
          {CLIENT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
      </FilterBar>

      {error && <Alert tone="danger" title="Errore">{error}</Alert>}

      <div className="gu-leads">
        <div className={`gu-leads__list${showDetail ? ' gu-leads__list--hidden-mobile' : ''}`}>
          {/* L'ordinamento non è un filtro: sta accanto ai risultati, non nella barra. */}
          <div className="gu-listbar">
            <ResultCount shown={total} total={totalUnfiltered} loading={loading} />
            <div className="gu-spacer" />
            <div className="gu-listbar__sort">
              <label htmlFor="gu-lead-sort">Ordina per</label>
              <select
                id="gu-lead-sort"
                className="gu-select"
                value={sort}
                onChange={e => filters.patch({ ordina: e.target.value, pagina: '1' })}
              >
                {SORT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selection.size > 0 && (
            <BulkBar
              count={selection.size}
              canAssign={canAssign}
              exporting={exporting}
              onClear={() => setSelection(new Set())}
              onExport={() => void exportCsv(true)}
              onReassign={async to => {
                const ids = [...selection]
                const { error } = await supabase.from('leads').update({ owner_id: to }).in('id', ids)
                if (error) throw error
                toast.success(
                  `${ids.length} lead riassegnati`,
                  displayName(byUserId.get(to)),
                )
                setSelection(new Set())
                await load()
              }}
              onToggleWorking={async working => {
                const ids = [...selection]
                const { error } = await supabase.from('leads').update({ is_working: working }).in('id', ids)
                if (error) throw error
                toast.success(working ? `${ids.length} lead ripresi` : `${ids.length} lead sospesi`)
                setSelection(new Set())
                await load()
              }}
              advisors={advisors}
            />
          )}

          <Card className="gu-leads__card">
            {loading ? (
              <SkeletonRows rows={6} height={64} />
            ) : rows.length === 0 ? (
              <EmptyState
                icon="leads"
                title={chips.length ? 'Nessun lead con questi filtri' : 'Nessun lead in portafoglio'}
                text={
                  chips.length
                    ? `Ci sono ${totalUnfiltered} lead in totale: prova ad allargare la ricerca o ad azzerare i filtri.`
                    : 'Crea il primo lead oppure importa un elenco da file CSV.'
                }
                action={
                  chips.length ? (
                    <Button icon="x" onClick={() => { setSearchDraft(''); filters.reset() }}>
                      Azzera i filtri
                    </Button>
                  ) : (
                    <Button variant="primary" icon="plus" onClick={startCreate}>
                      Nuovo lead
                    </Button>
                  )
                }
              />
            ) : (
              <>
                <div className="gu-row" style={{ padding: 'var(--gu-space-2) var(--gu-space-3) 0', gap: 8 }}>
                  <label className="gu-check" style={{ fontSize: 'var(--gu-text-xs)' }}>
                    <input
                      type="checkbox"
                      checked={rows.every(r => selection.has(r.id))}
                      ref={el => {
                        if (el) el.indeterminate = selection.size > 0 && !rows.every(r => selection.has(r.id))
                      }}
                      onChange={e =>
                        setSelection(prev => {
                          const next = new Set(prev)
                          for (const r of rows) (e.target.checked ? next.add(r.id) : next.delete(r.id))
                          return next
                        })
                      }
                    />
                    <span>Seleziona la pagina</span>
                  </label>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 'var(--gu-space-2)', display: 'grid', gap: 2 }}>
                  {rows.map(lead => (
                    <LeadRow
                      key={lead.id}
                      lead={lead}
                      aggregate={aggregates[lead.id]}
                      owner={displayName(byUserId.get(lead.owner_id || ''), '')}
                      selected={selected?.id === lead.id}
                      checked={selection.has(lead.id)}
                      onCheck={checked =>
                        setSelection(prev => {
                          const next = new Set(prev)
                          if (checked) next.add(lead.id)
                          else next.delete(lead.id)
                          return next
                        })
                      }
                      onOpen={() => {
                        setCreating(false)
                        setFormErrors({})
                        onSelect(lead.id)
                      }}
                      onQuickContact={outcome => void quickContact(lead, outcome)}
                    />
                  ))}
                </ul>
              </>
            )}
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              onPageChange={p => filters.set('pagina', String(p))}
              loading={loading}
            />
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
                onFormChange={patch => setForm(f2 => ({ ...f2, ...patch }))}
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
  checked,
  onCheck,
  onOpen,
  onQuickContact,
}: {
  lead: Lead
  aggregate?: Aggregate
  owner: string
  selected: boolean
  checked: boolean
  onCheck: (checked: boolean) => void
  onOpen: () => void
  onQuickContact: (outcome: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const step = PROGRESS_BY_VALUE.get(progressOf(aggregate))
  const days = daysSinceContact(aggregate)

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

  return (
    <li className="gu-lead-row" data-selected={selected}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onCheck(e.target.checked)}
        aria-label={`Seleziona ${leadName(lead)}`}
      />

      <button type="button" className="gu-lead-row__open" onClick={onOpen} aria-current={selected ? 'true' : undefined}>
        <span className="gu-row" style={{ justifyContent: 'flex-start', gap: 8 }}>
          <span style={{ fontWeight: 600 }} className="gu-truncate">
            {leadName(lead)}
          </span>
          {step && <Badge tone={step.tone}>{step.short}</Badge>}
          {lead.is_working === false && <Badge tone="neutral">Sospeso</Badge>}
        </span>

        <span className="gu-row-tight" style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)', gap: 6 }}>
          <Icon name={lead.email ? 'mail' : 'phone'} size={12} />
          <span className="gu-truncate">{lead.email || lead.phone || 'Nessun recapito'}</span>
          {owner && (
            <>
              <span aria-hidden="true">·</span>
              <span className="gu-truncate">{owner}</span>
            </>
          )}
        </span>

        <span className="gu-row-tight" style={{ gap: 6, fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)' }}>
          {days === null ? (
            <span>Mai contattato</span>
          ) : (
            <span>Ultimo contatto {relativeTime(aggregate?.lastContact)}</span>
          )}
          {aggregate?.nextAppointment && (
            <>
              <span aria-hidden="true">·</span>
              <span>Appuntamento {relativeTime(aggregate.nextAppointment)}</span>
            </>
          )}
          {!!aggregate?.contracts && <Badge tone="success">{formatCurrency(aggregate.production)}</Badge>}
        </span>
      </button>

      <div className="gu-lead-row__actions" ref={menuRef} style={{ position: 'relative' }}>
        <IconButton
          icon="phone"
          label={`Registra un contatto con ${leadName(lead)}`}
          size="sm"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(v => !v)}
        />
        {menuOpen && (
          <div className="gu-menu" role="menu" style={{ minWidth: 190 }}>
            <div className="gu-menu__header" style={{ fontSize: 'var(--gu-text-xs)', color: 'var(--gu-text-subtle)' }}>
              Telefonata di adesso
            </div>
            {OUTCOMES.map(o => (
              <button
                key={o.value}
                type="button"
                role="menuitem"
                className="gu-menu__item"
                onClick={() => {
                  setMenuOpen(false)
                  onQuickContact(o.value)
                }}
              >
                <Icon name={o.tone === 'success' ? 'checkCircle' : o.tone === 'danger' ? 'xCircle' : 'alert'} size={15} />
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  )
}

/* ========================================================================== */
/* Azioni su più lead                                                          */
/* ========================================================================== */

function BulkBar({
  count,
  canAssign,
  exporting,
  advisors,
  onClear,
  onExport,
  onReassign,
  onToggleWorking,
}: {
  count: number
  canAssign: boolean
  exporting: boolean
  advisors: { user_id: string | null; full_name: string | null; email: string; role: string }[]
  onClear: () => void
  onExport: () => void
  onReassign: (to: string) => Promise<void>
  onToggleWorking: (working: boolean) => Promise<void>
}) {
  const toast = useToast()
  const [assignOpen, setAssignOpen] = useState(false)
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast.error('Operazione non riuscita', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gu-bulkbar">
      <strong>{count} selezionati</strong>
      <div className="gu-spacer" />
      {canAssign && (
        <Button size="sm" icon="users" onClick={() => setAssignOpen(true)} disabled={busy}>
          Riassegna
        </Button>
      )}
      <Button size="sm" icon="pause" onClick={() => void run(() => onToggleWorking(false))} disabled={busy}>
        Sospendi
      </Button>
      <Button size="sm" icon="play" onClick={() => void run(() => onToggleWorking(true))} disabled={busy}>
        Riprendi
      </Button>
      <Button size="sm" icon="download" onClick={onExport} loading={exporting}>
        Esporta
      </Button>
      <Button size="sm" variant="ghost" icon="x" onClick={onClear}>
        Annulla
      </Button>

      <Modal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title={`Riassegna ${count} lead`}
        description="I lead passeranno all'advisor scelto, che li vedrà nella propria lista."
        width={420}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssignOpen(false)}>
              Annulla
            </Button>
            <Button
              variant="primary"
              icon="check"
              disabled={!target}
              loading={busy}
              onClick={() =>
                void run(async () => {
                  await onReassign(target)
                  setAssignOpen(false)
                  setTarget('')
                })
              }
            >
              Riassegna
            </Button>
          </>
        }
      >
        <SelectField label="Nuovo assegnatario" value={target} onChange={e => setTarget(e.target.value)}>
          <option value="">— Seleziona un advisor —</option>
          {advisors
            .filter(a => a.user_id)
            .map(a => (
              <option key={a.user_id!} value={a.user_id!}>
                {displayName(a)}
                {a.role !== 'Junior' ? ` (${a.role})` : ''}
              </option>
            ))}
        </SelectField>
      </Modal>
    </div>
  )
}

/* ========================================================================== */
/* Query di supporto                                                           */
/* ========================================================================== */

function labelOfOutcome(value: string) {
  return OUTCOMES.find(o => o.value === value)?.label || value
}

/** Ricerca su più colonne. Le virgole vanno rimosse: spezzerebbero il filtro or(). */
function searchFilter(term: string) {
  const safe = term.replace(/[,()]/g, ' ').trim()
  const like = `%${safe}%`
  return ['last_name', 'first_name', 'company_name', 'email', 'phone', 'city'].map(c => `${c}.ilike.${like}`).join(',')
}

function applySort<T>(q: T, sort: SortKey): T {
  const query = q as unknown as {
    order: (col: string, opts: { ascending: boolean; nullsFirst?: boolean }) => T
  }
  switch (sort) {
    case 'recenti':
      return query.order('created_at', { ascending: false })
    // Gli ordinamenti che dipendono dall'attività vengono risolti dopo, sui
    // conteggi; qui si dà comunque un ordine stabile per la paginazione.
    case 'contatto':
    case 'trascurati':
    case 'cognome':
    default:
      return query.order('last_name', { ascending: true, nullsFirst: false })
  }
}
