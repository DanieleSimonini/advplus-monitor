import React, { useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'

type Row = {
  owner_email: string
  is_agency_client: string | boolean
  first_name?: string
  last_name?: string
  company_name?: string
  email?: string
  phone?: string
  city?: string
  address?: string
  source?: 'Provided' | 'Self'
}

const box: React.CSSProperties = { background:'#fff', border:'1px solid #eee', borderRadius:16, padding:16 }
const ipt: React.CSSProperties = { padding:'10px 12px', borderRadius:10, border:'1px solid #ddd', width:'100%' }
const cta: React.CSSProperties = { padding:'10px 12px', borderRadius:10, border:'1px solid #111', background:'#111', color:'#fff', cursor:'pointer' }
const muteBtn: React.CSSProperties = { ...cta, background:'#f2f2f2', color:'#888', borderColor:'#ddd', cursor:'not-allowed' }

export default function ImportLeads() {
  const [step, setStep] = useState<'upload'|'validate'|'summary'>('upload')
  const [csvText, setCsvText] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [validResult, setValidResult] = useState<{status:'invalid'|'valid'|'ok', errors?: any[], to_insert?: number, inserted?: number, skipped_duplicates?: number}>({status:'invalid'})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')

  const templateHeaders = useMemo(()=>[
    'owner_email','is_agency_client','first_name','last_name','company_name',
    'email','phone','city','address','source'
  ], [])

  const parseCsv = (text: string): Row[] => {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length>0)
    if (!lines.length) return []
    const hdr = lines[0].split(',').map(h => h.trim())
    // check headers
    for (const h of templateHeaders) {
      if (!hdr.includes(h)) throw new Error(`Colonna mancante: ${h}`)
    }
    const out: Row[] = []
    for (let i=1;i<lines.length;i++){
      const cols = safeSplitCsvLine(lines[i])
      const obj: any = {}
      hdr.forEach((h,idx)=> obj[h] = (cols[idx] ?? '').trim())
      out.push(obj as Row)
    }
    return out
  }

  const onFile = async (f: File) => {
    setError('')
    if (!f.name.toLowerCase().endsWith('.csv')) {
      setError('Per ora supportiamo CSV. (Possiamo aggiungere .xlsx in seguito.)')
      return
    }
    const text = await f.text()
    setCsvText(text)
    try {
      const r = parseCsv(text)
      setRows(r)
      setStep('validate')
    } catch (e:any) {
      setError(e.message || String(e))
    }
  }

  const onValidate = async () => {
    setLoading(true); setError('')
    const { data, error } = await supabase.functions.invoke('import_leads', { body: { rows, dryRun: true } })
    setLoading(false)
    if (error) { setError(error.message || 'Errore validazione'); return }
    setValidResult(data as any)
    setStep('summary')
  }

  const onImport = async () => {
    setLoading(true); setError('')
    const { data, error } = await supabase.functions.invoke('import_leads', { body: { rows, dryRun: false } })
    setLoading(false)
    if (error) { setError(error.message || 'Errore import'); return }
    setValidResult(data as any)
    // status sarà 'ok'
  }

  const canImport = validResult.status === 'valid' || validResult.status === 'ok'
  const hasBlockingErrors = validResult.status === 'invalid' && (validResult.errors?.length || 0) > 0

  return (
    <div style={{ display:'grid', gap:16 }}>
      <div style={{ fontWeight:700 }}>Import Leads</div>

      {step === 'upload' && (
        <div style={box}>
          <div style={{ fontWeight:600, marginBottom:8 }}>1) Carica CSV</div>
          <div style={{ fontSize:13, color:'#666', marginBottom:8 }}>
            Usa il template con colonne: <code>{templateHeaders.join(', ')}</code>
          </div>
          <input type="file" accept=".csv" onChange={e=>{ if (e.target.files?.[0]) onFile(e.target.files[0]) }} />
          <div style={{ marginTop:12, fontSize:12, color:'#666' }}>Oppure incolla CSV qui sotto:</div>
          <textarea value={csvText} onChange={e=>setCsvText(e.target.value)} placeholder="Incolla qui il CSV" style={{ ...ipt, height:120 }} />
          <div style={{ marginTop:8, display:'flex', gap:8 }}>
            <button
              onClick={()=>{
                try { const r = parseCsv(csvText); setRows(r); setStep('validate'); setError('') } catch(e:any){ setError(e.message || String(e)) }
              }}
              style={cta}
            >Prosegui</button>
            <a
              href={'data:text/csv;charset=utf-8,'+encodeURIComponent(sampleCsv)}
              download="template_import_leads.csv"
              style={{ ...cta, background:'#fff', color:'#111', textDecoration:'none', display:'inline-block' }}
            >Scarica template CSV</a>
          </div>
          {error && <div style={{ marginTop:8, color:'#c00' }}>{error}</div>}
        </div>
      )}

      {step === 'validate' && (
        <div style={box}>
          <div style={{ fontWeight:600, marginBottom:8 }}>2) Valida</div>
          <div style={{ fontSize:13, color:'#666', marginBottom:12 }}>
            Controlliamo: presenza owner, regole obbligatorie e duplicati su DB.
          </div>
          <button onClick={onValidate} style={cta} disabled={loading}>{loading? 'Validazione…':'Esegui validazione'}</button>
          {!!rows.length && (
            <div style={{ marginTop:16 }}>
              <div style={{ fontWeight:600, marginBottom:6 }}>Anteprima (prime 10 righe):</div>
              <PreviewTable rows={rows.slice(0,10)} />
            </div>
          )}
          {error && <div style={{ marginTop:8, color:'#c00' }}>{error}</div>}
        </div>
      )}

      {step === 'summary' && (
        <div style={box}>
          <div style={{ fontWeight:600, marginBottom:8 }}>3) Summary</div>
          {validResult.status === 'invalid' && (
            <>
              <div style={{ color:'#c00', marginBottom:8 }}>Errori trovati. Correggi il file e rilancia la validazione.</div>
              <ErrorList items={validResult.errors || []} />
              <div style={{ marginTop:12, display:'flex', gap:8 }}>
                <button onClick={()=>setStep('upload')} style={{ ...cta, background:'#fff', color:'#111' }}>Torna all’upload</button>
                <button disabled style={muteBtn}>Importa</button>
              </div>
            </>
          )}
          {validResult.status !== 'invalid' && (
            <>
              <div style={{ marginBottom:6 }}>
                {validResult.status === 'valid' && (
                  <div>Valido. Righe da inserire: <b>{validResult.to_insert || 0}</b>. Duplicati da saltare: <b>{validResult.skipped_duplicates || 0}</b>.</div>
                )}
                {validResult.status === 'ok' && (
                  <div>Import completato. Inserite: <b>{validResult.inserted || 0}</b>. Duplicati saltati: <b>{validResult.skipped_duplicates || 0}</b>.</div>
                )}
              </div>
              <div style={{ marginTop:12, display:'flex', gap:8 }}>
                {validResult.status === 'valid' && (
                  <button onClick={onImport} style={cta} disabled={loading}>{loading? 'Import in corso…':'Importa'}</button>
                )}
                <button onClick={()=>{ setStep('upload'); setValidResult({status:'invalid'}); }} style={{ ...cta, background:'#fff', color:'#111' }}>Nuovo import</button>
              </div>
            </>
          )}
          {error && <div style={{ marginTop:8, color:'#c00' }}>{error}</div>}
        </div>
      )}
    </div>
  )
}

