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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res)

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  console.log('=== SET PASSWORD REQUEST START ===')
  console.log('Method:', req.method)
  console.log('Headers:', JSON.stringify(req.headers, null, 2))

  try {
    // 1. Validate environment variables
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing env vars:', {
        hasUrl: !!SUPABASE_URL,
        hasAnonKey: !!SUPABASE_ANON_KEY,
        hasServiceKey: !!SUPABASE_SERVICE_ROLE_KEY
      })
      return res.status(500).json({ error: 'Server configuration error' })
    }

    // 2. Only allow POST
    if (req.method !== 'POST') {
      console.error('Invalid method:', req.method)
      return res.status(405).json({ error: 'Method Not Allowed' })
    }

    // 3. Extract Authorization header
    const authHeader = req.headers.authorization || req.headers.Authorization
    console.log('Auth header present:', !!authHeader)
    console.log('Auth header type:', typeof authHeader)
    
    if (!authHeader) {
      console.error('No authorization header')
      return res.status(401).json({ error: 'Missing authorization header' })
    }

    const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader
    console.log('Auth string starts with Bearer:', authStr.toLowerCase().startsWith('bearer '))

    if (!authStr.toLowerCase().startsWith('bearer ')) {
      console.error('Invalid authorization format')
      return res.status(401).json({ error: 'Invalid authorization format. Use: Bearer <token>' })
    }

    // 4. Parse request body
    let password: string
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
      password = body?.password
      console.log('Password present:', !!password)
      console.log('Password length:', password?.length || 0)
    } catch (parseError) {
      console.error('Body parse error:', parseError)
      return res.status(400).json({ error: 'Invalid JSON body' })
    }

    // 5. Validate password
    if (!password || typeof password !== 'string') {
      console.error('Invalid password:', typeof password)
      return res.status(400).json({ error: 'Password is required' })
    }
    if (password.length < 8) {
      console.error('Password too short:', password.length)
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }

    console.log('Creating user client...')

    // 6. Create Supabase client with user's auth header
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { 
        headers: { 
          Authorization: authStr 
        } 
      },
      auth: { 
        persistSession: false,
        autoRefreshToken: false 
      },
    })

    // 7. Get user from token
    console.log('Getting user from token...')
    const { data: userData, error: userError } = await userClient.auth.getUser()
    
    if (userError) {
      console.error('User verification error:', userError)
      return res.status(401).json({ 
        error: userError.message || 'Invalid or expired token',
        details: userError
      })
    }

    if (!userData?.user?.id) {
      console.error('No user ID in response')
      return res.status(401).json({ error: 'Invalid session' })
    }

    const userId = userData.user.id
    const userEmail = userData.user.email
    const needsEmailConfirm = !userData.user.email_confirmed_at

    console.log('User verified:', {
      id: userId,
      email: userEmail,
      needsEmailConfirm
    })

    // 8. Create admin client
    console.log('Creating admin client...')
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { 
        persistSession: false,
        autoRefreshToken: false 
      },
    })

    // 9. Update password (and confirm email if needed)
    console.log('Updating user password...')
    const updatePayload: any = { password }
    if (needsEmailConfirm) {
      console.log('Also confirming email')
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
        error: updateErr.message || 'Failed to update password',
        details: updateErr
      })
    }

    console.log('Password updated successfully')
    console.log('=== SET PASSWORD REQUEST END ===')

    return res.status(200).json({ 
      ok: true,
      message: 'Password set successfully',
      user: {
        id: userId,
        email: userEmail
      }
    })

  } catch (e: any) {
    console.error('Unexpected error:', e)
    console.error('Stack:', e.stack)
    return res.status(500).json({ 
      error: e?.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
    })
  }
}
