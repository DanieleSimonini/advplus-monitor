// api/set_password.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function applyCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type')
  // opzionale:
  // res.setHeader('Access-Control-Max-Age', '86400')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res)

  if (req.method === 'OPTIONS') return res.status(200).send('ok')

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase env on server' })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })

    // Estrai e normalizza il bearer token
    const rawAuth = (req.headers.authorization || (req.headers as any)?.Authorization) as string | undefined
    if (!rawAuth || !/^bearer\s+/i.test(rawAuth)) {
      return res.status(401).json({ error: 'Missing bearer token' })
    }
    const token = rawAuth.replace(/^bearer\s+/i, '').trim()
    const bearer = `Bearer ${token}`

    // Parse del body con gestione JSON non valido
    let body: any
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }

    const password = body?.password as string | undefined
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password too short' })
    }

    // 1) Verifica il JWT dell’utente e prendi il suo id
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: bearer } },
      auth: { persistSession: false },
    })
    const { data: u, error: uerr } = await userClient.auth.getUser()
    if (uerr || !u?.user?.id) {
      return res.status(401).json({ error: uerr?.message || 'Invalid session' })
    }
    const userId = u.user.id
    const needsEmailConfirm = !u.user.email_confirmed_at

    // 2) Aggiorna la password e conferma l'email (se necessario) con il service role
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
      password,
      ...(needsEmailConfirm ? { email_confirm: true } : {}),
    })
    if (updateErr) {
      const status =
        typeof (updateErr as { status?: number }).status === 'number'
          ? ((updateErr as { status?: number }).status ?? 400)
          : 400
      return res.status(status).json({ error: updateErr.message })
    }

    return res.status(200).json({ ok: true })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) })
  }
}
