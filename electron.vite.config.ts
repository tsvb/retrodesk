import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared }
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
