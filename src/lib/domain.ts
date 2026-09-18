import type { IconName } from '../ui/Icon'

/* ========================================================================== */
/* Ruoli                                                                       */
/* ========================================================================== */

export type Role = 'Admin' | 'Team Lead' | 'Junior'

export const ROLES: Role[] = ['Admin', 'Team Lead', 'Junior']

export type Advisor = {
  id: string
  user_id: string | null
  email: string
  full_name: string | null
  role: Role
  team_lead_user_id: string | null
  is_active?: boolean | null
  disabled?: boolean | null
}

export const ADVISOR_FIELDS = 'id,user_id,email,full_name,role,team_lead_user_id,is_active,disabled'

/** Un utente disattivato non deve comparire nei selettori né nei conteggi. */
export function isActiveAdvisor(a: Pick<Advisor, 'is_active' | 'disabled'>) {
  return (a.is_active ?? true) === true && (a.disabled ?? false) === false
}

export function roleTone(role: Role): 'primary' | 'accent' | 'neutral' {
  if (role === 'Admin') return 'primary'
  if (role === 'Team Lead') return 'accent'
  return 'neutral'
}

/* ========================================================================== */
/* Lead                                                                        */
/* ========================================================================== */

export type LeadSource = 'Provided' | 'Self'

export const SOURCE_LABEL: Record<LeadSource, string> = {
  Provided: 'Fornito',
  Self: 'Autonomo',
}

export type Lead = {
  id: string
  owner_id: string | null
  is_agency_client: boolean | null
  first_name: string | null
  last_name: string | null
  company_name: string | null
  email: string | null
  phone: string | null
  city: string | null
  address: string | null
  source: LeadSource | null
  created_at: string | null
  is_working: boolean | null
}

export const LEAD_FIELDS =
  'id,owner_id,is_agency_client,first_name,last_name,company_name,email,phone,city,address,source,created_at,is_working'

export function leadName(l: Partial<Lead> | null | undefined): string {
  if (!l) return 'Lead'
  const person = [l.last_name, l.first_name].filter(Boolean).join(' ').trim()
  return person || l.company_name || l.email || l.phone || 'Lead senza nome'
}

/* ========================================================================== */
/* Enum di dominio                                                             */
/* ========================================================================== */

/**
 * ATTENZIONE — questi valori devono restare allineati ai vincoli CHECK del
 * database. La versione precedente dell'interfaccia mostrava anche "WhatsApp",
 * "SMS" e "Altro", ma li salvava tutti e tre come 'phone': una volta scritti
 * non erano più distinguibili, quindi qualsiasi analisi per canale era falsa.
 * Meglio offrire meno opzioni vere che opzioni finte. Per tracciare davvero
 * WhatsApp/SMS serve prima estendere il vincolo lato database.
 */
export const CHANNELS = [
  { value: 'phone', label: 'Telefono', icon: 'phone' as IconName },
  { value: 'email', label: 'Email', icon: 'mail' as IconName },
  { value: 'inperson', label: 'Di persona', icon: 'user' as IconName },
  { value: 'video', label: 'Video', icon: 'video' as IconName },
] as const
export type Channel = (typeof CHANNELS)[number]['value']

export const OUTCOMES = [
  { value: 'spoke', label: 'Parlato', tone: 'success' as const },
  { value: 'noanswer', label: 'Nessuna risposta', tone: 'warning' as const },
  { value: 'refused', label: 'Rifiutato', tone: 'danger' as const },
] as const
export type Outcome = (typeof OUTCOMES)[number]['value']

export const MODES = [
  { value: 'inperson', label: 'In presenza', icon: 'mapPin' as IconName },
  { value: 'video', label: 'Video', icon: 'video' as IconName },
  { value: 'phone', label: 'Telefono', icon: 'phone' as IconName },
] as const
export type Mode = (typeof MODES)[number]['value']

