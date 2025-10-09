// api/set_password.ts — Edge runtime (niente @vercel/node)
export const config = { runtime: 'edge' }

import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env as {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

function json(code: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status: code,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  })
}

function getAuthHeader(req: Request): string | undefined {
  const h = req.headers.get('authorization') ?? req.headers.get('Authorization')
  return h || undefined
}

export default async function handler(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-allow-methods': 'POST, OPTIONS',
      },
    })
  }

  if (req.method !== 'POST') return json(405, { error: 'Method Not Allowed' })

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'Missing Supabase env on server' })
  }

  const authHeader = getAuthHeader(req)
  if (!authHeader || !/^bearer\s+/i.test(authHeader)) {
    return json(401, { error: 'Missing bearer token' })
  }

  let body: any = {}
  try { body = await req.json() } catch {}
  const password: unknown = body?.password
  if (typeof password !== 'string' || password.length < 8) {
    return json(400, { error: 'Password too short (min 8)' })
  }

  try {
    // 1) Verifica token utente → id
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) return json(401, { error: 'Invalid or expired token' })

    const userId = userData.user.id

    // 2) Aggiorna password come admin (service role)
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password })
    if (updErr) return json(400, { error: updErr.message })

    return json(200, { ok: true })
  } catch (e: any) {
    return json(500, { error: e?.message ?? 'Unexpected error' })
  }
}
