import { createRoot } from 'react-dom/client'
import '@fontsource-variable/bricolage-grotesque/standard.css'
import '@fontsource-variable/figtree/index.css'
import '@fontsource-variable/pixelify-sans/index.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/screens.css'
import './styles/overlay.css'
import { App } from './App'
import { OverlayApp } from './overlay/OverlayApp'

const isOverlay = location.hash.startsWith('#/overlay')
if (isOverlay) document.documentElement.classList.add('is-overlay')

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')
createRoot(root).render(isOverlay ? <OverlayApp /> : <App />)
