import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if ('__TAURI_INTERNALS__' in window) document.documentElement.classList.add('tauri')

const rootEl = document.getElementById('root')
if (!rootEl) {
  document.body.textContent = 'Hyperlight failed to start: missing root element. Reload the app.'
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
