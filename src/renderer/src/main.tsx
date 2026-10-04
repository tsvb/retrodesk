import { createRoot } from 'react-dom/client'
import '@fontsource-variable/bricolage-grotesque/standard.css'
import '@fontsource-variable/figtree/index.css'
import '@fontsource-variable/pixelify-sans/index.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/screens.css'
import './styles/overlay.css'
import { bridgeMissing } from './api'
import { App } from './App'
import { OverlayApp } from './overlay/OverlayApp'

const isOverlay = location.hash.startsWith('#/overlay')
if (isOverlay) document.documentElement.classList.add('is-overlay')

/** Shown instead of the app when the preload script did not load. */
function BridgeMissing() {
  return (
    <div className="splash">
      <p style={{ maxWidth: '36rem', textAlign: 'center' }}>RetroDesk could not start because its preload script did not load. Reinstalling RetroDesk should fix this.</p>
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')
createRoot(root).render(bridgeMissing ? isOverlay ? null : <BridgeMissing /> : isOverlay ? <OverlayApp /> : <App />)
