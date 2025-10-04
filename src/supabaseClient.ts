import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anon) {
  console.warn('Supabase env vars mancanti. Configura VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY su Vercel.')
}

export const supabase = createClient(url, anon)
