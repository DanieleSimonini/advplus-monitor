import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

let projectRef = 'advplus'
try { projectRef = new URL(supabaseUrl).host.split('.')[0] || 'advplus' } catch {}
const storageKey = `advplus-auth-${projectRef}`

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: localStorage,
    storageKey,
  },
})

// Hardening per tab in background: sospendi/riattiva l'auto refresh in base alla visibilità
if (typeof window !== 'undefined') {
  const handleVis = () => {
    try {
      if (document.visibilityState === 'visible') {
        (supabase as any).auth?.startAutoRefresh?.()
      } else {
        (supabase as any).auth?.stopAutoRefresh?.()
      }
    } catch {}
  }
  document.addEventListener('visibilitychange', handleVis)
  handleVis()

  // Sync storage su refresh/signed_out per evitare stato “zombie” al ritorno in foreground
  supabase.auth.onAuthStateChange((event, session) => {
    try {
      if (event === 'SIGNED_OUT') {
        localStorage.removeItem(storageKey)
      } else if (event === 'TOKEN_REFRESHED' && session) {
        localStorage.setItem(storageKey, JSON.stringify(session))
      }
    } catch {}
  })
}
