1.	import React, { useEffect, useMemo, useState } from 'react'
2.	import { supabase } from '@/supabaseClient'
3.	
4.	/**
5.	 * Report.tsx — Andamento vs Obiettivi (mensile, per Advisor)
6.	 * - Filtri: Advisor (se Admin/TL), periodo Dal mese / Al mese (default: ultimi 6 mesi)
7.	 * - Grafici: bar chart SVG semplice per ciascun indicatore vs target
8.	 * - Indicatori: consulenze, contratti, prod_danni, prod_vprot, prod_vpr, prod_vpu
9.	 * - Regole visibilità:
10.	 *   • Junior: vede solo i propri dati (advisor selezionato = me, disabilitato)
11.	 *   • Team Lead/Admin: possono scegliere l'advisor dal menu
12.	 *   • Filtro “Tutto il Team”: TL → il proprio team; Admin → il team del TL selezionato
13.	 */
14.	
15.	type Role = 'Admin' | 'Team Lead' | 'Junior'
16.	
17.	type Me = { id: string; user_id: string; email: string; full_name: string | null; role: Role }
18.	
19.	type GoalsRow = {
20.	  advisor_user_id: string
21.	  year: number
22.	  month: number
23.	  consulenze: number
24.	  contratti: number
25.	  prod_danni: number
26.	  prod_vprot: number
27.	  prod_vpr: number
28.	  prod_vpu: number
29.	}
30.	
31.	type ProgressRow = GoalsRow & { }
32.	
33.	const box: React.CSSProperties = { background: 'var(--card, #fff)', border: '1px solid var(--border, #eee)', borderRadius: 16, padding: 16 }
34.	const ipt: React.CSSProperties = { padding: '6px 10px', border: '1px solid var(--border, #ddd)', borderRadius: 8, background:'#fff', color:'var(--text, #111)' }
35.	
36.	export default function ReportPage(){
37.	  const [me, setMe] = useState<Me | null>(null)
38.	  const [advisors, setAdvisors] = useState<{ user_id: string, email: string, full_name: string | null }[]>([])
39.	
40.	  // Filtri
41.	  const today = new Date()
42.	  const defTo = toMonthKey(today)
43.	  const defFrom = toMonthKey(addMonths(today, -5))
44.	  const [fromKey, setFromKey] = useState<string>(defFrom)
45.	  const [toKey, setToKey] = useState<string>(defTo)
46.	  const [advisorUid, setAdvisorUid] = useState<string>('')
47.	
48.	  // Nuovo filtro: Tutto il Team (per TL e Admin)
49.	  const [myTeam, setMyTeam] = useState<boolean>(false)
50.	
51.	  // Dati
52.	  const [goals, setGoals] = useState<GoalsRow[]>([])
53.	  const [prog, setProg] = useState<ProgressRow[]>([])
54.	  const [loading, setLoading] = useState(true)
55.	  const [err, setErr] = useState('')
56.	
57.	  // Bootstrap: me + advisors (per dropdown)
58.	  useEffect(()=>{ (async()=>{
59.	    setLoading(true); setErr('')
60.	    try{
61.	      const { data: auth } = await supabase.auth.getUser()
62.	      const uid = auth.user?.id
63.	      if (!uid){ setErr('Utente non autenticato'); setLoading(false); return }
64.	
65.	      // me
66.	      const { data: meRow, error: meErr } = await supabase
67.	        .from('advisors')
68.	        .select('id,user_id,email,full_name,role')
69.	        .eq('user_id', uid)
70.	        .maybeSingle()
71.	      if (meErr) throw meErr
72.	      if (!meRow){ setErr('Profilo non trovato'); setLoading(false); return }
73.	      setMe({ id: meRow.id, user_id: meRow.user_id, email: meRow.email, full_name: meRow.full_name, role: meRow.role as Role })
74.	
75.	      // lista advisors (solo per Admin/TL)
76.	      if (meRow.role === 'Admin' || meRow.role === 'Team Lead'){
77.	        const { data: list, error: lerr } = await supabase
78.	          .from('advisors')
79.	          .select('user_id,email,full_name')
80.	          .order('full_name', { ascending: true })
81.	        if (lerr) throw lerr
82.	        setAdvisors((list||[]).filter(x=>!!x.user_id) as any)
83.	        setAdvisorUid(uid)
84.	      } else {
85.	        // Junior → advisor = me, dropdown disabilitato
86.	        setAdvisors([])
87.	        setAdvisorUid(uid)
88.	      }
89.	    } catch(ex:any){ setErr(ex.message || 'Errore bootstrap') }
90.	    finally{ setLoading(false) }
91.	  })() },[])
92.	
93.	  // Carica dati quando cambiano filtri
94.	  useEffect(()=>{ (async()=>{
95.	    if (!advisorUid || !me) return
96.	    setLoading(true); setErr('')
97.	    try{
98.	      const rng = monthRange(fromKey, toKey) // array di {y,m}
99.	      const yrs = Array.from(new Set(rng.map(r=>r.y)))
100.	
101.	      // === BRANCH: Tutto il Team (TL o Admin) ===
102.	      if (myTeam && (me.role === 'Team Lead' || me.role === 'Admin')) {
103.	        // TL: il proprio team; Admin: il team del TL selezionato nel menu Advisor
104.	        const teamLeadId = me.role === 'Admin' ? advisorUid : me.user_id
105.	
106.	        // 1) recupera tutti gli user_id del team (TL + junior)
107.	        const { data: teamList, error: teamErr } = await supabase
108.	          .from('advisors')
109.	          .select('user_id,team_lead_user_id')
110.	          .or(`user_id.eq.${teamLeadId},team_lead_user_id.eq.${teamLeadId}`)
111.	        if (teamErr) throw teamErr
112.	        const ids = (teamList||[]).map(r=>r.user_id)
113.	
114.	        // 2) GOALS TEAM
115.	        const teamGoals: GoalsRow[] = []
116.	
117.	        if (me.role === 'Admin') {
118.	          // Admin: somma GOALS lato FE per il team del TL selezionato
119.	          const goalsMap = new Map<string, GoalsRow>() // key y-m
120.	          const k = (y:number,m:number)=>`${y}-${m}`
121.	
122.	          for (const y of yrs) {
123.	            const months = rng.filter(r=>r.y===y).map(r=>r.m)
124.	            const { data, error } = await supabase
125.	              .from('v_goals_monthly')
126.	              .select('advisor_user_id,year,month,consulenze,contratti,prod_danni,prod_vprot,prod_vpr,prod_vpu')
127.	              .eq('year', y)
128.	              .in('month', months)
129.	              .in('advisor_user_id', ids) // TL + junior del TL selezionato
130.	            if (error) throw error
131.	
132.	            for (const row of (data || [])) {
133.	              const key = k(row.year, row.month)
134.	              const acc = goalsMap.get(key) || {
135.	                advisor_user_id: 'TEAM',
136.	                year: row.year,
137.	                month: row.month,
138.	                consulenze: 0, contratti: 0, prod_danni: 0, prod_vprot: 0, prod_vpr: 0, prod_vpu: 0
139.	              }
140.	              acc.consulenze += row.consulenze || 0
141.	              acc.contratti  += row.contratti  || 0
142.	              acc.prod_danni += row.prod_danni || 0
143.	              acc.prod_vprot += row.prod_vprot || 0
144.	              acc.prod_vpr   += row.prod_vpr   || 0
145.	              acc.prod_vpu   += row.prod_vpu   || 0
146.	              goalsMap.set(key, acc)
147.	            }
148.	          }
149.	          teamGoals.push(...Array.from(goalsMap.values()))
150.	        } else {
151.	          // Team Lead: usa la vista aggregata già pronta
152.	          for(const y of yrs){
153.	            const months = rng.filter(r=>r.y===y).map(r=>r.m)
154.	            const { data, error } = await supabase
155.	              .from('v_team_goals_monthly_sum')
156.	              .select('year,month,consulenze,contratti,danni_non_auto,vita_protection,vita_ricorrenti,vita_unici')
157.	              .eq('year', y)
158.	              .in('month', months)
159.	            if (error) throw error
160.	            for (const r of (data||[])) {
161.	              teamGoals.push({
162.	                advisor_user_id: 'TEAM',
163.	                year: r.year,
164.	                month: r.month,
165.	                consulenze: r.consulenze || 0,
166.	                contratti: r.contratti || 0,
167.	                prod_danni: r.danni_non_auto || 0,
168.	                prod_vprot: r.vita_protection || 0,
169.	                prod_vpr: r.vita_ricorrenti || 0,
170.	                prod_vpu: r.vita_unici || 0,
171.	              })
172.	            }
173.	          }
174.	        }
175.	
176.	        setGoals(teamGoals)
177.	
178.	        // 3) PROGRESS TEAM (somma lato FE sugli advisor del team)
179.	        const teamProgMap = new Map<string, ProgressRow>()
180.	        const k = (y:number,m:number)=>`${y}-${m}`
181.	        for(const y of yrs){
182.	          const months = rng.filter(r=>r.y===y).map(r=>r.m)
183.	          const { data, error } = await supabase
184.	            .from('v_progress_monthly')
185.	            .select('advisor_user_id,year,month,consulenze,contratti,prod_danni,prod_vprot,prod_vpr,prod_vpu')
186.	            .eq('year', y)
187.	            .in('month', months)
188.	            .in('advisor_user_id', ids)
189.	          if (error) throw error
190.	          for(const row of (data||[])){
191.	            const key = k(row.year, row.month)
192.	            const acc = teamProgMap.get(key) || {
193.	              advisor_user_id: 'TEAM',
194.	              year: row.year,
195.	              month: row.month,
196.	              consulenze: 0, contratti: 0, prod_danni: 0, prod_vprot: 0, prod_vpr: 0, prod_vpu: 0
197.	            }
198.	            acc.consulenze += row.consulenze || 0
199.	            acc.contratti  += row.contratti  || 0
200.	            acc.prod_danni += row.prod_danni || 0
201.	            acc.prod_vprot += row.prod_vprot || 0
202.	            acc.prod_vpr   += row.prod_vpr   || 0
203.	            acc.prod_vpu   += row.prod_vpu   || 0
204.	            teamProgMap.set(key, acc)
205.	          }
206.	        }
207.	        setProg(Array.from(teamProgMap.values()))
208.	        setLoading(false)
209.	        return
210.	      }
211.	
212.	      // === BRANCH: singolo advisor (comportamento attuale) ===
213.	      const goalsRes: GoalsRow[] = []
214.	      for(const y of yrs){
215.	        const months = rng.filter(r=>r.y===y).map(r=>r.m)
216.	        const { data, error } = await supabase
217.	          .from('v_goals_monthly')
218.	          .select('advisor_user_id,year,month,consulenze,contratti,prod_danni,prod_vprot,prod_vpr,prod_vpu')
219.	          .eq('advisor_user_id', advisorUid)
220.	          .eq('year', y)
221.	          .in('month', months)
222.	        if (error) throw error
223.	        goalsRes.push(...(data||[]))
224.	      }
225.	      setGoals(goalsRes)
226.	
227.	      const progRes: ProgressRow[] = []
228.	      for(const y of yrs){
229.	        const months = rng.filter(r=>r.y===y).map(r=>r.m)
230.	        const { data, error } = await supabase
231.	          .from('v_progress_monthly')
232.	          .select('advisor_user_id,year,month,consulenze,contratti,prod_danni,prod_vprot,prod_vpr,prod_vpu')
233.	          .eq('advisor_user_id', advisorUid)
234.	          .eq('year', y)
235.	          .in('month', months)
236.	        if (error) throw error
237.	        progRes.push(...(data||[]))
238.	      }
239.	      setProg(progRes)
240.	    } catch(ex:any){ setErr(ex.message || 'Errore caricamento dati') }
241.	    finally{ setLoading(false) }
242.	  })() },[advisorUid, fromKey, toKey, myTeam, me])
243.	
244.	  const rows = useMemo(()=> mergeByMonth(goals, prog, fromKey, toKey), [goals, prog, fromKey, toKey])
245.	
246.	  return (
247.	    <div style={{ display:'grid', gap:16 }}>
248.	      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
249.	        <div style={{ fontSize:20, fontWeight:800 }}>Report — Andamento vs Obiettivi</div>
250.	        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
251.	          <label style={{ fontSize:12 }}>Dal</label>
252.	          <input type="month" value={fromKey} onChange={e=>setFromKey(e.target.value)} style={ipt} />
253.	          <label style={{ fontSize:12 }}>al</label>
254.	          <input type="month" value={toKey} onChange={e=>setToKey(e.target.value)} style={ipt} />
255.	          {/* Filtro "Tutto il Team" per Team Lead E Admin */}
256.	          {me && (me.role === 'Team Lead' || me.role === 'Admin') && (
257.	            <label style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12 }}>
258.	              <input type="checkbox" checked={myTeam} onChange={e=>setMyTeam(e.target.checked)} />
259.	              Tutto il Team
260.	            </label>
261.	          )}
262.	          {me && (me.role==='Admin' || me.role==='Team Lead') ? (
263.	            <>
264.	              <label style={{ fontSize:12 }}>Advisor</label>
265.	              {/* Admin deve poter selezionare il TL del quale vedere il team; TL può lasciare il proprio */}
266.	              <select value={advisorUid} onChange={e=>setAdvisorUid(e.target.value)} style={ipt}>
267.	                <option value={me.user_id}>— {me.full_name || me.email} (me)</option>
268.	                {advisors.filter(a=>a.user_id!==me.user_id).map(a=> (
269.	                  <option key={a.user_id} value={a.user_id}>{a.full_name || a.email}</option>
270.	                ))}
271.	              </select>
272.	            </>
273.	          ) : (
274.	            <div style={{ fontSize:12, color:'#666' }}>Advisor: solo me</div>
275.	          )}
276.	        </div>
277.	      </div>
278.	
279.	      {err && <div style={{ ...box, color:'#c00' }}>{err}</div>}
280.	
281.	      <div style={{ display:'grid', gap:16 }}>
282.	        <MetricCard title="Appuntamenti" field="consulenze" rows={rows} format="int" />
283.	        <MetricCard title="Contratti" field="contratti" rows={rows} format="int" />
284.	        <MetricCard title="Produzione Danni Non Auto" field="prod_danni" rows={rows} format="currency" />
285.	        <MetricCard title="Vita Protection" field="prod_vprot" rows={rows} format="currency" />
286.	        <MetricCard title="Vita Premi Ricorrenti" field="prod_vpr" rows={rows} format="currency" />
287.	        <MetricCard title="Vita Premi Unici" field="prod_vpu" rows={rows} format="currency" />
288.	      </div>
289.	
290.	      {loading && <div style={{ color:'#666' }}>Caricamento...</div>}
291.	    </div>
292.	  )
293.	}
294.	
295.	// ===== Helpers render =====
296.	
297.	function MetricCard({ title, field, rows, format }:{ title:string, field: keyof GoalsRow, rows: MergedRow[], format:'int'|'currency' }){
298.	  const data = rows
299.	  const totGoal = data.reduce((s,r)=> s + (r.goal[field]||0), 0)
300.	  const totAct  = data.reduce((s,r)=> s + (r.actual[field]||0), 0)
301.	  const pct = totGoal>0 ? (totAct / totGoal) : 0
302.	  return (
303.	    <div style={{ ...box }}>
304.	      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
305.	        <div style={{ fontSize:16, fontWeight:700 }}>{title}</div>
306.	        <div style={{ fontSize:14 }}>
307.	          <b>{fmt(totAct, format)}</b> / {fmt(totGoal, format)}
308.	          <span style={{ marginLeft:8, color: pct>=1? '#0a0':'#a60' }}>{(pct*100).toFixed(0)}%</span>
309.	        </div>
310.	      </div>
311.	      <BarChart rows={data} field={field} format={format} />
312.	    </div>
313.	  )
314.	}
315.	
316.	function BarChart({ rows, field, format }:{ rows:MergedRow[], field:keyof GoalsRow, format:'int'|'currency' }){
317.	  const W = Math.max(600, rows.length*60)
318.	  const H = 160
319.	  const pad = { l:40, r:20, t:10, b:30 }
320.	  const maxVal = Math.max(1, ...rows.map(r => Math.max(r.goal[field]||0, r.actual[field]||0)))
321.	  const step = (W - pad.l - pad.r) / Math.max(1, rows.length)
322.	  const barW = Math.max(14, step*0.35)
323.	
324.	  return (
325.	    <div style={{ overflowX:'auto' }}>
326.	      <svg width={W} height={H}>
327.	        {/* axis */}
328.	        <line x1={pad.l} y1={H-pad.b} x2={W-pad.r} y2={H-pad.b} stroke="#ddd" />
329.	        {/* bars */}
330.	        {rows.map((r, i) => {
331.	          const x = pad.l + i*step + 8
332.	          const gVal = r.goal[field]||0
333.	          const aVal = r.actual[field]||0
334.	          const gH = (gVal/maxVal) * (H - pad.b - pad.t)
335.	          const aH = (aVal/maxVal) * (H - pad.b - pad.t)
336.	          const baseY = H - pad.b
337.	          return (
338.	            <g key={i}>
339.	              {/* goal bar (light) */}
340.	              <rect x={x} y={baseY - gH} width={barW} height={gH} fill="#eaeaea" />
341.	              {/* actual bar (solid) */}
342.	              <rect x={x + barW + 6} y={baseY - aH} width={barW} height={aH} fill="#888" />
343.	              {/* label month */}
344.	              <text x={x + barW} y={H-10} fontSize={11} textAnchor="middle">{r.label}</text>
345.	              {/* values */}
346.	              <text x={x + barW/2} y={baseY - gH - 4} fontSize={10} textAnchor="middle" fill="#777">{fmt(gVal, format)}</text>
347.	              <text x={x + barW + 6 + barW/2} y={baseY - aH - 4} fontSize={10} textAnchor="middle" fill="#333">{fmt(aVal, format)}</text>
348.	            </g>
349.	          )
350.	        })}
351.	      </svg>
352.	    </div>
353.	  )
354.	}
355.	
356.	function fmt(v:number, mode:'int'|'currency'){
357.	  if (mode==='int') return String(Math.round(v||0))
358.	  try{ return new Intl.NumberFormat('it-IT', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(v||0) }catch{ return String(v||0) }
359.	}
360.	
361.	// ===== Merge/Date helpers =====
362.	
363.	type YM = { y:number, m:number }
364.	
365.	type MergedRow = {
366.	  y: number
367.	  m: number
368.	  label: string
369.	  goal: Record<keyof GoalsRow, number>
370.	  actual: Record<keyof GoalsRow, number>
371.	}
372.	
373.	function toMonthKey(d: Date){
374.	  const y = d.getFullYear()
375.	  const m = d.getMonth()+1
376.	  return `${y}-${String(m).padStart(2,'0')}`
377.	}
378.	function addMonths(d: Date, delta: number){
379.	  const dd = new Date(d.getTime())
380.	  dd.setMonth(dd.getMonth()+delta)
381.	  return dd
382.	}
383.	function monthRange(fromKey:string, toKey:string): YM[]{
384.	  const [fy,fm] = fromKey.split('-').map(n=>parseInt(n,10))
385.	  const [ty,tm] = toKey.split('-').map(n=>parseInt(n,10))
386.	  const out: YM[] = []
387.	  let y=fy, m=fm
388.	  while (y<ty || (y===ty && m<=tm)){
389.	    out.push({ y, m })
390.	    m++; if (m>12){ m=1; y++ }
391.	  }
392.	  return out
393.	}
394.	
395.	function mergeByMonth(goals: GoalsRow[], prog: ProgressRow[], fromKey:string, toKey:string): MergedRow[]{
396.	  const rng = monthRange(fromKey, toKey)
397.	  const key = (y:number,m:number)=> `${y}-${m}`
398.	  const gmap = new Map<string, GoalsRow>()
399.	  const amap = new Map<string, ProgressRow>()
400.	  for(const g of goals) gmap.set(key(g.year,g.month), g)
401.	  for(const a of prog)  amap.set(key(a.year,a.month), a)
402.	  const fields: (keyof GoalsRow)[] = ['advisor_user_id','year','month','consulenze','contratti','prod_danni','prod_vprot','prod_vpr','prod_vpu']
403.	  const metricFields: (keyof GoalsRow)[] = ['consulenze','contratti','prod_danni','prod_vprot','prod_vpr','prod_vpu']
404.	  const out: MergedRow[] = []
405.	  for(const {y,m} of rng){
406.	    const g = gmap.get(key(y,m))
407.	    const a = amap.get(key(y,m))
408.	    const row: MergedRow = {
409.	      y, m,
410.	      label: `${String(m).padStart(2,'0')}/${String(y).slice(2)}`,
411.	      goal: Object.fromEntries(fields.map(f=>[f, 0])) as any,
412.	      actual: Object.fromEntries(fields.map(f=>[f, 0])) as any,
413.	    }
414.	    for(const f of metricFields){
415.	      row.goal[f] = (g as any)?.[f] || 0
416.	      row.actual[f] = (a as any)?.[f] || 0
417.	    }
418.	    out.push(row)
419.	  }
420.	  return out
421.	}
