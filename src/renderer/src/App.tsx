import { memo, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { api, pathForFile } from './api'
import { HintBar } from './components/HintBar'
import { TaskTray, Toasts } from './components/TaskTray'
import { TopBar, Wordmark } from './components/TopBar'
import { installGamepad } from './input/gamepad'
import { FocusScope, useActions } from './input/hooks'
import { installKeyboard } from './input/keyboard'
import { importPaths } from './lib/libraryActions'
import { primeAudioOnGesture, suspendAudio } from './lib/sound'
import { GameDetailScreen } from './screens/GameDetail'
import { GameListScreen } from './screens/GameList'
import { HomeScreen } from './screens/Home'
import { NowPlaying } from './screens/NowPlaying'
import { Onboarding } from './screens/Onboarding'
import { SearchScreen } from './screens/Search'
import { SettingsScreen } from './screens/settings/Settings'
import { SystemsScreen } from './screens/Systems'
import { followLibraryChanges, useLibrary } from './stores/library'
import { currentTab, useNav, type Route, type StackEntry } from './stores/nav'
import { followGameIdle, useSession, useTasks } from './stores/session'
import { currentButtonLayout } from './stores/input'
import { followSettingsChanges, useSettings } from './stores/settings'
import { useUi } from './stores/ui'

async function syncFullscreen(): Promise<void> {
  try {
    useUi.getState().setFullscreen(await api.window.isFullscreen())
  } catch {
    /* ignore */
  }
}

/** Boot: load state, subscribe to backend events, install input devices. */
function useBoot(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const offs = [
      api.on.task((t) => useTasks.getState().upsert(t)),
      api.on.session((s) => {
        const had = useSession.getState().session
        useSession.getState().set(s)
        // The game has the speakers now; let go of the audio device until our next UI sound.
        if (s && !had) suspendAudio()
        if (had && !s) void useLibrary.getState().refresh()
      }),
      followSettingsChanges(),
      followGameIdle(),
      followLibraryChanges(),
      installKeyboard({
        onFullscreen: () => void api.window.toggleFullscreen().then((f) => useUi.getState().setFullscreen(f))
      }),
      installGamepad({ mode: 'main', getLayout: currentButtonLayout })
    ]
    primeAudioOnGesture()
    void (async () => {
      try {
        await useSettings.getState().load()
      } catch (e) {
        console.error('Failed to load settings', e)
      }
      setReady(true)
      await Promise.all([useLibrary.getState().refresh(), api.game.getSession().then((s) => useSession.getState().set(s)), syncFullscreen()])
    })()
    let rz: ReturnType<typeof setTimeout> | undefined
    const onResize = () => {
      clearTimeout(rz)
      rz = setTimeout(syncFullscreen, 200)
    }
    window.addEventListener('resize', onResize)
    return () => {
      offs.forEach((off) => off())
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return ready
}

export function App() {
  const ready = useBoot()
  const settings = useSettings((s) => s.settings)
  const session = useSession((s) => s.session)

  if (!ready || !settings)
    return (
      <div className="splash">
        <Wordmark />
      </div>
    )

  return (
    <div className="app">
      <Ambient />
      {!settings.onboarded ? (
        <Onboarding />
      ) : (
        <>
          <GlobalActions />
          <TopBar />
          <ScreenStack />
          {session && (
            <FocusScope isolated>
              <NowPlaying session={session} />
            </FocusScope>
          )}
          <HintBar />
        </>
      )}
      <TaskTray />
      <Toasts />
      <DropZone />
    </div>
  )
}

/**
 * Background light tinted by the focused system/game. The color lives on this element only, so focusing a card
 * from another system restyles one div instead of re-rendering the app and every mounted screen.
 */
function Ambient() {
  const ambient = useUi((s) => s.ambient)
  return <div className="ambient" aria-hidden="true" style={{ '--ambient': ambient ?? 'var(--accent)' } as CSSProperties} />
}

/** Root-scope bindings available on every screen (screens can override them). */
function GlobalActions() {
  const nav = useNav()
  const tab = useNav(currentTab)
  useActions({
    tabPrev: { label: 'Section', run: () => nav.cycleTab(-1) },
    tabNext: { label: 'Section', run: () => nav.cycleTab(1) },
    search: () => nav.switchTab('search'),
    back: () => {
      if (nav.back()) return true
      if (tab !== 'home') {
        nav.switchTab('home')
        return true
      }
      return false
    }
  })
  return null
}

function screenFor(route: Route): ReactNode {
  switch (route.name) {
    case 'home':
      return <HomeScreen />
    case 'systems':
      return <SystemsScreen />
    case 'games':
      return <GameListScreen systemId={route.systemId} />
    case 'game':
      return <GameDetailScreen gameId={route.gameId} />
    case 'search':
      return <SearchScreen />
    case 'settings':
      return <SettingsScreen initialTab={route.tab} />
  }
}

/**
 * Every stack entry stays mounted (scroll + focus survive); only the top one is visible and navigable.
 * Memoized: App re-renders when a game starts or settings change, and the screens subscribe to what they need.
 */
const ScreenStack = memo(function ScreenStack() {
  const stack = useNav((s) => s.stack)
  return (
    <div className="stack">
      {stack.map((e: StackEntry, i) => (
        <section
          key={e.key}
          className={`layer ${i === stack.length - 1 ? 'is-top' : 'is-below'} ${stack.length > 1 && i === stack.length - 1 ? 'is-pushed' : ''}`}
          aria-hidden={i !== stack.length - 1}
        >
          <FocusScope id={`screen-${e.key}`}>
            <ScreenBack />
            {screenFor(e.route)}
          </FocusScope>
        </section>
      ))}
    </div>
  )
})

/** Labels the back hint on pushed screens. */
function ScreenBack() {
  const stack = useNav((s) => s.stack)
  const tab = useNav(currentTab)
  const back = useNav((s) => s.back)
  const switchTab = useNav((s) => s.switchTab)
  const canPop = stack.length > 1
  useActions({
    back: canPop ? { label: 'Back', run: () => back() } : tab !== 'home' ? { label: 'Home', run: () => switchTab('home') } : undefined
  })
  return null
}

function DropZone() {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setOver(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setOver(false)
    }
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setOver(false)
      const paths = Array.from(e.dataTransfer?.files ?? [])
        .map((f) => pathForFile(f))
        .filter((p): p is string => !!p)
      void importPaths(paths)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overFn)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overFn)
      window.removeEventListener('drop', drop)
    }
  }, [])
  if (!over) return null
  return (
    <div className="dropzone">
      <div className="dropzone__card">
        <Upload size="2.4em" />
        <strong>Drop to import</strong>
        <span>ROMs are copied into your library and sorted by system.</span>
      </div>
    </div>
  )
}
