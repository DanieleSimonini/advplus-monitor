import { createClient } from '@supabase/supabase-js'

// Import dati da Vite (su Vercel: Settings → Environment Variables prefissate con VITE_)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// Derivo un projectRef per costruire una storageKey stabile (utile su preview/prod)
let projectRef = 'advplus'
try { projectRef = new URL(supabaseUrl).host.split('.')[0] || 'advplus' } catch {}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,          // <-- fondamentale
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: localStorage,         // <-- usa localStorage del browser
    storageKey: `advplus-auth-${projectRef}`, // <-- chiave stabile (evita sorprese)
  },
})
