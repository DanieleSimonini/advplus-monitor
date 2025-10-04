import React, { useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts'

const mock = {
  leads: 42,
  contacts: 60,
  appointments: 18,
  proposals: 9,
  contracts: 5
}

export default function Dashboard() {
  const data = useMemo(() => [
    { name: 'Leads', value: mock.leads },
    { name: 'Contatti', value: mock.contacts },
    { name: 'Appuntamenti', value: mock.appointments },
    { name: 'Proposte', value: mock.proposals },
    { name: 'Contratti', value: mock.contracts }
  ], [])

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <Stat label="Leads" value={mock.leads} />
        <Stat label="Contatti" value={mock.contacts} />
        <Stat label="Appuntamenti" value={mock.appointments} />
        <Stat label="Proposte" value={mock.proposals} />
        <Stat label="Contratti" value={mock.contracts} />
      </div>

      <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 16, padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Funnel (mock)</div>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={data}>
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="value" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 16, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800 }}>{value}</div>
    </div>
  )
}
