import { createClient } from '@supabase/supabase-js'

// Import dati da Vite (su Vercel: Settings → Environment Variables prefissate con VITE_)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// Derivo un projectRef per costruire una storageKey stabile (utile su preview/prod)
let projectRef = 'advplus'
try { projectRef = new URL(supabaseUrl).host.split('.')[0] || 'advplus' } catch {}

const storageKey = `advplus-auth-${projectRef}`

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,          // <-- fondamentale
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: localStorage,         // <-- usa localStorage del browser
    storageKey,                    // <-- chiave stabile (evita sorprese tra preview/prod)
  },
})

// 🔧 Hardening: tieni sincronizzata la sessione nel localStorage e pulisci su sign-out.
// Evita flicker "Caricamento…" quando il tab rimane aperto per ore.
if (typeof window !== 'undefined') {
  try {
    const sub = supabase.auth.onAuthStateChange((event, session) => {
      try {
        if (event === 'SIGNED_OUT') {
          localStorage.removeItem(storageKey)
        } else if (event === 'TOKEN_REFRESHED' && session) {
          // salva il payload session per compatibilità con il bootstrap custom dell'app
          localStorage.setItem(storageKey, JSON.stringify(session))
        }
      } catch { /* ignore quota / private mode errors */ }
    })
    // opzionale: potresti esportare sub.data.subscription per eventuale cleanup globale
  } catch { /* in ambienti non-browser */ }
}
