import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''

function applyCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type')
  res.setHeader('Access-Control-Max-Age', '86400')
}

function extractAuthHeader(headers: VercelRequest['headers']): string | undefined {
  const raw = headers.authorization ?? (headers as any).Authorization
  if (!raw) return undefined
  return Array.isArray(raw) ? raw.find(Boolean) : raw
}

function getBearerToken(authHeader: string): string | undefined {
  const match = authHeader.match(/^\s*bearer\s+(.+)$/i)
  return match?.[1]?.trim()
}

function parseBody(req: VercelRequest): { password?: string } {
  const body = req.body
  if (!body) return {}
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch (error) {
      console.error('JSON parse error:', error)
      throw new Error('Invalid JSON body')
    }
  }
  if (typeof body === 'object') {
    return body as { password?: string }
  }
  throw new Error('Unsupported body format')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res)

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  try {
    // 1. Verifica variabili d'ambiente
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing env vars:', {
        hasUrl: !!SUPABASE_URL,
        hasAnonKey: !!SUPABASE_ANON_KEY,
        hasServiceKey: !!SUPABASE_SERVICE_ROLE_KEY,
      })
      return res.status(500).json({ error: 'Server configuration error' })
    }

    // 2. Verifica metodo
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' })
    }

    // 3. Estrai e valida il token
    const authHeader = extractAuthHeader(req.headers)
    if (!authHeader) {
      console.error('No auth header found')
      return res.status(401).json({ error: 'Authorization header required' })
    }

    if (!/^bearer\s+/i.test(authHeader)) {
      console.error('Invalid auth header format')
      return res.status(401).json({ error: 'Bearer token required' })
    }

    const accessToken = getBearerToken(authHeader)
    if (!accessToken) {
      console.error('Could not extract bearer token')
      return res.status(401).json({ error: 'Invalid bearer token format' })
    }

    console.log('Token received, length:', accessToken.length)

    // 4. Parse e valida la password
    let password: string
    try {
      const body = parseBody(req)
      password = body.password || ''
    } catch (error) {
      console.error('Body parse error:', error)
      return res.status(400).json({ error: 'Invalid request body' })
    }

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password is required' })
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }

    console.log('Password validated, length:', password.length)

    // 5. Verifica l'utente con il token
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { 
        persistSession: false, 
        autoRefreshToken: false 
      },
    })

    console.log('Verifying user with token...')
    const { data: userData, error: userError } = await userClient.auth.getUser(accessToken)

    if (userError) {
      console.error('User verification error:', userError)
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        details: userError.message 
      })
    }

    if (!userData?.user?.id) {
      console.error('No user data returned')
      return res.status(401).json({ error: 'Invalid session' })
    }

    console.log('User verified:', userData.user.id)
    const needsEmailConfirm = !userData.user.email_confirmed_at

    // 6. Aggiorna la password usando admin client
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { 
        persistSession: false, 
        autoRefreshToken: false 
      },
    })

    console.log('Updating password for user:', userData.user.id)
    
    const updatePayload: any = { password }
    if (needsEmailConfirm) {
      updatePayload.email_confirm = true
      console.log('Will also confirm email')
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(
      userData.user.id,
      updatePayload
    )

    if (updateErr) {
      console.error('Password update error:', updateErr)
      const status = (updateErr as any).status || 400
      return res.status(status).json({ 
        error: 'Failed to update password',
        details: updateErr.message 
      })
    }

    console.log('Password updated successfully')

    // 7. Successo
    return res.status(200).json({ 
      ok: true,
      message: 'Password set successfully'
    })

  } catch (error: any) {
    console.error('Unexpected error:', error)
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error?.message || String(error)
    })
  }
}
