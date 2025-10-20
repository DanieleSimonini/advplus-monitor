// === BRANCH: Il Mio Team (TL o Admin) ===
if (myTeam && (me.role === 'Team Lead' || me.role === 'Admin')) {
  // Determina di quale team calcolare la somma:
  // - se sono TL → il mio team
  // - se sono Admin → il team del TL selezionato (advisorUid)
  const teamLeadId = me.role === 'Admin' ? advisorUid : me.user_id

  // 1️⃣ recupera tutti gli user_id del team (TL + junior)
  const { data: teamList, error: teamErr } = await supabase
    .from('advisors')
    .select('user_id')
    .or(`user_id.eq.${teamLeadId},team_lead_user_id.eq.${teamLeadId}`)
  if (teamErr) throw teamErr
  const ids = (teamList||[]).map(r=>r.user_id)

  // 2️⃣ GOALS (già aggregati lato DB; condizione TL/Admin identica)
  const teamGoals: GoalsRow[] = []
  for(const y of yrs){
    const months = rng.filter(r=>r.y===y).map(r=>r.m)
    const { data, error } = await supabase
      .from('v_team_goals_monthly_sum')
      .select('year,month,consulenze,contratti,danni_non_auto,vita_protection,vita_ricorrenti,vita_unici')
      .eq('year', y)
      .in('month', months)
    if (error) throw error
    for (const r of (data||[])) {
      teamGoals.push({
        advisor_user_id: 'TEAM',
        year: r.year,
        month: r.month,
        consulenze: r.consulenze || 0,
        contratti: r.contratti || 0,
        prod_danni: r.danni_non_auto || 0,
        prod_vprot: r.vita_protection || 0,
        prod_vpr: r.vita_ricorrenti || 0,
        prod_vpu: r.vita_unici || 0,
      })
    }
  }
  setGoals(teamGoals)

  // 3️⃣ PROGRESS TEAM (somma lato FE sugli advisor del team)
  const teamProgMap = new Map<string, ProgressRow>()
  const k = (y:number,m:number)=>`${y}-${m}`
  for(const y of yrs){
    const months = rng.filter(r=>r.y===y).map(r=>r.m)
    const { data, error } = await supabase
      .from('v_progress_monthly')
      .select('advisor_user_id,year,month,consulenze,contratti,prod_danni,prod_vprot,prod_vpr,prod_vpu')
      .eq('year', y)
      .in('month', months)
      .in('advisor_user_id', ids)
    if (error) throw error
    for(const row of (data||[])){
      const key = k(row.year, row.month)
      const acc = teamProgMap.get(key) || {
        advisor_user_id: 'TEAM',
        year: row.year,
        month: row.month,
        consulenze: 0, contratti: 0, prod_danni: 0, prod_vprot: 0, prod_vpr: 0, prod_vpu: 0
      }
      acc.consulenze += row.consulenze || 0
      acc.contratti  += row.contratti  || 0
      acc.prod_danni += row.prod_danni || 0
      acc.prod_vprot += row.prod_vprot || 0
      acc.prod_vpr   += row.prod_vpr   || 0
      acc.prod_vpu   += row.prod_vpu   || 0
      teamProgMap.set(key, acc)
    }
  }
  setProg(Array.from(teamProgMap.values()))
  setLoading(false)
  return
}
