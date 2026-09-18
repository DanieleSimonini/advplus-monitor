import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { errorMessage } from '../../lib/format'

/**
 * CRUD su una tabella figlia di `leads` (activities, appointments, reminders,
 * proposals, contracts). Gestisce caricamento, errori e ricarica in un punto
 * solo, così le schede della scheda lead non ripetono la stessa impalcatura.
 */
/**
 * Colonne che potrebbero non esistere ancora a database.
 *
 * `appointments.outcome` e `proposals.outcome` arrivano con una migrazione
 * (docs/migrazioni.sql). Finché non è stata applicata, Postgres risponde 42703
 * e PostgREST PGRST204: in quel caso si riprova senza quelle colonne, così
 * l'interfaccia nuova non rompe il database vecchio.
 */
function isUnknownColumn(e: unknown): boolean {
  const code = (e as { code?: string })?.code
  return code === '42703' || code === 'PGRST204'
}

function withoutColumns(payload: Record<string, unknown>, columns: string[]) {
  const out = { ...payload }
  for (const c of columns) delete out[c]
  return out
}

export function useChildTable<T extends { id: string }>(
  table: 'activities' | 'appointments' | 'reminders' | 'proposals' | 'contracts',
  select: string,
  leadId: string | null,
  optionalColumns: string[] = [],
) {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState<string[]>([])

  const optionalKey = optionalColumns.join(',')

  const reload = useCallback(async () => {
    if (!leadId) {
      setRows([])
      return
    }
    setLoading(true)
    setError(null)
    const run = (cols: string) =>
      supabase.from(table).select(cols).eq('lead_id', leadId).order('ts', { ascending: false }).limit(200)
    try {
      let { data, error } = await run(select)
      if (error && isUnknownColumn(error) && optionalColumns.length) {
        const reduced = select
          .split(',')
          .filter(c => !optionalColumns.includes(c.trim()))
          .join(',')
        setMissing(optionalColumns)
        ;({ data, error } = await run(reduced))
      }
      if (error) throw error
      setRows((data || []) as unknown as T[])
    } catch (e) {
      setError(errorMessage(e, `Impossibile caricare ${table}`))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [table, select, leadId, optionalKey])

  useEffect(() => {
    void reload()
  }, [reload])

  const insert = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!leadId) throw new Error('Nessun lead selezionato')
      const body = { ...payload, lead_id: leadId }
      let { error } = await supabase.from(table).insert(body)
      if (error && isUnknownColumn(error) && optionalColumns.length) {
        setMissing(optionalColumns)
        ;({ error } = await supabase.from(table).insert(withoutColumns(body, optionalColumns)))
      }
      if (error) throw error
      await reload()
    },
    [table, leadId, reload, optionalKey],
  )

  const update = useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      let { error } = await supabase.from(table).update(payload).eq('id', id)
      if (error && isUnknownColumn(error) && optionalColumns.length) {
        setMissing(optionalColumns)
        ;({ error } = await supabase.from(table).update(withoutColumns(payload, optionalColumns)).eq('id', id))
      }
      if (error) throw error
      await reload()
    },
    [table, reload, optionalKey],
  )

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) throw error
      await reload()
    },
    [table, reload],
  )

  return { rows, loading, error, reload, insert, update, remove, missing }
}
