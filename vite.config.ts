import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// Ensures PWA manifest and static icon paths stay at root-relative URLs (never moved into ./assets/)
// AND automatically syncs the compiled bundle to gh-pages-dist/app.js & app.css on every build!
function preservePwaPathsPlugin(): Plugin {
  return {
    name: 'preserve-pwa-paths-and-gh-pages-sync',
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
    closeBundle() {
      try {
        const rootDir = process.cwd();
        const distAssetsDir = path.join(rootDir, 'dist', 'assets');
        const ghPagesDir = path.join(rootDir, 'gh-pages-dist');
        const distGhPagesDir = path.join(rootDir, 'dist', 'gh-pages-dist');

        if (!fs.existsSync(distAssetsDir)) return;
        fs.mkdirSync(ghPagesDir, { recursive: true });
        fs.mkdirSync(distGhPagesDir, { recursive: true });

        const files = fs.readdirSync(distAssetsDir);
        const jsFile = files.find((f) => f.startsWith('index-') && f.endsWith('.js'));
        const cssFile = files.find((f) => f.startsWith('index-') && f.endsWith('.css'));

        if (jsFile) {
          const jsPath = path.join(distAssetsDir, jsFile);
          fs.copyFileSync(jsPath, path.join(ghPagesDir, 'app.js'));
          fs.copyFileSync(jsPath, path.join(distGhPagesDir, 'app.js'));
        }
        if (cssFile) {
          const cssPath = path.join(distAssetsDir, cssFile);
          fs.copyFileSync(cssPath, path.join(ghPagesDir, 'app.css'));
          fs.copyFileSync(cssPath, path.join(distGhPagesDir, 'app.css'));
        }

        for (const rootAsset of ['version.json', 'manifest.json', 'sw.js', 'index.html']) {
          const srcAsset = path.join(rootDir, 'dist', rootAsset);
          if (fs.existsSync(srcAsset)) {
            fs.copyFileSync(srcAsset, path.join(ghPagesDir, rootAsset));
          }
        }
      } catch (err) {
        console.warn('gh-pages-dist auto-sync warning:', err);
      }
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
