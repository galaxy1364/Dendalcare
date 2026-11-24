import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Ensures PWA manifest and static icon paths stay at root-relative URLs (never moved into ./assets/)
function preservePwaPathsPlugin(): Plugin {
  return {
    name: 'preserve-pwa-paths',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html
          .replace(
            /<link\s+rel="manifest"[^>]*>/i,
            '<link rel="manifest" href="./manifest.json" crossorigin="use-credentials" />'
          )
          .replace(/href="\.?\/assets\/favicon-[^"]+\.svg"/g, 'href="./favicon.svg"')
          .replace(/href="\.?\/assets\/icon-192-[^"]+\.webp"/g, 'href="./icon-192.webp"')
          .replace(/href="\.?\/assets\/icon-192-[^"]+\.png"/g, 'href="./icon-192.png"')
          .replace(/href="\.?\/assets\/icon-512-[^"]+\.png"/g, 'href="./icon-512.png"')
          .replace(/href="\.?\/assets\/apple-touch-icon-[^"]+\.png"/g, 'href="./apple-touch-icon.png"');
      },
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), preservePwaPathsPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
