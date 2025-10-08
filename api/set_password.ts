// api/set_password.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS base
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).send('ok')

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase env on server' })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })

    const auth = req.headers.authorization || req.headers.Authorization as string | undefined
    if (!auth || !auth.toString().toLowerCase().startsWith('bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' })
    }
    const { password } = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {}
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password too short' })
    }

    // 1) Verifica il JWT dell’utente e prendi il suo id
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth as string } },
      auth: { persistSession: false },
    })
    const { data: u, error: uerr } = await userClient.auth.getUser()
    if (uerr || !u?.user?.id) return res.status(401).json({ error: uerr?.message || 'Invalid session' })
    const userId = u.user.id

    // 2) Aggiorna la password con il token dell'utente invitato (mantiene il flusso recovery/invite)
    const { error: setPwdErr } = await userClient.auth.updateUser({ password })
    if (setPwdErr) return res.status(400).json({ error: setPwdErr.message })

    // 3) Conferma l'email se è ancora "pending" (richiede service role)    
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    const { data: adminUser, error: fetchErr } = await admin.auth.admin.getUserById(userId)
    if (fetchErr) return res.status(500).json({ error: fetchErr.message })

    if (!adminUser?.user?.email_confirmed_at) {
      const { error: confirmErr } = await admin.auth.admin.updateUserById(userId, {
        email_confirm: true, // gli utenti invitati restano "pending" senza questa conferma
      })
      if (confirmErr) return res.status(500).json({ error: confirmErr.message })
    }

    return res.status(200).json({ ok: true })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) })
  }
}
