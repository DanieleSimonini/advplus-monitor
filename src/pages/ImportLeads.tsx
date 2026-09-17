import React, { useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Icon,
  SelectField,
  Stat,
  useToast,
} from '../ui'
import { PageHeader } from '../app/AppShell'
import { useAuth } from '../auth/AuthProvider'
import { useAdvisors } from '../lib/useAdvisors'
import { chunk, fetchAllPages, uniq } from '../lib/db'
import { displayName, downloadCsv, errorMessage } from '../lib/format'
import type { LeadSource } from '../lib/domain'

type RawRow = Record<string, string>

type ParsedRow = {
  line: number
  raw: RawRow
  values: {
    is_agency_client: boolean
    email: string | null
    phone: string | null
    first_name: string | null
    last_name: string | null
    company_name: string | null
    city: string | null
    address: string | null
    source: LeadSource | null
    owner_id: string | null
  }
  errors: string[]
  warnings: string[]
}

const HEADERS = [
  'is_agency_client',
  'email',
  'phone',
  'first_name',
  'last_name',
  'company_name',
  'city',
  'address',
  'source',
  'owner_email',
]

const TEMPLATE = [
  HEADERS.join(';'),
  'true;mario.rossi@example.com;;Mario;Rossi;;Milano;Via Roma 1;Provided;teamlead@advisoryplus.it',
  'false;;3331234567;Giulia;Bianchi;;Torino;;Self;junior1@advisoryplus.it',
  'true;info@aziendasrl.it;;;;Azienda Srl;Roma;Via Milano 2;Provided;junior2@advisoryplus.it',
].join('\r\n')

const INSERT_CHUNK = 200

