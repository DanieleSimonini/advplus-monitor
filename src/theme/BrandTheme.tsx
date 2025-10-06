import React, { useEffect } from 'react'

export default function BrandTheme(){
  useEffect(()=>{
    // Google Font: Inter
    const id = 'gf-inter'
    if (!document.getElementById(id)){
      const link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap'
      document.head.appendChild(link)
    }

    // CSS variables + base styles
    const styleId = 'brand-theme-vars'
    if (!document.getElementById(styleId)){
      const st = document.createElement('style')
      st.id = styleId
      st.innerHTML = `
        :root{
          --brand-primary: #011750;
          --brand-primary-600: #0029ae;
          --brand-accent: #26c2a9;
          --brand-accent-200: #3beee2;
          --text: #111111;
          --muted: #666666;
          --bg: #f7f9fc;
          --card: #ffffff;
          --border: #e5e7eb;
        }
        html, body, #root { height: 100%; }
        body {
          background: var(--bg);
          color: var(--text);
          font-family: 'Inter', system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji','Segoe UI Emoji';
        }
        header.appbar {
          position: sticky; top: 0; z-index: 40;
          background: #fff;
          border-bottom: 1px solid var(--border);
        }
        .brand-btn {
          padding: 6px 10px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: #fff;
          color: var(--text);
        }
        .brand-btn.primary {
          background: var(--brand-primary-600);
          color: #fff;
          border-color: var(--brand-primary-600);
        }
        .brand-btn:hover {
          filter: brightness(0.98);
        }
        .brand-card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 16px;
        }
        .brand-kpi {
          display:flex; align-items:baseline; justify-content:space-between;
          margin-bottom:8px;
        }
        .brand-chip {
          display:inline-flex; align-items:center; gap:6px;
          padding: 4px 8px; border-radius: 999px;
          border: 1px solid var(--border);
          background: #fff;
          color: var(--muted);
          font-size: 12px;
        }
      `
      document.head.appendChild(st)
    }
  },[])
  return null
}
