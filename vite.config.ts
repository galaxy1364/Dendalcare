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
        const distDir = path.join(rootDir, 'dist');
        const distAssetsDir = path.join(distDir, 'assets');
        const distFontsDir = path.join(distDir, 'fonts');
        const ghPagesDir = path.join(rootDir, 'gh-pages-dist');
        const distGhPagesDir = path.join(distDir, 'gh-pages-dist');

        if (!fs.existsSync(distAssetsDir)) return;
        fs.mkdirSync(ghPagesDir, { recursive: true });
        fs.mkdirSync(distGhPagesDir, { recursive: true });

        // Clean stale hashed JS/CSS chunk files in gh-pages-dist (preserve binary installers/icons)
        for (const existing of fs.readdirSync(ghPagesDir)) {
          if (
            (existing.endsWith('.js') || existing.endsWith('.css')) &&
            existing !== 'sw.js'
          ) {
            try {
              fs.unlinkSync(path.join(ghPagesDir, existing));
            } catch {}
          }
        }

        const files = fs.readdirSync(distAssetsDir);
        const jsFile = files.find((f) => f.startsWith('index-') && f.endsWith('.js'));
        const cssFile = files.find((f) => f.startsWith('index-') && f.endsWith('.css'));

        const syncedChunkFiles: string[] = [];

        // Copy ALL JS/CSS chunks from dist/assets/ so relative ESM imports (./*.js) resolve inside gh-pages-dist/
        for (const file of files) {
          if (file.endsWith('.js') || file.endsWith('.css')) {
            const srcFile = path.join(distAssetsDir, file);
            fs.copyFileSync(srcFile, path.join(ghPagesDir, file));
            fs.copyFileSync(srcFile, path.join(distGhPagesDir, file));
            syncedChunkFiles.push(file);
          }
        }

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

        // Copy self-hosted fonts so gh-pages-dist/app.css ./fonts/* URLs resolve cleanly
        if (fs.existsSync(distFontsDir)) {
          for (const targetFontsDir of [
            path.join(ghPagesDir, 'fonts'),
            path.join(distGhPagesDir, 'fonts'),
          ]) {
            fs.mkdirSync(targetFontsDir, { recursive: true });
            for (const f of fs.readdirSync(distFontsDir)) {
              fs.copyFileSync(path.join(distFontsDir, f), path.join(targetFontsDir, f));
            }
          }
        }

        // Write chunk manifest for GitHub Pages direct-publish sync
        const chunksManifest = JSON.stringify({ files: syncedChunkFiles }, null, 2);
        fs.writeFileSync(path.join(ghPagesDir, 'chunks.json'), chunksManifest, 'utf8');
        fs.writeFileSync(path.join(distGhPagesDir, 'chunks.json'), chunksManifest, 'utf8');

        for (const rootAsset of ['version.json', 'manifest.json', 'sw.js', 'index.html']) {
          const srcAsset = path.join(distDir, rootAsset);
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
