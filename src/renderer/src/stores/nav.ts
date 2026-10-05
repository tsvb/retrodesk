import { create } from 'zustand'

export type SettingsTab = 'library' | 'emulators' | 'bios' | 'controls' | 'display' | 'ingame' | 'performance' | 'achievements' | 'about'

export type Route = { name: 'home' } | { name: 'systems' } | { name: 'games'; systemId: string } | { name: 'game'; gameId: string } | { name: 'search' } | { name: 'settings'; tab?: SettingsTab }

export type TabName = 'home' | 'systems' | 'search' | 'settings'
export const TABS: { name: TabName; label: string }[] = [
  { name: 'home', label: 'Home' },
  { name: 'systems', label: 'Systems' },
  { name: 'search', label: 'Search' },
  { name: 'settings', label: 'Settings' }
]

export interface StackEntry {
  key: number
  route: Route
}

interface NavState {
  stack: StackEntry[]
  push(route: Route): void
  replace(route: Route): void
  back(): boolean
  switchTab(tab: TabName, route?: Route): void
  cycleTab(delta: 1 | -1): void
}

let keySeq = 0
const entry = (route: Route): StackEntry => ({ key: ++keySeq, route })

function encode(r: Route): string {
  switch (r.name) {
    case 'games':
      return `games~${encodeURIComponent(r.systemId)}`
    case 'game':
      return `game~${encodeURIComponent(r.gameId)}`
    case 'settings':
      return r.tab ? `settings~${r.tab}` : 'settings'
    default:
      return r.name
  }
}

function decode(seg: string): Route | null {
  const [name, arg] = seg.split('~')
  switch (name) {
    case 'home':
    case 'systems':
    case 'search':
      return { name }
    case 'settings':
      return { name, tab: (arg as SettingsTab | undefined) || undefined }
    case 'games':
      return arg ? { name, systemId: decodeURIComponent(arg) } : null
    case 'game':
      return arg ? { name, gameId: decodeURIComponent(arg) } : null
    default:
      return null
  }
}

function initialStack(): StackEntry[] {
  const segs = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const routes = segs.map(decode).filter((r): r is Route => r !== null)
  if (!routes.length || !['home', 'systems', 'search', 'settings'].includes(routes[0]?.name ?? '')) return [entry({ name: 'home' })]
  return routes.map(entry)
}

function writeHash(stack: StackEntry[]): void {
  const hash = `#/${stack.map((e) => encode(e.route)).join('/')}`
  if (location.hash !== hash) history.replaceState(null, '', hash)
}

export const useNav = create<NavState>((set, get) => ({
  stack: initialStack(),
  push(route) {
    set((s) => ({ stack: [...s.stack, entry(route)] }))
    writeHash(get().stack)
  },
  replace(route) {
    set((s) => ({ stack: [...s.stack.slice(0, -1), entry(route)] }))
    writeHash(get().stack)
  },
  back() {
    const { stack } = get()
    if (stack.length <= 1) return false
    set({ stack: stack.slice(0, -1) })
    writeHash(get().stack)
    return true
  },
  switchTab(tab, route) {
    const { stack } = get()
    const root = stack[0]?.route
    if (stack.length === 1 && root?.name === tab && !route) return
    set({ stack: [entry(route ?? ({ name: tab } as Route))] })
    writeHash(get().stack)
  },
  cycleTab(delta) {
    const cur = get().stack[0]?.route.name
    const i = TABS.findIndex((t) => t.name === cur)
    const next = TABS[(i + delta + TABS.length) % TABS.length]
    if (next) get().switchTab(next.name)
  }
}))

export const currentTab = (s: NavState): TabName => (s.stack[0]?.route.name as TabName | undefined) ?? 'home'
