import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CompactApp } from './CompactApp'
import { actions, initStore } from './store'
import './styles.css'

// The same bundle serves both windows; the URL hash picks the layout.
const compact = window.location.hash === '#compact'
// Set before the first paint so the transparent compact window never flashes a background.
document.documentElement.classList.toggle('compact', compact)

createRoot(document.getElementById('root')!).render(<StrictMode>{compact ? <CompactApp /> : <App />}</StrictMode>)

initStore().catch((err) => actions.errorToast('FrameCast failed to initialize', err))
