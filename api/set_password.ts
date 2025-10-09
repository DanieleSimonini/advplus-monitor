diff --git a/api/set_password.ts b/api/set_password.ts
index 32e90b13ec6d7d496dcb3b6b95ab4f081e939e62..95aa384c72de9d66970bcf7e957b722f7f01375d 100644

+++ b/api/set_password.ts
@@ -1,45 +1,132 @@
+import type { VercelRequest, VercelResponse } from '@vercel/node'
+import { createClient } from '@supabase/supabase-js'
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
 
+      auth: { persistSession: false, autoRefreshToken: false },
     })
+
+    const { data: userData, error: userError } = await userClient.auth.getUser(accessToken)
+    if (userError || !userData?.user?.id) {
+      return res.status(401).json({ error: userError?.message || 'Invalid session' })
+    }
+
+    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
+      auth: { persistSession: false, autoRefreshToken: false },
+    })
+
+    const { error: updateErr } = await admin.auth.admin.updateUserById(userData.user.id, {
       password,
+      ...(userData.user.email_confirmed_at ? {} : { email_confirm: true }),
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
