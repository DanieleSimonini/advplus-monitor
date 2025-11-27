export default function ReportPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [advisors, setAdvisors] = useState<{ user_id: string, email: string, full_name: string | null }[]>([])
  const today = new Date()
  const [fromKey, setFromKey] = useState(toMonthKey(addMonths(today, -5)))
  const [toKey, setToKey] = useState(toMonthKey(today))
  const [advisorUid, setAdvisorUid] = useState<string>('')
  const [myTeam, setMyTeam] = useState<boolean>(false)
  const [annualMode, setAnnualMode] = useState<boolean>(false)

  const [goals, setGoals] = useState<GoalsRow[]>([])
  const [prog, setProg] = useState<ProgressRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      setLoading(true); setErr('')
      try {
        const { data: auth } = await supabase.auth.getUser()
        const uid = auth.user?.id
        if (!uid) { setErr('Utente non autenticato'); setLoading(false); return }

        const { data: meRow, error: meErr } = await supabase
          .from('advisors')
          .select('id,user_id,email,full_name,role')
          .eq('user_id', uid)
          .maybeSingle()
        if (meErr) throw meErr
        if (!meRow) { setErr('Profilo non trovato'); setLoading(false); return }

        setMe({
          id: meRow.id,
          user_id: meRow.user_id,
          email: meRow.email,
          full_name: meRow.full_name,
          role: meRow.role as Role
        })
        setAdvisorUid(uid)

        if (meRow.role === 'Admin' || meRow.role === 'Team Lead') {
          const { data: list, error: lerr } = await supabase
            .from('advisors')
            .select('user_id,email,full_name')
            .order('full_name', { ascending: true })
          if (lerr) throw lerr
          setAdvisors((list || []).filter(x => !!x.user_id) as any)
        }
      } catch (ex: any) { setErr(ex.message || 'Errore bootstrap') }
      finally { setLoading(false) }
    })()
  }, [])

  useEffect(() => {
    (async () => {
      if (!advisorUid || !me) return
      setLoading(true); setErr('')
      try {
        const rng = monthRange(fromKey, toKey)
        const years = Array.from(new Set(rng.map(r => r.y)))

        let scopeUserIds: string[] = [advisorUid]
        if (myTeam && (me.role === 'Team Lead' || me.role === 'Admin')) {
          const teamLead = me.role === 'Admin' ? advisorUid : me.user_id
          const { data: team, error: teamErr } = await supabase
            .from('advisors')
            .select('user_id,team_lead_user_id')
            .or(`user_id.eq.${teamLead},team_lead_user_id.eq.${teamLead}`)
          if (teamErr) throw teamErr
          scopeUserIds = (team || []).map(r => r.user_id).filter(Boolean)
        }

        const progRows: ProgressRow[] = []
        for (const y of years) {
          const months = rng.filter(r => r.y === y).map(r => r.m)
          const { data, error } = await supabase
            .from('v_progress_monthly')
            .select('advisor_user_id,year,month,consulenze,contratti,prod_danni,prod_vprot,prod_vpr,prod_vpu')
            .eq('year', y)
            .in('month', months)
            .in('advisor_user_id', scopeUserIds)
          if (error) throw error
          if (myTeam) {
            const acc = groupSumByYM(data || [])
            progRows.push(...acc)
          } else {
            progRows.push(...(data || []))
          }
        }
        setProg(progRows)

        const goalsRows = await loadGoalsMonthlyFromGoalsTable({ rng, years, scopeUserIds, isTeam: myTeam })
          .catch(async () => await loadGoalsMonthlyFromViews({ rng, years, scopeUserIds, isTeam: myTeam }))

        setGoals(goalsRows)
      } catch (ex: any) { setErr(ex.message || 'Errore caricamento dati') }
      finally { setLoading(false) }
    })()
  }, [advisorUid, fromKey, toKey, myTeam, me])

  const rows = useMemo(
    () => mergeByMonth(goals, prog, fromKey, toKey),
    [goals, prog, fromKey, toKey]
  )
  const totals = useMemo(
    () => aggregateTotals(rows),
    [rows]
  )

  const handleFromMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    if (annualMode) {
      const year = v.split('-')[0]
      setFromKey(`${year}-01`)
      setToKey(`${year}-12`)
    } else {
      setFromKey(v)
    }
  }

  const handleToMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    if (annualMode) {
      const year = v.split('-')[0]
      setFromKey(`${year}-01`)
      setToKey(`${year}-12`)
    } else {
      setToKey(v)
    }
  }

  const handleAnnualToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked
    setAnnualMode(checked)
    if (checked) {
      const year = toKey.split('-')[0]
      setFromKey(`${year}-01`)
      setToKey(`${year}-12`)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Report — Andamento vs Obiettivi</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={meta}>Dal</label>
          <input
            type="month"
            value={fromKey}
            onChange={handleFromMonthChange}
            style={input}
            disabled={annualMode}
          />

          <label style={meta}>al</label>
          <input
            type="month"
            value={toKey}
            onChange={handleToMonthChange}
            style={input}
          />

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...meta }}>
            <input
              type="checkbox"
              checked={annualMode}
              onChange={handleAnnualToggle}
            />
            Modalità annuale
          </label>

          {me && (me.role === 'Team Lead' || me.role === 'Admin') && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...meta }}>
              <input
                type="checkbox"
                checked={myTeam}
                onChange={e => setMyTeam(e.target.checked)}
              />
              Tutto il Team
            </label>
          )}

          {me && (me.role === 'Admin' || me.role === 'Team Lead') ? (
            <>
              <label style={meta}>Advisor</label>
              <select
                value={advisorUid}
                onChange={e => setAdvisorUid(e.target.value)}
                style={input}
              >
                {me && (
                  <option value={me.user_id}>
                    — {me.full_name || me.email} (me)
                  </option>
                )}
                {advisors
                  .filter(a => a.user_id !== me?.user_id)
                  .map(a => (
                    <option key={a.user_id} value={a.user_id}>
                      {a.full_name || a.email}
                    </option>
                  ))}
              </select>
            </>
          ) : (
            <div style={meta}>Advisor: solo me</div>
          )}
        </div>
      </div>

      {err && <div style={{ ...card, color: '#c00' }}>{err}</div>}

      <div style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: typeof window !== 'undefined' && window.innerWidth < 1024
          ? '1fr'
          : 'minmax(0,1.25fr) minmax(300px,0.75fr)'
      }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <MetricCard title="Appuntamenti" field="consulenze" rows={rows} format="int" />
          <MetricCard title="Contratti" field="contratti" rows={rows} format="int" />
          <MetricCard title="Produzione Danni Non Auto" field="prod_danni" rows={rows} format="currency" />
          <MetricCard title="Vita Protection" field="prod_vprot" rows={rows} format="currency" />
          <MetricCard title="Vita Premi Ricorrenti" field="prod_vpr" rows={rows} format="currency" />
          <MetricCard title="Vita Premi Unici" field="prod_vpu" rows={rows} format="currency" />
        </div>
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <MirrorCard title="Appuntamenti" goal={totals.goal.consulenze} actual={totals.actual.consulenze} format="int" />
          <MirrorCard title="Contratti" goal={totals.goal.contratti} actual={totals.actual.contratti} format="int" />
          <MirrorCard title="Danni Non Auto" goal={totals.goal.prod_danni} actual={totals.actual.prod_danni} format="currency" />
          <MirrorCard title="Vita Protection" goal={totals.goal.prod_vprot} actual={totals.actual.prod_vprot} format="currency" />
          <MirrorCard title="Vita Premi Ricorrenti" goal={totals.goal.prod_vpr} actual={totals.actual.prod_vpr} format="currency" />
          <MirrorCard title="Vita Premi Unici" goal={totals.goal.prod_vpu} actual={totals.actual.prod_vpu} format="currency" />
        </div>
      </div>

      {loading && <div style={{ color: '#666' }}>Caricamento…</div>}
    </div>
  )
}
