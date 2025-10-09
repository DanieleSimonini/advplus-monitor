// src/components/Protected.tsx
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export function Protected({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading'|'in'|'out'>('loading')

  useEffect(() => {
    let sub: any
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState(session ? 'in' : 'out')
    })
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      setState(session ? 'in' : 'out')
    })
    sub = data?.subscription
    return () => sub?.unsubscribe?.()
  }, [])

  if (state === 'loading') return null
  if (state === 'out') { window.location.replace('/login'); return null }
  return <>{children}</>
}
