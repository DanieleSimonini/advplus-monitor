import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'

/**
 * Obiettivi — pagina unica per Admin / Team Lead / Junior
 *
 * - Titolo pagina: "Obiettivi"
 * - "Nr. Consulenze" → "Nr. Appuntamenti" (solo label; dati su stessa colonna target_consulenze)
 * - Annuale/Mensile: prima riga = Nr. Appuntamenti + Nr. Contratti; seconda riga = produzione
 * - Junior: visualizzazione sola lettura (campi read-only, Reset/Salva nascosti)
 * - Team Lead: non può modificare i propri obiettivi; può modificare i Junior del proprio team
 * - Admin: può modificare tutti (nel filtro non compaiono Admin)
 * - Default: Admin → un Team Lead; Team Lead/Junior → se stessi
 *
 * Patch salvataggio:
 * - Niente upsert(); check esistenza → update/insert
 * - throwOnError() per chiudere sempre l’await (successo/errore)
 * - abortSignal + timeout difensivo
 */

type Role = 'Admin' | 'Team Lead' | 'Junior'

type Advisor = {
  id: string
  user_id: string
  full_name: string | null
  email: string
  role: Role
  team_lead_user_id?: string | null
}

type AnnualGoals = {
  advisor_user_id: string
  year: number
  target_consulenze: number
  target_contratti: number
  target_prod_danni: number
  target_prod_vprot: number
  target_prod_vpr: number
  target_prod_vpu: number
}

type MonthlyGoals = AnnualGoals & { month: number }

type MonthlyProgress = {
  month: number
  consulenze: number
  contratti: number
  prod_danni: number
  prod_vprot: number
  prod_vpr: number
  prod_vpu: number
}

/* ====== UI styles ====== */
const box: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #eee',
  borderRadius: 16,
  padding: 16,
}
const btn: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid #ddd',
  background: '#fff',
  cursor: 'pointer',
}
const cta: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid #111',
  background: '#111',
  color: '#fff',
  cursor: 'pointer',
}
const ipt: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid #ddd',
  width: '100%',
  boxSizing: 'border-box',
  background: '#fff',
  color: '#111',
}
const gridTwoRows: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(260px, 1fr))',
  gap: 12,
}
const gridWide: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 12,
}
const title: React.CSSProperties = { fontWeight: 700, marginBottom: 12, fontSize: 20 }

