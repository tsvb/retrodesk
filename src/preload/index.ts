import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { API_SHAPE, EVENTS, type RetroDeskApi } from '../shared/api'

function subscribe<T>(channel: string) {
  return (cb: (payload: T) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

const api: Record<string, unknown> = {}
for (const [ns, methods] of Object.entries(API_SHAPE)) {
  const group: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const m of methods) group[m] = (...args) => ipcRenderer.invoke(`${ns}:${m}`, ...args)
  api[ns] = group
}
api.on = {
  task: subscribe(EVENTS.task),
  session: subscribe(EVENTS.session),
  libraryChanged: subscribe(EVENTS.libraryChanged),
  overlay: subscribe(EVENTS.overlay),
  settingsChanged: subscribe(EVENTS.settingsChanged)
} satisfies RetroDeskApi['on']

contextBridge.exposeInMainWorld('retrodesk', api as unknown as RetroDeskApi)
// Drag-and-drop: File objects no longer expose .path; let the renderer resolve it.
contextBridge.exposeInMainWorld('retrodeskFiles', { pathFor: (f: File) => webUtils.getPathForFile(f) })
