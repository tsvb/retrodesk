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
const reactRoot = createRoot(root)
// Each window loads only its own UI: the overlay never parses the front end's screens, and vice versa.
if (bridgeMissing) reactRoot.render(isOverlay ? null : <BridgeMissing />)
else if (isOverlay) void import('./overlay/OverlayApp').then(({ OverlayApp }) => reactRoot.render(<OverlayApp />))
else void import('./App').then(({ App }) => reactRoot.render(<App />))
