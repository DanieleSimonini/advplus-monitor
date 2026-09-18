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
  // "In presenza" e non "Di persona": è lo stesso valore `inperson` usato da
  // MODES per gli appuntamenti, e due etichette diverse per lo stesso dato
  // fanno sembrare che siano due cose.
  { value: 'inperson', label: 'In presenza', icon: 'user' as IconName },
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

/**
 * Esito dell'appuntamento.
 *
 * Senza questo campo l'imbuto misurava gli appuntamenti FISSATI e li chiamava
 * appuntamenti fatti: il "tasso di chiusura" risultava quindi più basso del
 * vero, perché al denominatore finivano anche i buchi a vuoto.
 *
 * Richiede la colonna `appointments.outcome` (vedi docs/migrazioni.sql).
 * Finché non è stata applicata, il campo viene semplicemente ignorato in
 * scrittura: non blocca nulla.
 */
export const APPOINTMENT_OUTCOMES = [
  { value: 'scheduled', label: 'In programma', tone: 'primary' as const, icon: 'clock' as IconName },
  { value: 'done', label: 'Fatto', tone: 'success' as const, icon: 'checkCircle' as IconName },
  { value: 'noshow', label: 'Non presentato', tone: 'warning' as const, icon: 'alert' as IconName },
  { value: 'canceled', label: 'Annullato', tone: 'neutral' as const, icon: 'xCircle' as IconName },
] as const
export type AppointmentOutcome = (typeof APPOINTMENT_OUTCOMES)[number]['value']

/**
 * Esito della proposta. È il salto dell'imbuto dove si perdono i soldi ed era
 * l'unico di cui non si poteva sapere il perché.
 * Richiede la colonna `proposals.outcome`.
 */
export const PROPOSAL_OUTCOMES = [
  { value: 'pending', label: 'In attesa', tone: 'primary' as const, icon: 'clock' as IconName },
  { value: 'accepted', label: 'Accettata', tone: 'success' as const, icon: 'checkCircle' as IconName },
  { value: 'rejected', label: 'Rifiutata', tone: 'danger' as const, icon: 'xCircle' as IconName },
] as const
export type ProposalOutcome = (typeof PROPOSAL_OUTCOMES)[number]['value']

/* ========================================================================== */
/* Avanzamento del lead                                                        */
/* ========================================================================== */

/**
 * Il vecchio filtro si chiamava "Stadio" ma non era uno stadio: le voci erano
 * presenze cumulative ("ha almeno un appuntamento, in qualunque momento"), così
 * un cliente acquisito compariva anche sotto "Contattati". Un percorso si
 * attraversa, non si accumula: qui ogni lead sta in UNO stato solo, deciso a
 * cascata dal più avanzato al meno avanzato.
 */
export type Progress = 'never' | 'contacted' | 'appointment' | 'proposal' | 'client'

export const PROGRESS_STEPS: { value: Progress; label: string; short: string; tone: BadgeToneName; help: string }[] = [
  { value: 'never', label: 'Mai contattati', short: 'Mai contattato', tone: 'warning', help: 'Nessun contatto registrato' },
  { value: 'contacted', label: 'Contattati, senza appuntamento', short: 'Da riagganciare', tone: 'neutral', help: 'Contattato, ma senza appuntamenti in programma' },
  { value: 'appointment', label: 'Con appuntamento in programma', short: 'In agenda', tone: 'primary', help: 'Ha un appuntamento in una data futura' },
  { value: 'proposal', label: 'Con proposta aperta', short: 'Proposta', tone: 'accent', help: 'Ha ricevuto una proposta, non ancora firmata' },
  { value: 'client', label: 'Cliente acquisito', short: 'Cliente', tone: 'success', help: 'Ha almeno un contratto firmato' },
]

/** Tono del badge, tenuto come stringa per non importare la UI nel dominio. */
type BadgeToneName = 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger'

export const PROGRESS_BY_VALUE = new Map(PROGRESS_STEPS.map(s => [s.value, s]))

/** Conteggi minimi per decidere a che punto è un lead. */
export type ProgressInput = {
  contacts: number
  appointments: number
  nextAppointment?: string | null
  proposals: number
  contracts: number
}

export function progressOf(a: ProgressInput | undefined): Progress {
  if (!a) return 'never'
  if (a.contracts > 0) return 'client'
  if (a.proposals > 0) return 'proposal'
  if (a.nextAppointment) return 'appointment'
  if (a.contacts > 0 || a.appointments > 0) return 'contacted'
  return 'never'
}

/* ========================================================================== */
/* Vocabolario dei filtri                                                      */
/* ========================================================================== */

export const WORKING_OPTIONS = [
  { value: 'attivi', label: 'In lavorazione' },
  // Mancava: si potevano vedere i sospesi solo mescolati agli altri, mai da
  // soli. È proprio la lista che si rivede ogni tanto per recuperare qualcosa.
  { value: 'sospesi', label: 'Solo sospesi' },
  { value: 'tutti', label: 'Tutti' },
] as const
export type WorkingFilter = (typeof WORKING_OPTIONS)[number]['value']

/**
 * "Da quanto non lo sento": il filtro che serve ogni giorno e che non esisteva.
 * Non c'è la voce "Mai" perché sarebbe la stessa cosa di Avanzamento → Mai
 * contattati, e due comandi che fanno la stessa cosa confondono e basta.
 */
export const CONTACT_AGE_OPTIONS = [
  { value: 'sempre', label: 'Indifferente', days: 0 },
  { value: '30', label: 'Da oltre 30 giorni', days: 30 },
  { value: '60', label: 'Da oltre 60 giorni', days: 60 },
  { value: '90', label: 'Da oltre 90 giorni', days: 90 },
] as const
export type ContactAgeFilter = (typeof CONTACT_AGE_OPTIONS)[number]['value']

export const SOURCE_OPTIONS = [
  { value: 'tutte', label: 'Tutte' },
  { value: 'Provided', label: SOURCE_LABEL.Provided },
  { value: 'Self', label: SOURCE_LABEL.Self },
] as const

export const CLIENT_OPTIONS = [
  { value: 'tutti', label: 'Indifferente' },
  { value: 'si', label: 'Già cliente di agenzia' },
  { value: 'no', label: 'Non ancora cliente' },
] as const

/**
 * L'ordinamento non è un filtro e non sta più nella stessa barra.
 * "Da ricontattare" è l'ordine che mancava: il motivo per cui si ordina per
 * ultimo contatto è trovare i trascurati, non i freschi.
 */
export const SORT_OPTIONS = [
  { value: 'cognome', label: 'Cognome (A → Z)', needsAggregates: false },
  { value: 'recenti', label: 'Caricati di recente', needsAggregates: false },
  { value: 'trascurati', label: 'Da ricontattare (più fermi prima)', needsAggregates: true },
  { value: 'contatto', label: 'Contattati di recente', needsAggregates: true },
] as const
export type SortKey = (typeof SORT_OPTIONS)[number]['value']

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
