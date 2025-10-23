import React, { useMemo, useRef, useState } from 'react'
import { supabase } from '@/supabaseClient'
import * as XLSX from 'xlsx' // NEW: support for XLSX

type RawRow = Record<string, any>
type ValidRow = {
  is_agency_client: boolean
  email: string | null
  phone: string | null
  first_name: string | null
  last_name: string | null
  company_name: string | null
  city: string | null
  address: string | null
  source: 'Provided' | 'Self' | null
  owner_email: string
}
type Report = { valid: ValidRow[]; errors: string[] }

const box: React.CSSProperties = { background:'#fff', border:'1px solid #eee', borderRadius:16, padding:16 }
const ipt: React.CSSProperties = { padding:'8px 10px', borderRadius:8, border:'1px solid #ddd' }
const th: React.CSSProperties  = { textAlign:'left', padding:'6px 8px', borderBottom:'1px solid #eee', background:'#fafafa' }
const td: React.CSSProperties  = { padding:'6px 8px', borderBottom:'1px solid #f5f5f5' }

// NEW: intestazioni attese (riusate in validazione/import già esistente)
const EXPECTED_HEADERS = [
  'is_agency_client','email','phone','first_name','last_name',
  'company_name','city','address','source','owner_email'
]

// NEW: utilità per normalizzare chiavi
const normalizeKey = (k: string) => k?.toString().trim().toLowerCase()