export default function GoalsTLPage() {
  const [me, setMe] = useState<Advisor | null>(null)
  const [list, setList] = useState<Advisor[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const [advisorUserId, setAdvisorUserId] = useState<string>('')
  const [monthKey, setMonthKey] = useState<string>(toMonthKey(new Date())) // YYYY-MM

  const year = useMemo(() => Number(monthKey.slice(0, 4)), [monthKey])
  const month = useMemo(() => Number(monthKey.slice(5, 7)), [monthKey])

  const [annual, setAnnual] = useState<AnnualGoals | null>(null)
  const [monthly, setMonthly] = useState<MonthlyGoals | null>(null)
  const [progress, setProgress] = useState<MonthlyProgress[]>([])
  const [saving, setSaving] = useState(false)

  /* ===== Bootstrap: me + lista advisors (no Admin selezionabili) ===== */
  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const u = await supabase.auth.getUser()
        const email = u.data.user?.email
        if (!email) throw new Error('Utente non autenticato')

        const { data: meRow, error: meErr } = await supabase
          .from('advisors')
          .select('id,user_id,full_name,email,role,team_lead_user_id')
          .eq('email', email)
          .maybeSingle()
        if (meErr || !meRow) throw new Error(meErr?.message || 'Advisor non trovato')

        const meAdv: Advisor = {
          id: meRow.id,
          user_id: meRow.user_id,
          full_name: meRow.full_name,
          email: meRow.email,
          role: meRow.role as Role,
          team_lead_user_id: meRow.team_lead_user_id,
        }
        setMe(meAdv)

        let selectable: Advisor[] = []

        if (meAdv.role === 'Admin') {
          const { data, error } = await supabase
            .from('advisors')
            .select('id,user_id,full_name,email,role,team_lead_user_id')
            .in('role', ['Team Lead', 'Junior'] as Role[])
            .order('role', { ascending: false })
            .order('full_name', { ascending: true })
          if (error) throw error
          selectable = (data || []) as Advisor[]
          const firstTL = selectable.find((a) => a.role === 'Team Lead')
          setAdvisorUserId(firstTL?.user_id || selectable[0]?.user_id || '')
        } else if (meAdv.role === 'Team Lead') {
          const { data, error } = await supabase
            .from('advisors')
            .select('id,user_id,full_name,email,role,team_lead_user_id')
            .or(`user_id.eq.${meAdv.user_id},team_lead_user_id.eq.${meAdv.user_id}`)
            .not('role', 'eq', 'Admin')
            .order('role', { ascending: false })
            .order('full_name', { ascending: true })
          if (error) throw error
          selectable = (data || []) as Advisor[]
          setAdvisorUserId(meAdv.user_id)
        } else {
          selectable = [meAdv]
          setAdvisorUserId(meAdv.user_id)
        }

        setList(selectable)
      } catch (e: any) {
        setError(e.message || 'Errore inizializzazione')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  /* ===== Caricamento dati (annual/monthly/progress) ===== */
  useEffect(() => {
    ;(async () => {
      if (!advisorUserId || !year) return
      setError('')
      const ann = await getAnnual(advisorUserId, year)
      const mon = await getMonthly(advisorUserId, year, month)
      const prog = await getProgress(advisorUserId, year)
      setAnnual(ann)
      setMonthly(mon)
      setProgress(prog)
    })()
  }, [advisorUserId, year, month])

  /* ===== Permessi ===== */
  const canEdit = useMemo(() => {
    if (!me) return false
    if (me.role === 'Admin') return true
    if (me.role === 'Team Lead') return advisorUserId !== me.user_id
    return false
  }, [me, advisorUserId])

  const isJuniorView = me?.role === 'Junior'
  const advisorSelectDisabled = isJuniorView

  /* ===== Azioni ===== */
  const onReset = async () => {
    if (!advisorUserId || !canEdit) return
    if (!window.confirm('Resettare i campi alla situazione salvata?')) return
    const ann = await getAnnual(advisorUserId, year)
    const mon = await getMonthly(advisorUserId, year, month)
    setAnnual(ann)
    setMonthly(mon)
  }

  const onSave = async () => {
    if (!canEdit) return alert('Non autorizzato')
    if (!advisorUserId) return alert('Seleziona un advisor')

    setSaving(true)
    setError('')
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)

      if (annual) await saveAnnual(annual, { signal: controller.signal })
      if (monthly) await saveMonthly(monthly, { signal: controller.signal })

      clearTimeout(timer)
      setSaving(false)
      alert('Obiettivi salvati')
    } catch (e: any) {
      setSaving(false)
      setError(e?.message || 'Errore di salvataggio')
      console.error('save error', e)
      alert(`Errore di salvataggio: ${e?.message || e}`)
    }
  }

  const selectedAdv = useMemo(
    () => list.find((t) => t.user_id === advisorUserId) || null,
    [list, advisorUserId]
  )

  const ro =
    !canEdit
      ? {
          disabled: true,
          readOnly: true,
          style: { ...ipt, background: '#f8fafc', color: '#555', cursor: 'not-allowed' } as React.CSSProperties,
        }
      : {}

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={title}>Obiettivi</div>
      {error && <div style={{ color: '#c00' }}>{error}</div>}
      {loading && <div>Caricamento…</div>}

      {/* FILTRI */}
      <div style={{ ...box }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <div style={{ minWidth: 260 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Advisor</div>
            <select
              value={advisorUserId}
              onChange={(e) => setAdvisorUserId(e.target.value)}
              style={ipt}
              disabled={advisorSelectDisabled}
            >
              {isJuniorView ? (
                <option value={me?.user_id || ''}>{me?.full_name || me?.email}</option>
              ) : (
                <>
                  <option value="">—</option>
                  {list
                    .filter((a) => a.role !== 'Admin')
                    .map((a) => (
                      <option key={a.user_id} value={a.user_id}>
                        {a.full_name || a.email} {a.role !== 'Junior' ? `(${a.role})` : ''}
                      </option>
                    ))}
                </>
              )}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Mese</div>
            <input type="month" value={monthKey} onChange={(e) => setMonthKey(e.target.value)} style={ipt} />
          </div>

          {!isJuniorView && (
            <div>
              <button style={btn} onClick={() => setMonthKey(toMonthKey(new Date()))}>
                Mese corrente
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ANNUALE */}
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700 }}>
            Obiettivi Annuali — {selectedAdv ? selectedAdv.full_name || selectedAdv.email : '—'} — {year}
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btn} onClick={onReset}>Reset</button>
              <button style={cta} onClick={onSave} disabled={saving}>
                {saving ? 'Salvataggio…' : 'Salva'}
              </button>
            </div>
          )}
        </div>

        <div style={gridTwoRows}>
          {annualInput('Nr. Appuntamenti', annual?.target_consulenze ?? 0, v => setAnnual(p => p ? { ...p, target_consulenze: v } : makeAnnual(advisorUserId, year, { target_consulenze: v })), ro)}
          {annualInput('Nr. Contratti', annual?.target_contratti ?? 0, v => setAnnual(p => p ? { ...p, target_contratti: v } : makeAnnual(advisorUserId, year, { target_contratti: v })), ro)}
        </div>

        <div style={{ ...gridWide, marginTop: 12 }}>
          {annualInput('Produzione Danni Non Auto (€)', annual?.target_prod_danni ?? 0, v => setAnnual(p => p ? { ...p, target_prod_danni: v } : makeAnnual(advisorUserId, year, { target_prod_danni: v })), ro)}
          {annualInput('Produzione Vita Protection (€)', annual?.target_prod_vprot ?? 0, v => setAnnual(p => p ? { ...p, target_prod_vprot: v } : makeAnnual(advisorUserId, year, { target_prod_vprot: v })), ro)}
          {annualInput('Produzione Vita Premi Ricorrenti (€)', annual?.target_prod_vpr ?? 0, v => setAnnual(p => p ? { ...p, target_prod_vpr: v } : makeAnnual(advisorUserId, year, { target_prod_vpr: v })), ro)}
          {annualInput('Produzione Vita Premi Unici (€)', annual?.target_prod_vpu ?? 0, v => setAnnual(p => p ? { ...p, target_prod_vpu: v } : makeAnnual(advisorUserId, year, { target_prod_vpu: v })), ro)}
        </div>
      </div>

      {/* MENSILE */}
      <div style={box}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Obiettivi Mensili — {monthKey}</div>

        <div style={gridTwoRows}>
          {monthlyInput('Nr. Appuntamenti', monthly?.target_consulenze ?? 0, v => setMonthly(p => p ? { ...p, target_consulenze: v } : makeMonthly(advisorUserId, year, month, { target_consulenze: v })), ro)}
          {monthlyInput('Nr. Contratti', monthly?.target_contratti ?? 0, v => setMonthly(p => p ? { ...p, target_contratti: v } : makeMonthly(advisorUserId, year, month, { target_contratti: v })), ro)}
        </div>

        <div style={{ ...gridWide, marginTop: 12 }}>
          {monthlyInput('Produzione Danni Non Auto (€)', monthly?.target_prod_danni ?? 0, v => setMonthly(p => p ? { ...p, target_prod_danni: v } : makeMonthly(advisorUserId, year, month, { target_prod_danni: v })), ro)}
          {monthlyInput('Produzione Vita Protection (€)', monthly?.target_prod_vprot ?? 0, v => setMonthly(p => p ? { ...p, target_prod_vprot: v } : makeMonthly(advisorUserId, year, month, { target_prod_vprot: v })), ro)}
          {monthlyInput('Produzione Vita Premi Ricorrenti (€)', monthly?.target_prod_vpr ?? 0, v => setMonthly(p => p ? { ...p, target_prod_vpr: v } : makeMonthly(advisorUserId, year, month, { target_prod_vpr: v })), ro)}
          {monthlyInput('Produzione Vita Premi Unici (€)', monthly?.target_prod_vpu ?? 0, v => setMonthly(p => p ? { ...p, target_prod_vpu: v } : makeMonthly(advisorUserId, year, month, { target_prod_vpu: v })), ro)}
        </div>
      </div>

      {/* PROGRESS */}
      <div style={box}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Andamento {year}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 12 }}>
          <SparkCard label="Appuntamenti" data={progress.map(p => p.consulenze)} />
          <SparkCard label="Contratti" data={progress.map(p => p.contratti)} />
          <SparkCard label="Produzione (€)" data={progress.map(p => (p.prod_danni + p.prod_vprot + p.prod_vpr + p.prod_vpu))} fmt="€" />
        </div>
      </div>
    </div>
  )
}

/* ===== Helper UI ===== */
function annualInput(label: string, value: number, onChange: (v: number) => void, ro: any) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{label}</div>
      <input type="number" value={value} onChange={e => onChange(Number(e.target.value || 0))} style={ro.style || ipt} disabled={ro.disabled} readOnly={ro.readOnly} />
    </div>
  )
}
function monthlyInput(label: string, value: number, onChange: (v: number) => void, ro: any) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{label}</div>
      <input type="number" value={value
