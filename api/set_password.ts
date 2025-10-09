// api/set_password.ts (Node runtime su Vercel)
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env

function json(res: VercelResponse, code: number, data: unknown) {
  res.status(code).setHeader('content-type', 'application/json')
  res.send(JSON.stringify(data))
}

// Estrae l'Authorization in modo robusto (Bearer ...)
function extractAuthHeader(req: VercelRequest): string | undefined {
  const h = (req.headers['authorization'] || (req.headers as any)['Authorization']) as string | undefined
  if (!h) return undefined
  return h
}

function parseBody(req: VercelRequest): any {
  if (!req.body) return {}
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body) } catch { return {} }
  }
  return req.body
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight (se chiami da browser)
  if (req.method === 'OPTIONS') {
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', 'content-type, authorization')
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
    return res.status(204).end()
  }

  // Solo POST
  if (req.method !== 'POST') return json(res, 405, { error: 'Method Not Allowed' })

  // Env check
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(res, 500, { error: 'Missing Supabase env on server' })
  }

  // Authorization: Bearer <access_token_utente>
  const authHeader = extractAuthHeader(req)
  if (!authHeader || !/^bearer\s+/i.test(authHeader)) {
    return json(res, 401, { error: 'Missing bearer token' })
  }

  // Body { "password": "NuovaPassword" }
  const body = parseBody(req)
  const password: unknown = body?.password
  if (typeof password !== 'string' || password.length < 8) {
    return json(res, 400, { error: 'Password too short (min 8)' })
  }

  try {
    // 1) Verifica il token utente e recupera il suo id (client con anon + header Authorization)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false }
    })

    const { data: getUserData, error: getUserErr } = await userClient.auth.getUser()
    if (getUserErr || !getUserData?.user) {
      return json(res, 401, { error: 'Invalid or expired token' })
    }

    const userId = getUserData.user.id

    // 2) Aggiorna password con il client admin (service role)
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })

    const { data: upd, error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password
    })

    if (updErr) return json(res, 400, { error: updErr.message })

    return json(res, 200, { ok: true })
  } catch (e: any) {
    return json(res, 500, { error: e?.message ?? 'Unexpected error' })
  }
}