export default function ImportLeadsPage(){
  const [rows, setRows] = useState<RawRow[] | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [dupes, setDupes] = useState<{ email:Set<string>; phone:Set<string> }>({ email:new Set(), phone:new Set() })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement|null>(null)

  const sample = useMemo(()=> sampleCSV(), [])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>){
    const f = e.target.files?.[0]
    if (!f) return
    setError(''); setRows(null); setReport(null)
    try{
      const name = f.name.toLowerCase()
      if (name.endsWith('.csv')) {
        const text = await f.text()
        const parsed = parseCSV(text)
        setRows(parsed)
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const parsed = await parseXLSX(f) // NEW
        setRows(parsed)
      } else {
        setError('Formato non supportato. Usa un file .csv o .xlsx')
      }
    } catch(ex:any){ setError(ex.message || 'Errore lettura file') }
    finally{
      // reset dell'input per permettere re-upload dello stesso file
      if (e.target) e.target.value = ''
    }
  }

  async function validate(){
    if (!rows || rows.length===0){ setReport({ valid:[], errors:['Nessuna riga nel file.'] }); return }
    setLoading(true); setError('')
    try{
      // Owner mapping complessivo
      const ownerEmails = Array.from(new Set(rows.map(r => String(r.owner_email||'').trim()).filter(Boolean)))
      const { data: advs, error: aerr } = await supabase
        .from('advisors')
        .select('user_id,email')
        .in('email', ownerEmails)
      if (aerr) throw aerr
      const byEmail = new Map<string,string>()
      for(const a of (advs||[])) byEmail.set(a.email, a.user_id)
      const missing = ownerEmails.filter(e => !byEmail.has(e))
      if (missing.length>0){ setReport({ valid:[], errors:[`owner_email non trovati in advisors: ${missing.join(', ')}`] }); return }

      // Dedup vs DB
      const emails = Array.from(new Set(rows.map(r => String(r.email||'').trim()).filter(Boolean)))
      const phones = Array.from(new Set(rows.map(r => String(r.phone||'').trim()).filter(Boolean)))
      const [dbE, dbP] = await Promise.all([
        emails.length ? supabase.from('leads').select('email').in('email', emails) : Promise.resolve({ data:[] as any }),
        phones.length ? supabase.from('leads').select('phone').in('phone', phones) : Promise.resolve({ data:[] as any }),
      ])
      const dbEmails = new Set<string>((dbE.data||[]).map((r:any)=>String(r.email)))
      const dbPhones = new Set<string>((dbP.data||[]).map((r:any)=>String(r.phone)))
      setDupes({ email: dbEmails, phone: dbPhones })

      // Validazione riga per riga
      const valid: ValidRow[] = []
      const errors: string[] = []
      for(let i=0;i<rows.length;i++){
        const r = rows[i]
        const ctx = `riga ${i+1}`
        const v: ValidRow = {
          is_agency_client: parseBool(r.is_agency_client),
          email: normStr(r.email),
          phone: normStr(r.phone),
          first_name: normStr(r.first_name),
          last_name: normStr(r.last_name),
          company_name: normStr(r.company_name),
          city: normStr(r.city),
          address: normStr(r.address),
          source: toSource(r.source),
          owner_email: String(r.owner_email||'').trim(),
        }
        if (typeof v.is_agency_client !== 'boolean') errors.push(`${ctx}: is_agency_client deve essere true/false`)
        if (!v.email && !v.phone) errors.push(`${ctx}: indicare email oppure phone`)
        if (!((v.first_name && v.last_name) || v.company_name)) errors.push(`${ctx}: servono nome+cognome oppure ragione sociale`)
        if (v.email && dbEmails.has(v.email)) errors.push(`${ctx}: email già presente a DB`)
        if (v.phone && dbPhones.has(v.phone)) errors.push(`${ctx}: phone già presente a DB`)
        if (!byEmail.has(v.owner_email)) errors.push(`${ctx}: owner_email non mappato in advisors`)
        valid.push(v)
      }
      setReport({ valid, errors })
    } catch(ex:any){ setError(ex.message || 'Errore di validazione') }
    finally{ setLoading(false) }
  }

  async function doImport(){
    if (!report || report.errors.length>0){ return }
    setLoading(true); setError('')
    try{
      const ownerEmails = Array.from(new Set(report.valid.map(v=>v.owner_email)))
      const { data: advs } = await supabase.from('advisors').select('user_id,email').in('email', ownerEmails)
      const map = new Map<string,string>()
      for(const a of (advs||[])) map.set(a.email, a.user_id)

      const payload = report.valid.map(v=>({
        owner_id: map.get(v.owner_email)!,
        is_agency_client: v.is_agency_client,
        first_name: v.first_name,
        last_name: v.last_name,
        company_name: v.company_name,
        email: v.email,
        phone: v.phone,
        city: v.city,
        address: v.address,
        source: v.source,
      }))

      const { error } = await supabase.from('leads').insert(payload)
      if (error) throw error

      alert(`Import completato: ${payload.length} lead inseriti`)
      setRows(null); setReport(null); if (fileRef.current) fileRef.current.value=''
    } catch(ex:any){ setError(ex.message || 'Errore durante import') }
    finally{ setLoading(false) }
  }

  function downloadCSV(){
    const blob = new Blob([sample], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url; a.download='template_leads.csv'; a.click(); URL.revokeObjectURL(url)
  }

  // NEW: download del template XLSX (stessa impaginazione/esempi)
  function downloadXLSX(){
    const XLSX_HEADERS = EXPECTED_HEADERS
    const XLSX_SAMPLE_ROWS = [
      {
        is_agency_client: true,
        email: 'mario.rossi@example.com',
        phone: null,
        first_name: 'Mario',
        last_name: 'Rossi',
        company_name: null,
        city: 'Milano',
        address: 'Via A 1',
        source: 'Provided',
        owner_email: 'teamlead@advisoryplus.it',
      },
      {
        is_agency_client: false,
        email: null,
        phone: '3331234567',
        first_name: 'Giulia',
        last_name: 'Bianchi',
        company_name: null,
        city: null,
        address: 'Self',
        source: 'junior1@advisoryplus.it',
        owner_email: null,
      },
      {
        is_agency_client: true,
        email: 'azienda@example.com',
        phone: null,
        first_name: null,
        last_name: null,
        company_name: 'Azienda Srl',
        city: 'Roma',
        address: 'Via B 2',
        source: 'Provided',
        owner_email: 'junior2@advisoryplus.it',
      },
    ]
    const ws = XLSX.utils.json_to_sheet(XLSX_SAMPLE_ROWS, { header: XLSX_HEADERS })
    // opzionale: larghezza colonne
    ws['!cols'] = XLSX_HEADERS.map(() => ({ wch: 18 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'template_leads')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'template_leads.xlsx'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display:'grid', gap:16 }}>
      <div style={{ fontSize:20, fontWeight:800 }}>Importa Leads</div>

      <div style={{ ...box }}>
        <div style={{ display:'grid', gap:10 }}>
          {/* NEW: accetta anche xls/xlsx */}
          <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={handleFile} />
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button onClick={downloadCSV} style={{ ...ipt, cursor:'pointer' }}>Scarica template CSV</button>
            {/* NEW: template XLSX */}
            <button onClick={downloadXLSX} style={{ ...ipt, cursor:'pointer' }}>Scarica template XLSX</button>
          </div>
          <div style={{ fontSize:12, color:'#666' }}>
            Intestazioni attese: <code>is_agency_client,email,phone,first_name,last_name,company_name,city,address,source,owner_email</code>
          </div>
          <div>
            <button onClick={validate} disabled={!rows || loading} style={{ ...ipt, cursor:'pointer' }}>Valida</button>
            <button onClick={doImport} disabled={!report || report.errors.length>0 || loading} style={{ ...ipt, cursor:'pointer', marginLeft:8 }}>Importa</button>
          </div>
          {error && <div style={{ color:'#c00' }}>{error}</div>}
        </div>
      </div>

      {rows && (
        <div style={{ ...box }}>
          <div style={{ fontWeight:700, marginBottom:8 }}>Anteprima file ({rows.length} righe)</div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ minWidth:800, borderCollapse:'collapse' }}>
              <thead>
                <tr>{Object.keys(rows[0]||{}).map(h=> <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.slice(0,50).map((r,i)=> (
                  <tr key={i}>{Object.keys(rows[0]||{}).map(h=> <td key={h} style={td}>{String(r[h]??'')}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report && (
        <div style={{ ...box }}>
          <div style={{ fontWeight:700, marginBottom:8 }}>Esito validazione</div>
          {report.errors.length>0 ? (
            <div>
              <div style={{ color:'#c00', marginBottom:8 }}>Errori: {report.errors.length}. Correggi il file e rilancia Valida.</div>
              <ul>{report.errors.slice(0,100).map((e,i)=> <li key={i} style={{ color:'#c00' }}>{e}</li>)}</ul>
            </div>
          ) : (
            <div style={{ color:'#080' }}>Nessun errore. Puoi procedere con l'import.</div>
          )}
        </div>
      )}
    </div>
  )
}

/* Helpers */
function parseCSV(text: string): RawRow[]{
  const sep = text.indexOf(';')>-1 && text.indexOf(',')===-1 ? ';' : ','
  const lines = text.split(/\r?\n/).filter(l=>l.trim().length>0)
  if (lines.length===0) return []
  const headers = lines[0].split(sep).map(h=>h.trim())
  const rows: RawRow[] = []
  for(let i=1;i<lines.length;i++){
    const cols = splitCsvLine(lines[i], sep)
    const obj: RawRow = {}
    headers.forEach((h,idx)=>{ obj[h] = (cols[idx] ?? '').trim() })
    rows.push(obj)
  }
  return rows
}
function splitCsvLine(line:string, sep:string){
  const out:string[] = []; let cur=''; let inQ=false
  for(let i=0;i<line.length;i++){
    const ch=line[i]
    if (ch === '\"'){ inQ = !inQ; continue }
    if (ch === sep && !inQ){ out.push(cur); cur=''; continue }
    cur += ch
  }
  out.push(cur); return out
}
function parseBool(v:any){
  const s = String(v).toLowerCase().trim()
  if (s==='true' || s==='1' || s==='si' || s==='sì' || s==='yes') return true
  if (s==='false' || s==='0' || s==='no') return false
  return (undefined as unknown) as any
}
function normStr(v:any){ const s=String(v??'').trim(); return s.length? s : null }
function toSource(v:any): 'Provided'|'Self'|null{
  const s=String(v||'').toLowerCase()
  if (s==='provided') return 'Provided'
  if (s==='self') return 'Self'
  return null
}
function sampleCSV(){
  return [
    'is_agency_client,email,phone,first_name,last_name,company_name,city,address,source,owner_email',
    'true,mario.rossi@example.com,,Mario,Rossi,,Milano,Via A 1,Provided,teamlead@advisoryplus.it',
    'false,,3331234567,Giulia,Bianchi,,,Self,junior1@advisoryplus.it',
    'true,azienda@example.com,,,,Azienda Srl,Roma,Via B 2,Provided,junior2@advisoryplus.it'
  ].join('\\n')
}

// NEW: parser XLSX che restituisce lo stesso schema del CSV
async function parseXLSX(file: File): Promise<any[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })

  // scegli \"template_leads\" se presente, altrimenti primo foglio
  const sheetName = wb.SheetNames.includes('template_leads')
    ? 'template_leads'
    : wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  if (!ws) throw new Error('Nessun foglio valido trovato nel file.')

  const raw: any[] = XLSX.utils.sheet_to_json(ws, { defval: null })
  if (!raw.length) return []

  const normalized = raw.map((row) => {
    const out: Record<string, any> = {}
    // inizializza tutte le colonne attese a null
    for (const h of EXPECTED_HEADERS) out[h] = null

    // copia valori facendo match case-insensitive delle chiavi
    for (const [k, v] of Object.entries(row)) {
      const nk = normalizeKey(k)
      const match = EXPECTED_HEADERS.find(h => h === nk)
      if (match) out[match] = v
    }

    // coercioni
    if (out.is_agency_client !== null) {
      const iv = String(out.is_agency_client).trim().toLowerCase()
      out.is_agency_client = (iv === 'true' || iv === '1' || iv === 'yes' || iv === 'si' || iv === 'sì')
    }
    for (const k of ['email','phone','first_name','last_name','company_name','city','address','source','owner_email']) {
      if (out[k] !== null && out[k] !== undefined) {
        out[k] = typeof out[k] === 'number' ? String(out[k]) : String(out[k]).trim()
        if (out[k] === '') out[k] = null
      }
    }
    return out
  })

  // verifica che le intestazioni attese siano rappresentate
  const missing = EXPECTED_HEADERS.filter(h => !(h in (normalized[0] || {})))
  if (missing.length) {
    throw new Error(
      `Intestazioni mancanti nel foglio \"${sheetName}\": ${missing.join(', ')}. ` +
      `Intestazioni attese: ${EXPECTED_HEADERS.join(', ')}`
    )
  }

  return normalized
}
