import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the spike from /<repo>/; set BASE_PATH there (see workflow).
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  worker: { format: 'es' },
  build: { target: 'safari15' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Revize – QR spike',
        short_name: 'QR spike',
        description: 'Technický test skenování QR kódů pro aplikaci Revize',
        lang: 'cs',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,png,svg}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // On GitHub Pages the office demo lives at /app/ inside this scope; never serve the spike
        // shell for it.
        navigateFallbackDenylist: [/\/app\//],
      },
    }),
  ],
});
