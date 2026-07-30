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
  },
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: null, // we register manually in main.ts for lifecycle control
      manifest: {
        name: 'ניהול נכסי חשמל — מפת נכסים ותחזוקה',
        short_name: 'נכסי חשמל',
        description:
          'מערכת offline-first לניהול מפת נכסי חשמל (עמודים, שנאים, לוחות, מוני חשמל וקווים) עם יומן תחזוקה.',
        lang: 'he',
        dir: 'rtl',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#eef0f2',
        theme_color: '#1b2330',
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