export default function ImportLeadsPage({ onDone }: { onDone: () => void }) {
  const { me } = useAuth()
  const { visible: advisors } = useAdvisors()
  const toast = useToast()

  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [defaultOwner, setDefaultOwner] = useState('')
  const [checking, setChecking] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ inserted: number; skipped: number } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const valid = useMemo(() => (rows || []).filter(r => !r.errors.length), [rows])
  const invalid = useMemo(() => (rows || []).filter(r => r.errors.length), [rows])

  function reset() {
    setRows(null)
    setFileName('')
    setDone(null)
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setDone(null)
    setRows(null)
    setFileName(file.name)

    if (!/\.(csv|txt)$/i.test(file.name)) {
      setError('Formato non supportato. Esporta il file in CSV (separatore ; oppure ,).')
      return
    }

    try {
      const text = await file.text()
      const parsed = parseCsv(text)
      if (!parsed.length) {
        setError('Il file non contiene righe di dati.')
        return
      }
      const missing = ['is_agency_client', 'email', 'phone', 'first_name', 'last_name', 'company_name'].filter(
        h => !(h in parsed[0]),
      )
      if (missing.length === 6) {
        setError(`Intestazioni non riconosciute. Attese: ${HEADERS.join(', ')}`)
        return
      }
      await validate(parsed)
    } catch (ex) {
      setError(errorMessage(ex, 'Impossibile leggere il file'))
    }
  }

  async function validate(raw: RawRow[]) {
    setChecking(true)
    try {
      // Mappa owner_email -> user_id
      const ownerEmails = uniq(raw.map(r => (r.owner_email || '').trim().toLowerCase()).filter(Boolean))
      const ownerMap = new Map<string, string>()
      for (const a of advisors) {
        if (a.user_id) ownerMap.set(a.email.toLowerCase(), a.user_id)
      }
      const unknownOwners = ownerEmails.filter(e => !ownerMap.has(e))

      // Duplicati già presenti a database
      const emails = uniq(raw.map(r => (r.email || '').trim().toLowerCase()).filter(Boolean))
      const phones = uniq(raw.map(r => normalizePhone(r.phone)).filter(Boolean))

      const [dbEmails, dbPhones] = await Promise.all([
        lookupExisting('email', emails),
        lookupExisting('phone', phones),
      ])

      // Duplicati interni al file: prima non venivano rilevati e il caricamento
      // creava due anagrafiche identiche.
      const seenEmail = new Set<string>()
      const seenPhone = new Set<string>()

      const parsed: ParsedRow[] = raw.map((r, i) => {
        const errors: string[] = []
        const warnings: string[] = []

        const agency = parseBool(r.is_agency_client)
        if (agency === null) errors.push('is_agency_client deve essere true o false')

        const email = (r.email || '').trim().toLowerCase() || null
        const phone = normalizePhone(r.phone) || null
        if (!email && !phone) errors.push('serve almeno email o telefono')
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('email non valida')

        const firstName = clean(r.first_name)
        const lastName = clean(r.last_name)
        const company = clean(r.company_name)
        if (!(firstName && lastName) && !company) errors.push('servono nome e cognome, oppure la ragione sociale')

        const ownerEmail = (r.owner_email || '').trim().toLowerCase()
        let ownerId: string | null = null
        if (ownerEmail) {
          ownerId = ownerMap.get(ownerEmail) || null
          if (!ownerId) errors.push(`assegnatario "${ownerEmail}" non presente fra gli advisor`)
        } else if (defaultOwner) {
          ownerId = defaultOwner
        } else {
          ownerId = me?.user_id || null
          warnings.push('nessun assegnatario indicato: verrà assegnato a te')
        }

        if (email && dbEmails.has(email)) errors.push('email già presente in archivio')
        if (phone && dbPhones.has(phone)) errors.push('telefono già presente in archivio')
        if (email && seenEmail.has(email)) errors.push('email duplicata all’interno del file')
        if (phone && seenPhone.has(phone)) errors.push('telefono duplicato all’interno del file')
        if (email) seenEmail.add(email)
        if (phone) seenPhone.add(phone)

        const source = parseSource(r.source)
        if (r.source && !source) warnings.push(`fonte "${r.source}" non riconosciuta, verrà lasciata vuota`)

        return {
          line: i + 2, // +1 per l'intestazione, +1 perché le righe partono da 1
          raw: r,
          values: {
            is_agency_client: agency ?? false,
            email,
            phone,
            first_name: firstName,
            last_name: lastName,
            company_name: company,
            city: clean(r.city),
            address: clean(r.address),
            source,
            owner_id: ownerId,
          },
          errors,
          warnings,
        }
      })

      setRows(parsed)
      if (unknownOwners.length) {
        setError(
          `Questi assegnatari non esistono fra gli advisor: ${unknownOwners.join(', ')}. Correggi il file oppure scegli un assegnatario predefinito.`,
        )
      }
    } finally {
      setChecking(false)
    }
  }

  async function runImport() {
    if (!valid.length) return
    setImporting(true)
    setError('')
    try {
      const payload = valid.map(r => r.values)
      let inserted = 0
      // Inserimento a blocchi: un unico insert da migliaia di righe supera i
      // limiti della richiesta e fallisce interamente.
      for (const block of chunk(payload, INSERT_CHUNK)) {
        const { error, count } = await supabase.from('leads').insert(block, { count: 'exact' })
        if (error) throw error
        inserted += count ?? block.length
      }

      // La tabella import_logs esiste a schema ma non veniva mai scritta:
      // senza traccia, un import sbagliato è impossibile da ricostruire.
      await supabase
        .from('import_logs')
        .insert({
          actor_user_id: me?.user_id ?? null,
          filename: fileName || null,
          total_rows: rows?.length ?? 0,
          inserted,
          errors: invalid.length ? invalid.map(r => ({ line: r.line, errors: r.errors })) : null,
        })
        .then(undefined, () => {
          /* il log non deve far fallire l'import */
        })

      setDone({ inserted, skipped: invalid.length })
      toast.success(`${inserted} lead importati`, invalid.length ? `${invalid.length} righe scartate` : undefined)
    } catch (e) {
      setError(errorMessage(e, "Errore durante l'importazione"))
      toast.error('Importazione non riuscita', errorMessage(e))
    } finally {
      setImporting(false)
    }
  }

  function downloadErrors() {
    downloadCsv(
      `errori_import_${new Date().toISOString().slice(0, 10)}.csv`,
      invalid.map(r => ({ Riga: r.line, Errori: r.errors.join(' | '), ...r.raw })),
    )
  }

  return (
    <>
      <PageHeader
        title="Importa lead"
        description="Carica un elenco da file CSV. Prima di scrivere qualsiasi cosa ti mostriamo che cosa succederà."
        actions={
          <Button
            icon="download"
            onClick={() => {
              const blob = new Blob(['﻿' + TEMPLATE], { type: 'text/csv;charset=utf-8;' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'guideup_template_lead.csv'
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            Scarica il modello
          </Button>
        }
      />

      {done ? (
        <Card>
          <CardBody>
            <EmptyState
              icon="checkCircle"
              title={`${done.inserted} lead importati`}
              text={
                done.skipped
                  ? `${done.skipped} righe sono state scartate perché contenevano errori. Puoi scaricarle, correggerle e ricaricarle.`
                  : 'Tutte le righe del file sono state caricate correttamente.'
              }
              action={
                <div className="gu-row">
                  {done.skipped > 0 && (
                    <Button icon="download" onClick={downloadErrors}>
                      Scarica le righe scartate
                    </Button>
                  )}
                  <Button variant="secondary" onClick={reset}>
                    Importa un altro file
                  </Button>
                  <Button variant="primary" iconRight="arrowUpRight" onClick={onDone}>
                    Vai ai lead
                  </Button>
                </div>
              }
            />
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="1. Scegli il file" icon="upload" />
            <CardBody className="gu-stack">
              <div className="gu-row" style={{ gap: 'var(--gu-space-4)' }}>
                <label
                  className="gu-btn gu-btn--secondary"
                  style={{ cursor: 'pointer' }}
                  htmlFor="gu-import-file"
                >
                  <Icon name="upload" size={16} />
                  {fileName ? 'Cambia file' : 'Seleziona file CSV'}
                </label>
                <input
                  ref={fileRef}
                  id="gu-import-file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={onFile}
                  className="gu-sr-only"
                />
                {fileName && (
                  <span className="gu-row-tight" style={{ color: 'var(--gu-text-muted)' }}>
                    <Icon name="fileText" size={15} />
                    {fileName}
                  </span>
                )}
                {checking && <Badge tone="primary">Verifica in corso…</Badge>}
              </div>

              <SelectField
                label="Assegnatario predefinito"
                hint="Usato per le righe che non indicano owner_email. Se lasci vuoto, i lead vengono assegnati a te."
                value={defaultOwner}
                onChange={e => setDefaultOwner(e.target.value)}
                style={{ maxWidth: 320 }}
              >
                <option value="">— Me stesso —</option>
                {advisors
                  .filter(a => a.user_id)
                  .map(a => (
                    <option key={a.user_id!} value={a.user_id!}>
                      {displayName(a)}
                    </option>
                  ))}
              </SelectField>

              <Alert tone="info" title="Colonne attese">
                <code style={{ fontSize: 'var(--gu-text-xs)', wordBreak: 'break-all' }}>{HEADERS.join(' ; ')}</code>
                <div style={{ marginTop: 6 }}>
                  Separatore <strong>;</strong> o <strong>,</strong> (riconosciuto automaticamente).{' '}
                  <code>is_agency_client</code> accetta true/false, 1/0, sì/no. <code>source</code> accetta
                  Provided o Self.
                </div>
              </Alert>

              {error && <Alert tone="danger" title="Attenzione">{error}</Alert>}
            </CardBody>
          </Card>

          {rows && (
            <>
              <div className="gu-grid gu-grid--3">
                <Stat label="Righe nel file" value={rows.length} icon="fileText" />
                <Stat label="Pronte da importare" value={valid.length} icon="checkCircle" tone="accent" />
                <Stat
                  label="Con errori"
                  value={invalid.length}
                  icon="alert"
                  tone={invalid.length ? 'danger' : undefined}
                />
              </div>

              {invalid.length > 0 && (
                <Card>
                  <CardHeader
                    title={`${invalid.length} righe verranno scartate`}
                    subtitle="Le righe valide possono comunque essere importate"
                    icon="alert"
                    actions={
                      <Button icon="download" size="sm" onClick={downloadErrors}>
                        Scarica
                      </Button>
                    }
                  />
                  <CardBody style={{ padding: 0 }}>
                    <div className="gu-table-wrap" style={{ maxHeight: 320 }}>
                      <table className="gu-table">
                        <thead>
                          <tr>
                            <th scope="col">Riga</th>
                            <th scope="col">Nominativo</th>
                            <th scope="col">Problema</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invalid.slice(0, 100).map(r => (
                            <tr key={r.line}>
                              <td className="gu-num">{r.line}</td>
                              <td>
                                {[r.raw.last_name, r.raw.first_name].filter(Boolean).join(' ') ||
                                  r.raw.company_name ||
                                  '—'}
                              </td>
                              <td style={{ color: 'var(--gu-danger-fg)' }}>{r.errors.join(' · ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardBody>
                </Card>
              )}

              <Card>
                <CardHeader
                  title="2. Controlla e conferma"
                  subtitle={`Anteprima delle prime ${Math.min(10, valid.length)} righe valide`}
                  icon="check"
                />
                <CardBody style={{ padding: 0 }}>
                  {valid.length === 0 ? (
                    <EmptyState
                      icon="xCircle"
                      title="Nessuna riga importabile"
                      text="Correggi gli errori segnalati e ricarica il file."
                    />
                  ) : (
                    <div className="gu-table-wrap">
                      <table className="gu-table">
                        <thead>
                          <tr>
                            <th scope="col">Nominativo</th>
                            <th scope="col">Recapito</th>
                            <th scope="col">Città</th>
                            <th scope="col">Assegnato a</th>
                          </tr>
                        </thead>
                        <tbody>
                          {valid.slice(0, 10).map(r => (
                            <tr key={r.line}>
                              <td>
                                {[r.values.last_name, r.values.first_name].filter(Boolean).join(' ') ||
                                  r.values.company_name}
                              </td>
                              <td>{r.values.email || r.values.phone}</td>
                              <td>{r.values.city || '—'}</td>
                              <td>
                                {displayName(advisors.find(a => a.user_id === r.values.owner_id), 'Me stesso')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardBody>
                <div className="gu-pagination">
                  <span className="gu-pagination__info">
                    {valid.length} lead verranno creati{invalid.length > 0 && `, ${invalid.length} scartati`}
                  </span>
                  <div className="gu-row">
                    <Button variant="ghost" onClick={reset}>
                      Annulla
                    </Button>
                    <Button
                      variant="primary"
                      icon="upload"
                      onClick={runImport}
                      loading={importing}
                      disabled={!valid.length}
                    >
                      Importa {valid.length} lead
                    </Button>
                  </div>
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </>
  )
}

/* ========================================================================== */
/* Parsing                                                                     */
/* ========================================================================== */

/** Riconosce il separatore contando le occorrenze fuori dalle virgolette. */
function detectSeparator(headerLine: string): string {
  const count = (ch: string) => {
    let n = 0
    let quoted = false
    for (const c of headerLine) {
      if (c === '"') quoted = !quoted
      else if (c === ch && !quoted) n++
    }
    return n
  }
  return count(';') >= count(',') ? ';' : ','
}

/**
 * Parser CSV che gestisce virgolette, separatori dentro i campi e ritorni a
 * capo dentro i campi quotati (un indirizzo su due righe mandava fuori posto
 * tutte le colonne successive).
 */
export function parseCsv(input: string): RawRow[] {
  const text = input.replace(/^﻿/, '')
  const firstLine = text.split(/\r?\n/).find(l => l.trim().length > 0) || ''
  const sep = detectSeparator(firstLine)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
      continue
    }
    if (c === '"') {
      quoted = true
    } else if (c === sep) {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }

  const nonEmpty = rows.filter(r => r.some(c => c.trim().length > 0))
  if (nonEmpty.length < 2) return []

  const headers = nonEmpty[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
  return nonEmpty.slice(1).map(cols => {
    const obj: RawRow = {}
    headers.forEach((h, i) => {
      obj[h] = (cols[i] ?? '').trim()
    })
    return obj
  })
}

function clean(v: string | undefined) {
  const s = (v || '').trim()
  return s.length ? s : null
}

function parseBool(v: string | undefined): boolean | null {
  const s = (v || '').trim().toLowerCase()
  if (['true', '1', 'si', 'sì', 'yes', 'x', 'vero'].includes(s)) return true
  if (['false', '0', 'no', 'falso'].includes(s)) return false
  return null
}

function parseSource(v: string | undefined): LeadSource | null {
  const s = (v || '').trim().toLowerCase()
  if (s === 'provided' || s === 'fornito') return 'Provided'
  if (s === 'self' || s === 'autonomo') return 'Self'
  return null
}

/** Confronta i telefoni senza spazi e prefissi decorativi. */
function normalizePhone(v: string | undefined) {
  return (v || '').replace(/[\s./()-]/g, '').trim()
}

async function lookupExisting(column: 'email' | 'phone', values: string[]) {
  const found = new Set<string>()
  if (!values.length) return found
  for (const block of chunk(values)) {
    const rows = await fetchAllPages<Record<string, string>>(
      () => supabase.from('leads').select(column).in(column, block) as never,
    )
    for (const r of rows) {
      const v = (r[column] || '').trim().toLowerCase()
      if (v) found.add(column === 'phone' ? normalizePhone(v) : v)
    }
  }
  return found
}
