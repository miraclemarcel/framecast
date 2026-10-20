import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

/** Strict CSP in production; the dev server needs inline scripts (React refresh) and its websocket. */
function cspPlugin(): Plugin {
  let dev = false
  return {
    name: 'framecast-csp',
    configResolved(config) {
      dev = config.command === 'serve'
    },
    transformIndexHtml(html) {
      return html
        .replace('%CSP_SCRIPT%', dev ? "'self' 'unsafe-inline'" : "'self'")
        .replace('%CSP_CONNECT%', dev ? 'ws://localhost:* http://localhost:*' : '')
    }
  }
}

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@services': resolve(__dirname, 'src/services'),
  '@features': resolve(__dirname, 'src/features'),
  '@components': resolve(__dirname, 'src/components')
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react(), tailwindcss(), cspPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    }
  }
})
