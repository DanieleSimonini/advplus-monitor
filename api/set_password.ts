import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''

function applyCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type')
  res.setHeader('Access-Control-Max-Age', '86400')
}

function extractAuthHeader(headers: VercelRequest['headers']): string | undefined {
  const raw = headers.authorization ?? headers.Authorization
  if (!raw) return undefined
  return Array.isArray(raw) ? raw.find(Boolean) : raw
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

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  try {
    // Validate environment variables
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing Supabase environment variables')
      return res.status(500).json({ error: 'Server configuration error' })
    }

    // Only allow POST
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' })
    }

    // Extract and validate Authorization header
    const authHeader = extractAuthHeader(req.headers)
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      console.error('Missing or invalid authorization header')
      return res.status(401).json({ error: 'Missing or invalid authorization token' })
    }

    // Parse and validate password
    const { password } = parseBody(req)
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password is required' })
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }

    console.log('Verifying user token...')

    // Create client with user's authorization header
    // This is the CORRECT way to verify the user's JWT
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { 
        headers: { 
          Authorization: authHeader 
        } 
      },
      auth: { 
        persistSession: false,
        autoRefreshToken: false 
      },
    })

    // Get user from the token (no need to pass the token again)
    const { data: userData, error: userError } = await userClient.auth.getUser()
    
    if (userError) {
      console.error('User verification error:', userError)
      return res.status(401).json({ error: userError.message || 'Invalid or expired token' })
    }

    if (!userData?.user?.id) {
      console.error('No user ID found')
      return res.status(401).json({ error: 'Invalid session' })
    }

    const userId = userData.user.id
    const needsEmailConfirm = !userData.user.email_confirmed_at

    console.log(`Updating password for user: ${userId}`)

    // Create admin client
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { 
        persistSession: false,
        autoRefreshToken: false 
      },
    })

    // Update password and confirm email if needed
    const updatePayload: any = { password }
    if (needsEmailConfirm) {
      updatePayload.email_confirm = true
    }

    const { error: updateErr } = await adminClient.auth.admin.updateUserById(
      userId,
      updatePayload
    )

    if (updateErr) {
      console.error('Password update error:', updateErr)
      const status = (updateErr as any).status || 400
      return res.status(status).json({ 
        error: updateErr.message || 'Failed to update password' 
      })
    }

    console.log('Password updated successfully')
    return res.status(200).json({ 
      ok: true,
      message: 'Password set successfully' 
    })

  } catch (e: any) {
    console.error('Unexpected error:', e)
    return res.status(500).json({ 
      error: e?.message || 'Internal server error' 
    })
  }
}
