import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app under /Birds/. Local dev/preview use '/'.
const base = process.env.GITHUB_PAGES ? '/Birds/' : '/';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || ''),
  },
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
      // 'prompt' is what actually wires up registerSW()'s onNeedRefresh in
      // the generated client code (vite-plugin-pwa/dist/client/build/register.js)
      // — with 'autoUpdate' it's silently never called at all, and the page
      // just reloads itself on its own the moment a new SW activates.
      registerType: 'prompt',
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
        // Android paints its navigation bar (below the app's tab bar) in this
        // fixed color — it can't follow the chosen color set, so it matches
        // the white tab bar instead of being the old green.
        theme_color: '#ffffff',
        categories: ['productivity', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        // Lets the OS "share" sheet (e.g. selecting photos in the phone's own
        // Gallery app and tapping "Share") list this app as a target — the
        // shared photos land straight in the Gallery tab. Handled by sw.ts
        // (only a service worker can read a share-target POST body) + the
        // #share-target pickup in main.ts/gallery.ts.
        share_target: {
          action: 'share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [{ name: 'photos', accept: ['image/*'] }],
          },
        },
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The main bundle is past Workbox's 2 MiB default; it must still be
        // precached or the app won't open offline in the field.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
});
