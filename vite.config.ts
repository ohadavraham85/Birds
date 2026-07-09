import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app under /Birds/. Local dev/preview use '/'.
const base = process.env.GITHUB_PAGES ? '/Birds/' : '/';

export default defineConfig({
  base,
  build: {
    target: 'es2021',
    sourcemap: true,
  },
  server: {
    port: 8787,
    // dev proxy to the reference sync server so the app can call /api/* same-origin
    proxy: {
      '/api': { target: 'http://localhost:8790', changeOrigin: true },
    },
  },
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: null, // we register manually in main.ts for lifecycle control
      manifest: {
        name: 'יומן צפרות — ניהול ותיעוד תצפיות',
        short_name: 'יומן צפרות',
        description:
          'מערכת offline-first לניהול ותיעוד תצפיות צפרות, עם סנכרון לשרת כשחוזרת התקשורת.',
        lang: 'he',
        dir: 'rtl',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#fbfdfb',
        theme_color: '#2d6a4f',
        categories: ['productivity', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
});
