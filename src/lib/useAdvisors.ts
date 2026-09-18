import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { ADVISOR_FIELDS, isActiveAdvisor, type Advisor } from './domain'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage } from './format'

/**
 * Elenco advisor + regole di visibilità, in un posto solo.
 *
 * Prima ogni pagina ricalcolava "chi posso vedere" con sfumature diverse:
 * Dashboard e Report erano d'accordo solo per metà, il Calendario aveva una
 * terza variante e la pagina Leads mostrava a tutti l'elenco completo. Lo
 * scope adesso è uno e si comporta allo stesso modo ovunque.
 *
 * Nota: la visibilità reale dei dati è comunque decisa dalle policy RLS del
 * database. Qui filtriamo per non proporre selezioni che restituirebbero
 * elenchi vuoti (e per non mostrare la rubrica aziendale a chi non serve).
 */

let cache: { at: number; rows: Advisor[] } | null = null
const TTL_MS = 60_000

export type Scope =
  | { kind: 'me' }
  | { kind: 'team'; teamLeadUserId: string }
  | { kind: 'user'; userId: string }
  | { kind: 'all' }

export type ScopeOption = { value: string; label: string; group?: string }

export function serializeScope(s: Scope): string {
  switch (s.kind) {
    case 'me': return 'me'
    case 'all': return 'all'
    case 'team': return `team:${s.teamLeadUserId}`
    case 'user': return `user:${s.userId}`
  }
}

export function parseScope(v: string): Scope {
  if (v === 'all') return { kind: 'all' }
  if (v.startsWith('team:')) return { kind: 'team', teamLeadUserId: v.slice(5) }
  if (v.startsWith('user:')) return { kind: 'user', userId: v.slice(5) }
  return { kind: 'me' }
}

export function useAdvisors() {
  const { me, isAdmin, isTeamLead } = useAuth()
  const [rows, setRows] = useState<Advisor[]>(() => (cache && Date.now() - cache.at < TTL_MS ? cache.rows : []))
  const [loading, setLoading] = useState(!cache)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (force = false) => {
    // Senza profilo non c'è niente da chiedere: il provider dello scope è
    // montato sopra il controllo di sessione, quindi senza questa guardia la
    // schermata di login sparava comunque una query che il database rifiuta.
    if (!me) {
      setLoading(false)
      return
    }
    if (!force && cache && Date.now() - cache.at < TTL_MS) {
      setRows(cache.rows)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase.from('advisors').select(ADVISOR_FIELDS).order('full_name', { ascending: true })
      if (error) throw error
      const list = (data || []) as Advisor[]
      cache = { at: Date.now(), rows: list }
      setRows(list)
    } catch (e) {
      setError(errorMessage(e, 'Impossibile caricare gli advisor'))
    } finally {
      setLoading(false)
    }
  }, [me])

  useEffect(() => {
    void load()
  }, [load])

  const active = useMemo(() => rows.filter(isActiveAdvisor), [rows])

  /** Advisor visibili nei selettori, in base al ruolo di chi guarda. */
  const visible = useMemo(() => {
    if (!me) return []
    if (isAdmin) return active
    if (isTeamLead) return active.filter(a => a.user_id === me.user_id || a.team_lead_user_id === me.user_id)
    return active.filter(a => a.user_id === me.user_id)
  }, [active, me, isAdmin, isTeamLead])

  const byUserId = useMemo(() => {
    const map = new Map<string, Advisor>()
    for (const a of rows) if (a.user_id) map.set(a.user_id, a)
    return map
  }, [rows])

  /** Risolve uno scope nell'elenco di user_id da interrogare. */
  const resolveScope = useCallback(
    (scope: Scope): string[] => {
      if (!me?.user_id) return []
      switch (scope.kind) {
        case 'me':
          return [me.user_id]
        case 'all':
          return isAdmin ? active.map(a => a.user_id).filter((x): x is string => !!x) : [me.user_id]
        case 'team': {
          const team = active.filter(
            a => a.user_id === scope.teamLeadUserId || a.team_lead_user_id === scope.teamLeadUserId,
          )
          return team.map(a => a.user_id).filter((x): x is string => !!x)
        }
        case 'user':
          return visible.some(a => a.user_id === scope.userId) ? [scope.userId] : [me.user_id]
      }
    },
    [me, active, visible, isAdmin],
  )

  /** Opzioni per la select di scope, già raggruppate. */
  const scopeOptions = useMemo<ScopeOption[]>(() => {
    if (!me?.user_id) return []
    const opts: ScopeOption[] = [{ value: 'me', label: 'Solo me' }]

    if (isAdmin) {
      opts.push({ value: 'all', label: 'Tutta la rete' })
      for (const tl of active.filter(a => a.role === 'Team Lead' && a.user_id)) {
        opts.push({ value: `team:${tl.user_id}`, label: `Team ${tl.full_name || tl.email}`, group: 'Team' })
      }
      for (const j of active.filter(a => a.role === 'Junior' && a.user_id)) {
        opts.push({ value: `user:${j.user_id}`, label: j.full_name || j.email, group: 'Junior' })
      }
    } else if (isTeamLead) {
      opts.push({ value: `team:${me.user_id}`, label: 'Tutto il mio team' })
      for (const j of active.filter(a => a.team_lead_user_id === me.user_id && a.user_id)) {
        opts.push({ value: `user:${j.user_id}`, label: j.full_name || j.email, group: 'Il mio team' })
      }
    }
    return opts
  }, [me, active, isAdmin, isTeamLead])

  const defaultScope = useMemo<Scope>(() => {
    if (isAdmin) return { kind: 'all' }
    if (isTeamLead && me?.user_id) return { kind: 'team', teamLeadUserId: me.user_id }
    return { kind: 'me' }
  }, [isAdmin, isTeamLead, me])

  return { rows, active, visible, byUserId, loading, error, reload: () => load(true), resolveScope, scopeOptions, defaultScope }
}

/** Select di scope pronta all'uso, con i gruppi già impostati. */
export function groupScopeOptions(options: ScopeOption[]) {
  const flat = options.filter(o => !o.group)
  const groups = new Map<string, ScopeOption[]>()
  for (const o of options) {
    if (!o.group) continue
    const arr = groups.get(o.group)
    if (arr) arr.push(o)
    else groups.set(o.group, [o])
  }
  return { flat, groups: Array.from(groups.entries()) }
}
