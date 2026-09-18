import { supabase } from '../supabaseClient'
import { fetchAllPages, inChunks } from './db'
import { progressOf, type Progress, type ProgressInput } from './domain'

/**
 * Conteggi per lead: quanti contatti, quando l'ultimo, quanti appuntamenti e
 * quando il prossimo, proposte, contratti e produzione.
 *
 * Serve sia all'elenco dei lead (per il badge di avanzamento e per i filtri
 * "da quanto non lo sento") sia alla pagina Oggi. Stava dentro Leads.tsx e da
 * lì non era riutilizzabile.
 */

export type Aggregate = ProgressInput & {
  production: number
  lastContact?: string | null
  nextAppointment?: string | null
}

export type Aggregates = Record<string, Aggregate>

export function emptyAggregate(): Aggregate {
  return {
    contacts: 0,
    appointments: 0,
    proposals: 0,
    contracts: 0,
    production: 0,
    lastContact: null,
    nextAppointment: null,
  }
}

export async function loadAggregates(leadIds: string[]): Promise<Aggregates> {
  if (!leadIds.length) return {}
  const nowIso = new Date().toISOString()

  const [acts, apps, props, ctrs] = await Promise.all([
    inChunks(leadIds, s =>
      fetchAllPages<{ lead_id: string; ts: string }>(
        () => supabase.from('activities').select('lead_id,ts').in('lead_id', s) as never,
      ),
    ),
    inChunks(leadIds, s =>
      fetchAllPages<{ lead_id: string; ts: string }>(
        () => supabase.from('appointments').select('lead_id,ts').in('lead_id', s) as never,
      ),
    ),
    inChunks(leadIds, s =>
      fetchAllPages<{ lead_id: string }>(() => supabase.from('proposals').select('lead_id').in('lead_id', s) as never),
    ),
    inChunks(leadIds, s =>
      fetchAllPages<{ lead_id: string; amount: number | null; premium_annual: number | null }>(
        () => supabase.from('contracts').select('lead_id,amount,premium_annual').in('lead_id', s) as never,
      ),
    ),
  ])

  const out: Aggregates = {}
  const ensure = (id: string) => (out[id] ||= emptyAggregate())

  for (const r of acts) {
    const a = ensure(r.lead_id)
    a.contacts++
    if (!a.lastContact || r.ts > a.lastContact) a.lastContact = r.ts
  }
  for (const r of apps) {
    const a = ensure(r.lead_id)
    a.appointments++
    // Il prossimo appuntamento è il primo in futuro, non l'ultimo inserito.
    if (r.ts >= nowIso && (!a.nextAppointment || r.ts < a.nextAppointment)) a.nextAppointment = r.ts
  }
  for (const r of props) ensure(r.lead_id).proposals++
  for (const r of ctrs) {
    const a = ensure(r.lead_id)
    a.contracts++
    // `amount` è nullable e `premium_annual` ha default a zero: a seconda di
    // come è stato inserito il contratto il premio sta nell'una o nell'altra.
    a.production += Number(r.amount ?? r.premium_annual ?? 0)
  }
  return out
}

export function progressOfLead(id: string, aggregates: Aggregates): Progress {
  return progressOf(aggregates[id])
}

/** Giorni trascorsi dall'ultimo contatto. `null` se non è mai stato contattato. */
export function daysSinceContact(a: Aggregate | undefined, now = Date.now()): number | null {
  if (!a?.lastContact) return null
  const t = new Date(a.lastContact).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((now - t) / 86_400_000)
}
