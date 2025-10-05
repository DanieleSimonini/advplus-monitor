import React, { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

export default function DashboardPage() {
  const [uid, setUid] = useState<string>('')
  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession()
      setUid(s?.session?.user?.id || '')
      console.log('[DASHBOARD SMOKE] session uid =', s?.session?.user?.id)
    })()
  }, [])

  return (
    <div style={{ padding: 16 }}>
      <div style={{ padding: 10, border: '2px dashed #f00', borderRadius: 8, background: '#fff0f0' }}>
        <b>BUILD MARKER</b> · <code>Dashboard.tsx — SMOKE v1</code>
      </div>

      <div style={{ marginTop: 12 }}>
        <div>Se vedi questo riquadro rosso, <b>stai usando proprio questo file Dashboard.tsx</b>.</div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#555' }}>
          UID sessione: <code>{uid || 'n/a'}</code>
        </div>
      </div>
    </div>
  )
}

