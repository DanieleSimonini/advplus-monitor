import React from 'react'
import { createRoot } from 'react-dom/client'
import RootApp from './RootApp'

import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/shell.css'

const container = document.getElementById('root')
if (!container) throw new Error('Elemento #root non trovato in index.html')

createRoot(container).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
)