export const CONTRACT_TYPES = [
  'Danni Non Auto',
  'Vita Protection',
  'Vita Premi Ricorrenti',
  'Vita Premi Unici',
] as const
export type ContractType = (typeof CONTRACT_TYPES)[number]

export function labelOf<T extends { value: string; label: string }>(
  list: readonly T[],
  value: string | null | undefined,
  fallback = '—',
) {
  if (!value) return fallback
  return list.find(x => x.value === value)?.label || value
}

export function iconOf<T extends { value: string; icon?: IconName }>(
  list: readonly T[],
  value: string | null | undefined,
  fallback: IconName,
): IconName {
  return list.find(x => x.value === value)?.icon || fallback
}

/* ========================================================================== */
/* Metriche di produzione                                                      */
/* ========================================================================== */

export type MetricKey = 'consulenze' | 'contratti' | 'prod_danni' | 'prod_vprot' | 'prod_vpr' | 'prod_vpu'

export type MetricDef = {
  key: MetricKey
  /** Etichetta mostrata all'utente. */
  label: string
  /** Colonna del target in goals / goals_monthly. */
  targetColumn: string
  /** Tipo di contratto sommato per calcolare il valore reale (solo produzione). */
  contractType?: ContractType
  format: 'int' | 'currency'
  icon: IconName
}

/**
 * `consulenze` è il nome storico della colonna: l'azienda conta gli
 * appuntamenti. L'etichetta dice "Appuntamenti", la colonna resta `consulenze`
 * per non rompere i dati già inseriti.
 */
export const METRICS: MetricDef[] = [
  { key: 'consulenze', label: 'Appuntamenti', targetColumn: 'target_consulenze', format: 'int', icon: 'calendar' },
  { key: 'contratti', label: 'Contratti', targetColumn: 'target_contratti', format: 'int', icon: 'fileText' },
  { key: 'prod_danni', label: 'Danni Non Auto', targetColumn: 'target_prod_danni', contractType: 'Danni Non Auto', format: 'currency', icon: 'shield' },
  { key: 'prod_vprot', label: 'Vita Protection', targetColumn: 'target_prod_vprot', contractType: 'Vita Protection', format: 'currency', icon: 'shield' },
  { key: 'prod_vpr', label: 'Vita Premi Ricorrenti', targetColumn: 'target_prod_vpr', contractType: 'Vita Premi Ricorrenti', format: 'currency', icon: 'refresh' },
  { key: 'prod_vpu', label: 'Vita Premi Unici', targetColumn: 'target_prod_vpu', contractType: 'Vita Premi Unici', format: 'currency', icon: 'target' },
]

export const GOAL_SELECT = `advisor_user_id,year,${METRICS.map(m => m.targetColumn).join(',')}`
export const GOAL_MONTHLY_SELECT = `advisor_user_id,year,month,${METRICS.map(m => m.targetColumn).join(',')}`

export type MetricValues = Record<MetricKey, number>

export function emptyMetrics(): MetricValues {
  return { consulenze: 0, contratti: 0, prod_danni: 0, prod_vprot: 0, prod_vpr: 0, prod_vpu: 0 }
}

export function sumMetrics(a: MetricValues, b: MetricValues): MetricValues {
  const out = emptyMetrics()
  for (const m of METRICS) out[m.key] = (a[m.key] || 0) + (b[m.key] || 0)
  return out
}

/* ========================================================================== */
/* Funnel                                                                      */
/* ========================================================================== */

export type FunnelStage = { key: string; label: string; help: string }

export const FUNNEL_STAGES: FunnelStage[] = [
  { key: 'leads', label: 'Lead', help: 'Anagrafiche caricate nel periodo' },
  { key: 'contacts', label: 'Contatti', help: 'Tentativi di contatto registrati' },
  { key: 'appointments', label: 'Appuntamenti', help: 'Incontri fissati' },
  { key: 'proposals', label: 'Proposte', help: 'Preventivi presentati' },
  { key: 'contracts', label: 'Contratti', help: 'Polizze firmate' },
]
