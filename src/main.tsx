import React from 'react'
import { createRoot } from 'react-dom/client'
import RootApp from './RootApp'

const container = document.getElementById('root') || (()=> {
  const d = document.createElement('div'); d.id='root'; document.body.appendChild(d); return d
})()

createRoot(container).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
)
