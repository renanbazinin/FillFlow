/// <reference types="vitest/config" />
import { createReadStream, cpSync, existsSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const PDFJS_ROOT = join(import.meta.dirname, 'node_modules/pdfjs-dist')
const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs']

/**
 * pdf.js loads CMaps, standard fonts, wasm decoders and ICC profiles at runtime.
 * Serve them from node_modules in dev and copy them to `dist/pdfjs/` on build.
 */
function pdfjsAssets(): Plugin {
  let outDir = 'dist'
  return {
    name: 'fillflow:pdfjs-assets',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        const match = path.match(/\/pdfjs\/(cmaps|standard_fonts|wasm|iccs)\/([^/]+)$/)
        if (!match) return next()
        let name: string
        try {
          name = decodeURIComponent(match[2])
        } catch {
          return next()
        }
        // Plain file names only: an encoded "..%2F" or "..%5C" must never escape the folder.
        if (name !== basename(name) || name.includes('..') || /[/\\:]/.test(name)) return next()
        const file = join(PDFJS_ROOT, match[1], name)
        if (!existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },
    writeBundle() {
      for (const dir of PDFJS_ASSET_DIRS) {
        cpSync(join(PDFJS_ROOT, dir), join(outDir, 'pdfjs', dir), { recursive: true })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/FillFlow/',
  plugins: [react(), tailwindcss(), pdfjsAssets()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
