import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRESERVED_BINARY_FILES = new Set([
  'DentalCare.apk',
  'DentalCare.mobileconfig',
  'MinaDental-iOS.mobileconfig',
]);

function walkFilesRelative(dir: string, baseDir = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFilesRelative(fullPath, baseDir));
    } else if (entry.isFile()) {
      results.push(path.relative(baseDir, fullPath).split(path.sep).join('/'));
    }
  }
  return results.sort();
}

function copyDirectoryRecursive(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function cleanStaleGhPagesFiles(ghPagesDir: string): void {
  if (!fs.existsSync(ghPagesDir)) return;
  for (const entry of fs.readdirSync(ghPagesDir, { withFileTypes: true })) {
    if (PRESERVED_BINARY_FILES.has(entry.name)) continue;
    const fullPath = path.join(ghPagesDir, entry.name);
    if (entry.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else if (entry.isFile()) {
      fs.unlinkSync(fullPath);
    }
  }
}

/**
 * V5 P0-01 & P0-03 Atomic Deterministic Deployment Plugin:
 * 1. Computes one deterministic content-derived BUILD_ID from all emitted Vite assets.
 * 2. Stamps that exact BUILD_ID into dist/index.html, dist/sw.js (with real precache entry assets),
 *    dist/version.json, and dist/build-manifest.json.
 * 3. Atomically mirrors dist/ -> gh-pages-dist/ preserving intact gh-pages-dist/assets/* structure
 *    (eliminating the broken flattened-root vs ./assets/* 404 mismatch permanently).
 * 4. Synchronizes root sw.js & version.json from the same deterministic build output so zero
 *    conflicting Service Worker copies can drift.
 */
function syncDeterministicReleasePlugin(): Plugin {
  return {
    name: 'minadental-deterministic-release-sync',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      const assetsDir = path.join(distDir, 'assets');
      const ghPagesDir = path.resolve(__dirname, 'gh-pages-dist');
      const publicDir = path.resolve(__dirname, 'public');

      if (!fs.existsSync(distDir) || !fs.existsSync(assetsDir)) return;

      const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
      const pkgVersion = String(pkg.version || '5.0.0');

      const distAssetFiles = walkFilesRelative(assetsDir).map((rel) => `assets/${rel}`);
      const hash = crypto.createHash('sha256');
      hash.update(pkgVersion);
      for (const relAsset of distAssetFiles) {
        const abs = path.join(distDir, relAsset);
        hash.update(relAsset);
        hash.update(fs.readFileSync(abs));
      }
      const shortHash = hash.digest('hex').slice(0, 10);
      const buildId = `v${pkgVersion}-${shortHash}`;

      // 1. Stamp BUILD_ID into dist/index.html & extract entry script/css paths
      const distIndexPath = path.join(distDir, 'index.html');
      let distHtml = fs.readFileSync(distIndexPath, 'utf8');
      distHtml = distHtml.replaceAll('__MINA_BUILD_ID__', buildId);
      fs.writeFileSync(distIndexPath, distHtml, 'utf8');

      const entryScripts = Array.from(
        distHtml.matchAll(/<script[^>]+src="(\.\/assets\/[^"]+\.js)"/g),
        (m) => m[1]
      );
      const entryStyles = Array.from(
        distHtml.matchAll(/<link[^>]+href="(\.\/assets\/[^"]+\.css)"/g),
        (m) => m[1]
      );

      // 2. Generate unified dist/sw.js from public/sw.js template with exact BUILD_ID & entry assets
      const precacheAssets = Array.from(
        new Set([
          './',
          './index.html',
          './manifest.json',
          './favicon.svg',
          './logo.png',
          './icon-192.png',
          './icon-512.png',
          './apple-touch-icon.png',
          ...entryScripts,
          ...entryStyles,
        ])
      );

      const swTemplatePath = path.join(publicDir, 'sw.js');
      if (fs.existsSync(swTemplatePath)) {
        let swSource = fs.readFileSync(swTemplatePath, 'utf8');
        swSource = swSource.replaceAll('__MINA_BUILD_ID__', buildId);
        swSource = swSource.replace(
          /const PRECACHE_ASSETS = \/\*__MINA_PRECACHE_ASSETS__\*\/ \[[\s\S]*?\];/,
          `const PRECACHE_ASSETS = ${JSON.stringify(precacheAssets, null, 2)};`
        );
        fs.writeFileSync(path.join(distDir, 'sw.js'), swSource, 'utf8');
        // Keep root sw.js synchronized with the single built Service Worker
        fs.writeFileSync(path.resolve(__dirname, 'sw.js'), swSource, 'utf8');
      }

      // 3. Emit coherent version.json, build-manifest.json & chunks.json from the same BUILD_ID
      const baseVersionPath = path.join(publicDir, 'version.json');
      let existingVersion: Record<string, unknown> = { version: '65.0', build: 65 };
      if (fs.existsSync(baseVersionPath)) {
        try {
          existingVersion = JSON.parse(fs.readFileSync(baseVersionPath, 'utf8'));
        } catch {
          // fallback
        }
      }
      const versionPayload = {
        ...existingVersion,
        buildId,
        packageVersion: pkgVersion,
        entryScripts,
        entryStyles,
      };
      const versionJsonStr = JSON.stringify(versionPayload, null, 2) + '\n';
      fs.writeFileSync(path.join(distDir, 'version.json'), versionJsonStr, 'utf8');
      fs.writeFileSync(path.resolve(__dirname, 'version.json'), versionJsonStr, 'utf8');

      const buildManifest = {
        buildId,
        packageVersion: pkgVersion,
        entryScripts,
        entryStyles,
        assets: distAssetFiles,
        files: walkFilesRelative(distDir),
      };
      fs.writeFileSync(
        path.join(distDir, 'build-manifest.json'),
        JSON.stringify(buildManifest, null, 2) + '\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(distDir, 'chunks.json'),
        JSON.stringify({ buildId, files: distAssetFiles }, null, 2) + '\n',
        'utf8'
      );
      fs.writeFileSync(path.join(distDir, '.nojekyll'), '', 'utf8');

      // 4. Atomically mirror intact dist/ -> gh-pages-dist/ (preserving gh-pages-dist/assets/*)
      fs.mkdirSync(ghPagesDir, { recursive: true });
      cleanStaleGhPagesFiles(ghPagesDir);
      copyDirectoryRecursive(distDir, ghPagesDir);

      console.log(
        `[vite-sync] Atomic release ${buildId} synced to dist/ & gh-pages-dist/ (${distAssetFiles.length} intact assets)`
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), syncDeterministicReleasePlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
});
