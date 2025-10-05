import React, { useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

/**
 * ImportLeads.tsx — Import CSV/XLSX con validazione + dedup
 * Requisiti
 * - Campi richiesti: is_agency_client, (email OR phone), (first_name+last_name OR company_name)
 * - Dedup vs DB: scarta se email o phone già presenti in public.leads
 * - Owner mapping: se owner_email non esiste in advisors → blocca import
 * - Pulsante Import disabilitato se ci sono errori di validazione
 * - Supporto CSV; XLSX con fallback se libreria non presente
 */

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
  source: 'Provided'|'Self'|null
  owner_email: string
}

type Report = { valid: ValidRow[]; errors: string[] }

const box: React.CSSProperties = { background:'#fff', border:'1px solid #eee', borderRadius:16, padding:16 }
const ipt: React.CSSProperties = { padding:'8px 10px', borderRadius:8, border:'1px solid #ddd' }

export default function ImportLeadsPage(){
  const [rows, setRows] = useState<RawRow[] | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [dupes, setDupes] = useState<{ email:Set<string>; phone:Set<string> }>({ email:new Set(), phone:new Set() })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const sample = useMemo(()=> sampleCSV(), [])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>){
    const f = e.target.files?.[0]
    if (!f) return
    setError(''); setRows(null); setReport(null)
    try{
      if (f.name.toLowerCase().endsWith('.csv')){
        const text = await f.text()
        const parsed = parseCSV(text)
        setRows(parsed)
      } else if (f.name.toLowerCase().endsWith('.xlsx') || f.name.toLowerCase().endsWith('.xls')){
        try{
          const XLSX = await import('xlsx')
          const data = await f.arrayBuffer()
          const wb = XLSX.read(data)
          const ws = wb.Sheets[wb.SheetNames[0]]
          const json = XLSX.utils.sheet_to_json(ws, { defval: '' }) as RawRow[]
          setRows(json)
        } catch{
          setError('File Excel non supportato in questo build. Carica un CSV oppure chiedimi di aggiungere la dipendenza "xlsx" in package.json.')
        }
      } else {
        setError('Formato non supportato. Carica un .csv o .xlsx')
      }
    } catch(ex:any){ setError(ex.message || 'Errore lettura file') }
  }

  async function validate(){
    if (!rows || rows.length===0){ setReport({ valid:[], errors:['Nessuna riga nel file.'] }); return }
    setLoading(true); setError('')
    try{
      // 1) Owner mapping
      const ownerEmails = Array.from(new Set(rows.map(r => String(r.owner_email||'').trim()).filter(Boolean)))
      const { data: advs, error: aerr } = await supabase
        .from('advisors')
        .select('user_id,email')
        .in('email', ownerEmails)
      if (aerr) throw aerr
      const byEmail = new Map<string,string>()
      for(const a of (advs||[])) byEmail.set(a.email, a.user_id)
      const missing = ownerEmails.filter(e => !byEmail.has(e))
      if (missing.length>0){
        setReport({ valid:[], errors:[`owner_email non trovati in advisors: ${missing.join(', ')}`] })
        return
      }

      // 2) Dedup vs DB
      const emails = Array.from(new Set(rows.map(r => String(r.email||'').trim()).filter(Boolean)))
      const phones = Array.from(new Set(rows.map(r => String(r.phone||'').trim()).filter(Boolean)))
      const [dbE, dbP] = await Promise.all([
        emails.length ? supabase.from('leads').select('email').in('email', emails) : Promise.resolve({ data:[] as any }),
        phones.length ? supabase.from('leads').select('phone').in('phone', phones) : Promise.resolve({ data:[] as any })
      ])
      const dbEmails = new Set<string>((dbE.data||[]).map((r:any)=>String(r.email)))
      const dbPhones = new Set<string>((dbP.data||[]).map((r:any)=>String(r.phone)))
      setDupes({ email: dbEmails, phone: dbPhones })

      // 3) Validazione righe
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
        // Obbligatorietà
        if (typeof v.is_agency_client !== 'boolean') errors.push(`${ctx}: is_agency_client deve essere true/false`)
        if (!v.email && !v.phone) errors.push(`${ctx}: indicare email oppure phone`)
        if (!((v.first_name && v.last_name) || v.company_name)) errors.push(`${ctx}: servono nome+cognome oppure ragione sociale`)
        // Dedup runtime
        if (v.email && dbEmails.has(v.email)) errors.push(`${ctx}: email già presente a DB`)
        if (v.phone && dbPhones.has(v.phone)) errors.push(`${ctx}: phone già presente a DB`)
        // Owner mapping (già verificato complessivo, ma check anche per riga)
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
      // fetch mappa email->user_id
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
      setRows(null); setReport(null)
    } catch(ex:any){ setError(ex.message || 'Errore durante import') }
    finally{ setLoading(false) }
  }

  return (
    <div style={{ display:'grid', gap:16 }}>
      <div style={{ fontSize:20, fontWeight:800 }}>Importa Leads</div>

      <div style={{ ...box }}>
        <div style={{ display:'grid', gap:10 }}>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} />
          <div style={{ fontSize:12, color:'#666' }}>Formato atteso (intestazioni): <code>is_agency_client,email,phone,first_name,last_name,company_name,city,address,source,owner_email</code></div>
          <details>
            <summary>Scarica un esempio CSV</summary>
            <textarea readOnly style={{ width:'100%', height:120, ...ipt }}>{sample}</textarea>
          </details>
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
              <ul>{report.errors.slice(0,50).map((e,i)=> <li key={i} style={{ color:'#c00' }}>{e}</li>)}</ul>
            </div>
          ) : (
            <div style={{ color:'#080' }}>Nessun errore. Puoi procedere con l'import.</div>
          )}
        </div>
      )}
    </div>
  )
}

function parseCSV(text: string): RawRow[]{
  // CSV semplice: separatore "," o ";" e header obbligatorio
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
  const out:string[] = []
  let cur = ''
  let inQ = false
  for(let i=0;i<line.length;i++){
    const ch = line[i]
    if (ch==='"') { inQ = !inQ; continue }
    if (ch===sep && !inQ){ out.push(cur); cur=''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}

function parseBool(v:any){
  const s = String(v).toLowerCase().trim()
  if (s==='true' || s==='1' || s==='si' || s==='sì' || s==='yes') return true
  if (s==='false' || s==='0' || s==='no') return false
  return (undefined as unknown) as any
}
function normStr(v:any){ const s=String(v??'').trim(); return s.length? s : null }
function toSource(v:any): 'Provided'|'Self'|null{ const s=String(v||'').toLowerCase(); if(s==='provided') return 'Provided'; if(s==='self') return 'Self'; return null }

function sampleCSV(){
  return [
    'is_agency_client,email,phone,first_name,last_name,company_name,city,address,source,owner_email',
    'true,mario.rossi@example.com,,Mario,Rossi,,Milano,Via A 1,Provided,teamlead@advisoryplus.it',
    'false,,3331234567,Giulia,Bianchi,,,Self,junior1@advisoryplus.it',
    'true,azienda@example.com,,,,Azienda Srl,Roma,Via B 2,Provided,junior2@advisoryplus.it'
  ].join('\n')
}

const th: React.CSSProperties = { textAlign:'left', padding:'6px 8px', borderBottom:'1px solid #eee', background:'#fafafa' }
const td: React.CSSProperties = { padding:'6px 8px', borderBottom:'1px solid #f5f5f5' }
