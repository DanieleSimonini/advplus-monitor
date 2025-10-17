import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/supabaseClient'

// ... (tutto il codice precedente invariato)

// === Sezione CONTRATTI aggiornata ===
{activeTab==='contratti' && (
  <div style={{ display:'grid', gap:12 }}>
    <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)', gap:12 }}>
      <div>
        <div style={label}>Data/Ora</div>
        <input type="datetime-local" style={ipt} value={ctrDraft.ts} onChange={e=>setCtrDraft((d:any)=>({ ...d, ts: e.target.value }))} />
      </div>
      <div>
        <div style={label}>Tipo contratto</div>
        <select style={ipt} value={ctrDraft.contract_type} onChange={e=>setCtrDraft((d:any)=>({ ...d, contract_type: e.target.value }))}>
          {CONTRACT_TYPE_OPTIONS.map(o=> <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div>
        <div style={label}>Importo (EUR)</div>
        <input type="number" style={ipt} value={ctrDraft.amount||0} onChange={e=>setCtrDraft((d:any)=>({ ...d, amount: Number(e.target.value||0) }))} />
      </div>
      <div style={{ gridColumn:'1 / span 3' }}>
        <div style={label}>Note</div>
        <textarea rows={2} maxLength={240} style={{ ...ipt, width:'100%' }} value={ctrDraft.notes||''} onChange={e=>setCtrDraft((d:any)=>({ ...d, notes:e.target.value }))} />
      </div>
    </div>

    <div>
      {editingCtrId ? (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button className="brand-btn" onClick={async()=>{
            if (!selectedId) return
            const payload = {
              ts: ctrDraft.ts || new Date().toISOString(),
              contract_type: ctrDraft.contract_type,
              line: ctrDraft.contract_type, // fix aggiunto
              amount: Number(ctrDraft.amount||0),
              notes: ctrDraft.notes||null
            }
            const { error } = await supabase.from('contracts').update(payload).eq('id', editingCtrId)
            if (error) alert(error.message); else {
              setEditingCtrId(null)
              setCtrDraft({ ts:'', contract_type: CONTRACT_TYPE_OPTIONS[0].value, amount:0, notes:'' })
              await loadContracts(selectedId)
            }
          }}>Salva</button>
          <button className="brand-btn" onClick={()=>{ setEditingCtrId(null); setCtrDraft({ ts:'', contract_type: CONTRACT_TYPE_OPTIONS[0].value, amount:0, notes:'' }) }}>Annulla</button>
        </div>
      ) : (
        <button className="brand-btn" onClick={async()=>{
          if (!selectedId){ alert('Seleziona prima un Lead'); return }
          const payload = {
            lead_id: selectedId,
            ts: ctrDraft.ts || new Date().toISOString(),
            contract_type: ctrDraft.contract_type,
            line: ctrDraft.contract_type, // fix aggiunto
            amount: Number(ctrDraft.amount||0),
            notes: ctrDraft.notes||null
          }
          const { error } = await supabase.from('contracts').insert(payload)
          if (error) alert(error.message); else {
            setCtrDraft({ ts:'', contract_type: CONTRACT_TYPE_OPTIONS[0].value, amount:0, notes:'' })
            await loadContracts(selectedId)
          }
        }}>Aggiungi contratto</button>
      )}
    </div>

    <div>
      {contracts.map(r=> (
        <div key={r.id} style={{ border:'1px solid var(--border, #eee)', borderRadius:10, padding:10, marginBottom:8, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
          <div>
            <div style={{ fontWeight:600 }}>{new Date(r.ts).toLocaleString()}</div>
            <div style={{ fontSize:12, color:'var(--muted, #666)' }}>Tipo: {r.contract_type} · Importo: {Number(r.amount||0).toLocaleString('it-IT',{ style:'currency', currency:'EUR' })}</div>
            {r.notes && <div style={{ fontSize:12 }}>{r.notes}</div>}
          </div>
          <div style={{ display:'inline-flex', gap:6 }}>
            <button title="Modifica" onClick={()=>{ setEditingCtrId(r.id); setCtrDraft({ ts: r.ts? r.ts.slice(0,16):'', contract_type: r.contract_type||CONTRACT_TYPE_OPTIONS[0].value, amount: Number(r.amount||0), notes: r.notes||'' }) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>✏️</button>
            <button title="Elimina" onClick={async()=>{ if (!selectedId) return; const ok = confirm('Eliminare il contratto?'); if (!ok) return; const { error } = await supabase.from('contracts').delete().eq('id', r.id); if (error) alert(error.message); else await loadContracts(selectedId) }} style={{ border:'none', background:'transparent', cursor:'pointer' }}>🗑️</button>
          </div>
        </div>
      ))}
    </div>
  </div>
)}
