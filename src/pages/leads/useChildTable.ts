import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { errorMessage } from '../../lib/format'

/**
 * CRUD su una tabella figlia di `leads` (activities, appointments, reminders,
 * proposals, contracts). Gestisce caricamento, errori e ricarica in un punto
 * solo, così le schede della scheda lead non ripetono la stessa impalcatura.
 */
export function useChildTable<T extends { id: string }>(
  table: 'activities' | 'appointments' | 'reminders' | 'proposals' | 'contracts',
  select: string,
  leadId: string | null,
) {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!leadId) {
      setRows([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .eq('lead_id', leadId)
        .order('ts', { ascending: false })
        .limit(200)
      if (error) throw error
      setRows((data || []) as unknown as T[])
    } catch (e) {
      setError(errorMessage(e, `Impossibile caricare ${table}`))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [table, select, leadId])

  useEffect(() => {
    void reload()
  }, [reload])

  const insert = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!leadId) throw new Error('Nessun lead selezionato')
      const { data, error } = await supabase
        .from(table)
        .insert({ ...payload, lead_id: leadId })
        .select(select)
        .single()
      if (error) throw error
      await reload()
      return data as unknown as T
    },
    [table, select, leadId, reload],
  )

  const update = useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      const { error } = await supabase.from(table).update(payload).eq('id', id)
      if (error) throw error
      await reload()
    },
    [table, reload],
  )

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) throw error
      await reload()
    },
    [table, reload],
  )

  return { rows, loading, error, reload, insert, update, remove }
}
