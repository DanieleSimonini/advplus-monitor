// api/set_password.ts
import { createClient } from '@supabase/supabase-js'

// --- util ---
function decodeJwt(token: string): Record<string, any> | undefined {
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '=')
    const json = Buffer.from(payload, 'base64').toString('utf8')
    return JSON.parse(json)
  } catch {
    return undefined
  }
}
function isTokenExpired(claims?: { exp?: number }): boolean {
  if (!claims?.exp) return false
  const now = Math.floor(Date.now() / 1000)
  return claims.exp < now
}
function applyCors(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type')
  res.setHeader('Access-Control-Max-Age', '86400')
}
function extractAuthHeader(headers: any): string | undefined {
  const raw = headers?.authorization ?? headers?.Authorization
  if (!raw) return undefined
  return Array.isArray(raw) ? raw.find(Boolean) : raw
}
function getBearerToken(authHeader: string): string | undefined {
  const m = authHeader.match(/^\s*bearer\s+(.+)$/i)
  return m?.[1]?.trim()
}
async function readRequestBody(req: any): Promise<string | object | undefined> {
  if (typeof req.body !== 'undefined') return req.body
  return new Promise((resolve, reject) => {
    const acc: Buffer[] = []
    req
      .on('data', (chunk: Buffer) => acc.push(Buffer.from(chunk)))
      .on('end', () => {
        if (!acc.length) return resolve(undefined)
        try {
          resolve(Buffer.concat(acc).toString('utf8'))
        } catch (e) {
          reject(e)
        }
      })
      .on('error', reject)
  })
}
async function parseBody(req: any): Promise<{ password?: string }> {
  const body = await readRequestBody(req)
  if (!body) return {}
  if (typeof body === 'string') {
    const t = body.trim()
    if (!t) return {}
    try {
      return JSON.parse(t)
    } catch {
      const err: any = new Error('Invalid JSON body')
      err.status = 400
      throw err
    }
  }
  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString('utf8'))
    } catch {
      const err: any = new Error('Invalid JSON body')
      err.status = 400
      throw err
    }
  }
  if (typeof body === 'object') return body as any
  const err: any = new Error('Unsupported body format')
  err.status = 400
  throw err
}

// --- env ---
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''

// --- handler ---
export default async function handler(req: any, res: any) {
  applyCors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase env on server' })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })

    const authHeader = extractAuthHeader(req.headers)
    if (!authHeader || !/^bearer\s+/i.test(authHeader)) {
      return res.status(401).json({ error: 'Missing bearer token' })
    }
    const accessToken = getBearerToken(authHeader)
    if (!accessToken) return res.status(401).json({ error: 'Invalid bearer token' })

    const { password } = await parseBody(req)
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password too short' })

    // valida il token lato server
    const claims = decodeJwt(accessToken)
    if (!claims?.sub || typeof claims.sub !== 'string') {
      return res.status(401).json({ error: 'Invalid session token' })
    }
    if (isTokenExpired(claims)) {
      return res.status(401).json({ error: 'Session token expired' })
    }

    // usa service role per aggiornare password e confermare email
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: userInfo, error: userInfoErr } = await admin.auth.admin.getUserById(claims.sub)
    if (userInfoErr || !userInfo?.user?.id) {
      const status = typeof (userInfoErr as any)?.status === 'number' ? (userInfoErr as any).status : 401
      return res.status(status).json({ error: userInfoErr?.message || 'User not found' })
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(userInfo.user.id, {
      password,
      ...(userInfo.user.email_confirmed_at ? {} : { email_confirm: true }),
    })
    if (updateErr) {
      const status = typeof (updateErr as any).status === 'number' ? ((updateErr as any).status ?? 400) : 400
      return res.status(status).json({ error: updateErr.message })
    }

    return res.status(200).json({ ok: true })
  } catch (e: any) {
    const status = typeof e?.status === 'number' ? e.status : 500
    return res.status(status).json({ error: e?.message || String(e) })
  }
}
