diff --git a/api/set_password.ts b/api/set_password.ts
index 32e90b13ec6d7d496dcb3b6b95ab4f081e939e62..133ac730819365dfb7a2abfc55b6ed77d4540c88 100644
--- a/api/set_password.ts
+++ b/api/set_password.ts
@@ -1,45 +1,88 @@
- if (req.method === 'OPTIONS') return res.status(200).send('ok')
+import type { VercelRequest, VercelResponse } from '@vercel/node'
+import { createClient } from '@supabase/supabase-js'
+
+const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
+const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
+const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
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
+function parseBody(req: VercelRequest): { password?: string } {
+  const body = req.body
+  if (!body) return {}
+  if (typeof body === 'string') {
+    try {
+      return JSON.parse(body)
+    } catch (error) {
+      throw new Error('Invalid JSON body')
+    }
+  }
+  if (typeof body === 'object') {
+    return body as { password?: string }
+  }
+  throw new Error('Unsupported body format')
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
 
-    const auth = req.headers.authorization || req.headers.Authorization as string | undefined
-    if (!auth || !auth.toString().toLowerCase().startsWith('bearer ')) {
+    const authHeader = extractAuthHeader(req.headers)
+    if (!authHeader || !/^bearer\s+/i.test(authHeader)) {
       return res.status(401).json({ error: 'Missing bearer token' })
     }
-    const { password } = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {}
-    if (typeof password !== 'string' || password.length < 8) {
+
+    const { password } = parseBody(req)
+    if (!password || password.length < 8) {
       return res.status(400).json({ error: 'Password too short' })
     }
 
-    // 1) Verifica il JWT dell’utente e prendi il suo id
     const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
-      global: { headers: { Authorization: auth as string } },
-      auth: { persistSession: false },
+      global: { headers: { Authorization: authHeader } },
+      auth: { persistSession: false, autoRefreshToken: false },
     })
-    const { data: u, error: uerr } = await userClient.auth.getUser()
-    if (uerr || !u?.user?.id) return res.status(401).json({ error: uerr?.message || 'Invalid session' })
-    const userId = u.user.id
-    const needsEmailConfirm = !u.user.email_confirmed_at
-
-    // 2) Aggiorna la password e conferma l'email (se necessario) con il service role per evitare sessioni mancanti
-    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
-    const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
+
+    const { data: userData, error: userError } = await userClient.auth.getUser()
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
-      ...(needsEmailConfirm ? { email_confirm: true } : {}),
+      ...(userData.user.email_confirmed_at ? {} : { email_confirm: true }),
     })
+
     if (updateErr) {
       const status = typeof (updateErr as { status?: number }).status === 'number'
-        ? (updateErr as { status?: number }).status || 400
+        ? ((updateErr as { status?: number }).status ?? 400)
         : 400
       return res.status(status).json({ error: updateErr.message })
     }
 
     return res.status(200).json({ ok: true })
   } catch (e: any) {
     return res.status(500).json({ error: e?.message || String(e) })
   }
 }