function PreviewTable({ rows }: { rows: Row[] }) {
  if (!rows.length) return null
  const headers = Object.keys(rows[0]!)
  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
        <thead>
          <tr>{headers.map(h => <th key={h} style={{ textAlign:'left', padding:'6px 8px', borderBottom:'1px solid #eee', color:'#666' }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {headers.map(h => <td key={h} style={{ padding:'6px 8px', borderBottom:'1px solid #f4f4f4' }}>{String((r as any)[h] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ErrorList({ items }: { items: any[] }) {
  if (!items?.length) return null
  return (
    <div style={{ maxHeight: 220, overflow:'auto', border:'1px solid #f2d6d6', borderRadius:8, padding:8, background:'#fff7f7' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
        <thead>
          <tr>
            <th style={{ textAlign:'left', padding:'4px 6px' }}>Riga</th>
            <th style={{ textAlign:'left', padding:'4px 6px' }}>Campo</th>
            <th style={{ textAlign:'left', padding:'4px 6px' }}>Errore</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e, i) => (
            <tr key={i}>
              <td style={{ padding:'4px 6px' }}>{e.row}</td>
              <td style={{ padding:'4px 6px' }}>{e.field}</td>
              <td style={{ padding:'4px 6px' }}>{e.msg}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// CSV naive: gestisce campi semplici e campi quotati con virgole
function safeSplitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i=0;i<line.length;i++){
    const ch = line[i]
    if (ch === '"' ) {
      // doppio apice → escape
      if (inQ && line[i+1] === '"') { cur += '"'; i++; continue }
      inQ = !inQ
      continue
    }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}

const sampleCsv =
`owner_email,is_agency_client,first_name,last_name,company_name,email,phone,city,address,source
teamlead@advisoryplus.it,true,Mario,Rossi,,mario.rossi@mail.it,3331234567,Milano,Via Roma 1,Provided
ja.bianchi@advisoryplus.it,false,,,ACME Srl,acme@acme.it,,Torino,Corso Francia 99,Self
`
