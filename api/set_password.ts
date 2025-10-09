 if (req.method === 'OPTIONS') return res.status(200).send('ok')

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase env on server' })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })

    const auth = req.headers.authorization || req.headers.Authorization as string | undefined
    if (!auth || !auth.toString().toLowerCase().startsWith('bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' })
    }
    const { password } = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {}
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password too short' })
    }

    // 1) Verifica il JWT dell’utente e prendi il suo id
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth as string } },
      auth: { persistSession: false },
    })
    const { data: u, error: uerr } = await userClient.auth.getUser()
    if (uerr || !u?.user?.id) return res.status(401).json({ error: uerr?.message || 'Invalid session' })
    const userId = u.user.id
    const needsEmailConfirm = !u.user.email_confirmed_at

    // 2) Aggiorna la password e conferma l'email (se necessario) con il service role per evitare sessioni mancanti
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
      password,
      ...(needsEmailConfirm ? { email_confirm: true } : {}),
    })
    if (updateErr) {
      const status = typeof (updateErr as { status?: number }).status === 'number'
        ? (updateErr as { status?: number }).status || 400
        : 400
      return res.status(status).json({ error: updateErr.message })
    }

    return res.status(200).json({ ok: true })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) })
  }
}
