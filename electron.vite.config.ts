import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    // The gamepads utility process is its own entry (see src/main/gamepads.ts).
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), 'gamepads-worker': resolve('src/main/gamepads-worker.ts') }
      }
    }
  },
  preload: {
    resolve: { alias: shared }
  },
  renderer: {
    resolve: {
      alias: { ...shared, '@renderer': resolve('src/renderer/src') }
    },
    plugins: [react()],
    // electron-vite leaves the renderer unminified by default; minifying roughly halves what each window parses.
    build: { minify: 'esbuild', cssMinify: 'esbuild' }
  }
})
