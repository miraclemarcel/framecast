import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { actions, initStore } from './store'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

initStore().catch((err) => actions.errorToast('FrameCast failed to initialize', err))
