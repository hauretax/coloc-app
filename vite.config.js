import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// En local, /api/* passe par les mêmes fonctions que sur Vercel (stockage en mémoire sans Redis).
function devApi() {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next()
        const url = new URL(req.url, 'http://local')
        const route = url.pathname.slice(5)
        let raw = ''
        for await (const chunk of req) raw += chunk
        let body = {}
        try { body = raw ? JSON.parse(raw) : {} } catch { body = {} }
        const { getApi, clientIp, send } = await import('./server/app.js')
        const query = Object.fromEntries(url.searchParams)
        const out = await getApi()(route, { method: req.method, body, query, headers: req.headers, ip: clientIp(req.headers) })
        send(res, out)
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    devApi(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'badge-96.png'],
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png}'] },
      manifest: {
        name: 'Chez nous',
        short_name: 'Chez nous',
        description: 'L’appli de la coloc : qui est là, qui fait du bruit, la porte du bas, les soirées et les envies.',
        theme_color: '#F5F6F9',
        background_color: '#F5F6F9',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'fr',
        id: '/',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
})
