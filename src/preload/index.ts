import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { API_SHAPE, EVENT_NAMES, eventChannel, type RetroDeskApi } from '../shared/api'

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
api.on = Object.fromEntries(EVENT_NAMES.map((name) => [name, subscribe(eventChannel(name))]))

contextBridge.exposeInMainWorld('retrodesk', api as unknown as RetroDeskApi)
// Drag-and-drop: File objects no longer expose .path; let the renderer resolve it.
contextBridge.exposeInMainWorld('retrodeskFiles', { pathFor: (f: File) => webUtils.getPathForFile(f) })
