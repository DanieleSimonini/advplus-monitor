diff --git a/api/set_password.ts b/api/set_password.ts
index 32e90b13ec6d7d496dcb3b6b95ab4f081e939e62..4876960ee46ea89a6be02f514fc92461e1dda6a5 100644
--- a/api/set_password.ts
+++ b/api/set_password.ts
@@ -1,45 +1,160 @@
+import type { VercelRequest, VercelResponse } from '@vercel/node'
+import { createClient } from '@supabase/supabase-js'
+
+function decodeJwt(token: string): Record<string, any> | undefined {
+  const parts = token.split('.')
+  if (parts.length < 2) return undefined
+  try {
+    const payload = parts[1]
+      .replace(/-/g, '+')
+      .replace(/_/g, '/')
+      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=')
+    const json = Buffer.from(payload, 'base64').toString('utf8')
+    return JSON.parse(json)
+  } catch (error) {
+    return undefined
+  }
+}
+
+function isTokenExpired(claims?: { exp?: number }): boolean {
+  if (!claims?.exp) return false
+  const now = Math.floor(Date.now() / 1000)
+  return claims.exp < now
+}
+
+const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
+const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
+const SUPABASE_SERVICE_ROLE_KEY =
+  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
+
+function applyCors(res: VercelResponse) {
+  res.setHeader('Access-Control-Allow-Origin', '*')
+  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
+  res.setHeader('Access-Control-Allow-Headers', 'authorization, Authorization, x-client-info, apikey, content-type')
+  res.setHeader('Access-Control-Max-Age', '86400')
+}
+
+function extractAuthHeader(headers: VercelRequest['headers']): string | undefined {
+  const raw = headers.authorization ?? (headers as Record<string, string | string[] | undefined>).Authorization
+  if (!raw) return undefined
+  return Array.isArray(raw) ? raw.find(Boolean) : raw
+}
+
+function getBearerToken(authHeader: string): string | undefined {
+  const match = authHeader.match(/^\s*bearer\s+(.+)$/i)
+  return match?.[1]?.trim()
+}
+
+async function readRequestBody(req: VercelRequest): Promise<string | object | undefined> {
+  if (typeof req.body !== 'undefined') return req.body as any
+
+  return new Promise((resolve, reject) => {
+    let acc: Buffer[] = []
+    req
+      .on('data', (chunk: Buffer) => {
+        acc.push(Buffer.from(chunk))
+      })
+      .on('end', () => {
+        if (!acc.length) {
+          resolve(undefined)
+          return
+        }
+        try {
+          resolve(Buffer.concat(acc).toString('utf8'))
+        } catch (error) {
+          reject(error)
+        }
+      })
+      .on('error', reject)
+  })
+}
+
+async function parseBody(req: VercelRequest): Promise<{ password?: string }> {
+  const body = await readRequestBody(req)
+  if (!body) return {}
+  if (typeof body === 'string') {
+    const trimmed = body.trim()
+    if (!trimmed) return {}
+    try {
+      return JSON.parse(trimmed)
+    } catch (error) {
+      throw Object.assign(new Error('Invalid JSON body'), { status: 400 })
+    }
+  }
+  if (Buffer.isBuffer(body)) {
+    try {
+      return JSON.parse(body.toString('utf8'))
+    } catch (error) {
+      throw Object.assign(new Error('Invalid JSON body'), { status: 400 })
+    }
+  }
+  if (typeof body === 'object') {
+    return body as { password?: string }
+  }
+  throw Object.assign(new Error('Unsupported body format'), { status: 400 })
+}
+
+export default async function handler(req: VercelRequest, res: VercelResponse) {
+  applyCors(res)
+
+  if (req.method === 'OPTIONS') return res.status(204).end()
 
   try {
     if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
       return res.status(500).json({ error: 'Missing Supabase env on server' })
     }
     if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
 
+    const authHeader = extractAuthHeader(req.headers)
+    if (!authHeader || !/^bearer\s+/i.test(authHeader)) {
       return res.status(401).json({ error: 'Missing bearer token' })
     }

+
+    const accessToken = getBearerToken(authHeader)
+    if (!accessToken) {
+      return res.status(401).json({ error: 'Invalid bearer token' })
+    }
+
+    const { password } = await parseBody(req)
+    if (!password || password.length < 8) {
       return res.status(400).json({ error: 'Password too short' })
     }
 
+    const claims = decodeJwt(accessToken)
+    if (!claims?.sub || typeof claims.sub !== 'string') {
+      return res.status(401).json({ error: 'Invalid session token' })
+    }
+    if (isTokenExpired(claims)) {
+      return res.status(401).json({ error: 'Session token expired' })
+    }
+
+    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
+      auth: { persistSession: false, autoRefreshToken: false },
     })
+
+    const { data: userInfo, error: userInfoErr } = await admin.auth.admin.getUserById(claims.sub)
+    if (userInfoErr || !userInfo?.user?.id) {
+      const status = typeof (userInfoErr as { status?: number })?.status === 'number'
+        ? (userInfoErr as { status?: number }).status
+        : 401
+      return res.status(status).json({ error: userInfoErr?.message || 'Utente non trovato' })
+    }
+
+    const { error: updateErr } = await admin.auth.admin.updateUserById(userInfo.user.id, {
       password,
+      ...(userInfo.user.email_confirmed_at ? {} : { email_confirm: true }),
     })
+
     if (updateErr) {
       const status = typeof (updateErr as { status?: number }).status === 'number'

+        ? ((updateErr as { status?: number }).status ?? 400)
         : 400
       return res.status(status).json({ error: updateErr.message })
     }
 
     return res.status(200).json({ ok: true })
   } catch (e: any) {
+    const status = typeof e?.status === 'number' ? e.status : 500
+    return res.status(status).json({ error: e?.message || String(e) })
   }
 }
