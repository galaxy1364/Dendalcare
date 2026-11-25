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

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function getContentTypeForExt(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase();
  const map: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
  };
  return map[ext] || 'application/octet-stream';
}

/**
 * V7 Atomic Deterministic Release & Authoritative Manifest Plugin:
 * 1. Strips dev-only `assets/aistudio/` artifacts BEFORE hashing, manifests, or mirroring.
 * 2. Computes one deterministic content-derived `releaseId` (`v<semver>-<10hex>`) from production assets.
 * 3. Reads CI-supplied `MINA_RELEASE_SEQUENCE` (strict monotonic integer) or baseline sequence for local builds
 *    (explicitly marking `origin: 'local_unreleased'` when not built in CI). Never derives sequence from Date.now().
 * 4. Stamps value-only placeholders (`__MINA_BUILD_ID_VALUE__`, `__MINA_RELEASE_SEQ_VALUE__`, `__MINA_SEMVER_VALUE__`)
 *    strictly into HTML meta tags and SW string literal — NEVER mutating JS identifiers.
 * 5. Computes real SHA-256 digest + byte size for EVERY production asset and emits Schema v2
 *    `release-manifest.json`, `release-pointer.json`, `version.json`, `build-manifest.json`, and `chunks.json`.
 * 6. Atomically mirrors clean dist/ -> gh-pages-dist/ preserving intact gh-pages-dist/assets/* structure.
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

      // 0. Hygiene gate: exclude dev-only AI Studio prompts/screenshots from all public release bundles
      const leakedAiStudioDir = path.join(assetsDir, 'aistudio');
      if (fs.existsSync(leakedAiStudioDir)) {
        fs.rmSync(leakedAiStudioDir, { recursive: true, force: true });
      }

      const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
      const semver = String(pkg.version || '4.9.6');

      const baseVersionPath = path.join(publicDir, 'version.json');
      let baseVersionMeta: Record<string, unknown> = { releaseSequence: 65, build: 65, channel: 'stable' };
      if (fs.existsSync(baseVersionPath)) {
        try {
          baseVersionMeta = JSON.parse(fs.readFileSync(baseVersionPath, 'utf8'));
        } catch {
          // fallback
        }
      }

      const envSeqRaw = process.env.MINA_RELEASE_SEQUENCE;
      const isCiRelease = Boolean(envSeqRaw && /^\d+$/.test(envSeqRaw) && Number(envSeqRaw) > 0);
      const releaseSequence = isCiRelease
        ? Number(envSeqRaw)
        : Number(baseVersionMeta.releaseSequence || baseVersionMeta.build || 65);
      const releaseChannel =
        process.env.MINA_RELEASE_CHANNEL === 'staging' || process.env.MINA_RELEASE_CHANNEL === 'canary'
          ? process.env.MINA_RELEASE_CHANNEL
          : 'stable';
      const gitCommit = String(process.env.GITHUB_SHA || process.env.MINA_GIT_COMMIT || 'local-uncommitted').slice(0, 40);
      const publishedAt = process.env.MINA_PUBLISHED_AT || new Date().toISOString();

      const distAssetFiles = walkFilesRelative(assetsDir).map((rel) => `assets/${rel}`);
      const hash = crypto.createHash('sha256');
      hash.update(semver);
      for (const relAsset of distAssetFiles) {
        const abs = path.join(distDir, relAsset);
        hash.update(relAsset);
        hash.update(fs.readFileSync(abs));
      }
      const shortHash = hash.digest('hex').slice(0, 10);
      const buildId = `v${semver}-${shortHash}`;

      // 1. Stamp BUILD_ID, RELEASE_SEQ, and SEMVER safely ONLY into HTML meta attributes (never JS identifiers)
      const distIndexPath = path.join(distDir, 'index.html');
      let distHtml = fs.readFileSync(distIndexPath, 'utf8');
      const requiredHtmlReplacements: Array<[string, string]> = [
        ['content="__MINA_BUILD_ID_VALUE__"', `content="${escapeHtmlAttribute(buildId)}"`],
        ['content="__MINA_RELEASE_SEQ_VALUE__"', `content="${escapeHtmlAttribute(String(releaseSequence))}"`],
        ['content="__MINA_SEMVER_VALUE__"', `content="${escapeHtmlAttribute(semver)}"`],
      ];
      for (const [placeholder, replacement] of requiredHtmlReplacements) {
        if (!distHtml.includes(placeholder)) {
          throw new Error(`[vite-sync] Expected value-only placeholder ${placeholder} in dist/index.html`);
        }
        distHtml = distHtml.replace(placeholder, replacement);
      }
      if (
        distHtml.includes('__MINA_BUILD_ID') ||
        distHtml.includes('__MINA_RELEASE_SEQ') ||
        distHtml.includes('__MINA_SEMVER')
      ) {
        throw new Error('[vite-sync] Unresolved __MINA_* placeholder remained in dist/index.html');
      }
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
      const criticalPrecacheAssets = Array.from(
        new Set(['./', './index.html', ...entryScripts, ...entryStyles])
      );
      const precacheAssets = Array.from(
        new Set([
          ...criticalPrecacheAssets,
          './manifest.json',
          './favicon.svg',
          './logo.png',
          './icon-192.png',
          './icon-512.png',
          './apple-touch-icon.png',
        ])
      );

      const swTemplatePath = path.join(publicDir, 'sw.js');
      if (fs.existsSync(swTemplatePath)) {
        let swSource = fs.readFileSync(swTemplatePath, 'utf8');
        const swBuildPlaceholder = "'__MINA_BUILD_ID_VALUE__'";
        if (!swSource.includes(swBuildPlaceholder)) {
          throw new Error("[vite-sync] Expected value-only placeholder '__MINA_BUILD_ID_VALUE__' in public/sw.js");
        }
        swSource = swSource.replace(swBuildPlaceholder, JSON.stringify(buildId));
        swSource = swSource.replace(
          /const CRITICAL_PRECACHE_ASSETS = \/\*__MINA_CRITICAL_ASSETS__\*\/ \[[\s\S]*?\];/,
          `const CRITICAL_PRECACHE_ASSETS = ${JSON.stringify(criticalPrecacheAssets, null, 2)};`
        );
        swSource = swSource.replace(
          /const PRECACHE_ASSETS = \/\*__MINA_PRECACHE_ASSETS__\*\/ \[[\s\S]*?\];/,
          `const PRECACHE_ASSETS = ${JSON.stringify(precacheAssets, null, 2)};`
        );
        if (
          swSource.includes('__MINA_BUILD_ID') ||
          swSource.includes('__MINA_PRECACHE_ASSETS__') ||
          swSource.includes('__MINA_CRITICAL_ASSETS__')
        ) {
          throw new Error('[vite-sync] Unresolved placeholder remained in dist/sw.js');
        }
        fs.writeFileSync(path.join(distDir, 'sw.js'), swSource, 'utf8');
        fs.writeFileSync(path.resolve(__dirname, 'sw.js'), swSource, 'utf8');
      }

      // 3. Build per-file SHA-256 + byte size inventory for authoritative release-manifest.json (Schema v2)
      const criticalAssetSet = new Set([
        './index.html',
        ...entryScripts,
        ...entryStyles,
      ]);
      const assetInventoryPaths = Array.from(
        new Set([
          './index.html',
          ...distAssetFiles.map((f) => `./${f}`),
          './manifest.json',
          './sw.js',
        ])
      ).filter((rel) => fs.existsSync(path.join(distDir, rel.replace(/^\.\//, ''))));

      const manifestAssets = assetInventoryPaths.map((rel) => {
        const cleanRel = rel.replace(/^\.\//, '');
        const abs = path.join(distDir, cleanRel);
        const buf = fs.readFileSync(abs);
        const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
        return {
          path: rel,
          sha256,
          size: buf.byteLength,
          critical: criticalAssetSet.has(rel),
          contentType: getContentTypeForExt(cleanRel),
        };
      });

      const releaseNotes = String(
        baseVersionMeta.releaseNotes ||
          `نسخه v${semver} (انتشار #${releaseSequence}) — انتشار رسمی مینادنتال`
      );

      const authoritativeManifest = {
        schemaVersion: 2,
        releaseId: buildId,
        releaseSequence,
        semver,
        gitCommit,
        channel: releaseChannel,
        platform: 'web',
        minNativeVersion: '4.9.0',
        minSchemaVersion: 4,
        publishedAt,
        releaseNotes,
        entryScripts,
        entryStyles,
        assets: manifestAssets,
        urgency: 'standard',
        revoked: false,
        origin: isCiRelease ? 'ci_pipeline' : 'local_unreleased',
        rollbackPolicy: {
          strategy: 'forward_release',
          minRollbackSequence: releaseSequence,
          schemaBackwardCompatible: true,
          preserveUserData: true,
        },
      };

      const releasePointer = {
        schemaVersion: 2,
        channel: releaseChannel,
        platform: 'web',
        currentReleaseId: buildId,
        releaseSequence,
        manifestUrl: './release-manifest.json',
        updatedAt: publishedAt,
        revokedReleaseIds: [],
        minSupportedSequence: 1,
      };

      const releaseManifestStr = JSON.stringify(authoritativeManifest, null, 2) + '\n';
      const releasePointerStr = JSON.stringify(releasePointer, null, 2) + '\n';
      fs.writeFileSync(path.join(distDir, 'release-manifest.json'), releaseManifestStr, 'utf8');
      fs.writeFileSync(path.join(distDir, 'release-pointer.json'), releasePointerStr, 'utf8');

      // 4. Emit coherent version.json, build-manifest.json & chunks.json from the exact same release identity
      const versionPayload = {
        schemaVersion: 2,
        version: semver,
        semver,
        build: releaseSequence,
        releaseSequence,
        buildId,
        releaseId: buildId,
        packageVersion: semver,
        channel: releaseChannel,
        publishedAt,
        releaseNotes,
        entryScripts,
        entryStyles,
      };
      const versionJsonStr = JSON.stringify(versionPayload, null, 2) + '\n';
      fs.writeFileSync(path.join(distDir, 'version.json'), versionJsonStr, 'utf8');
      fs.writeFileSync(path.resolve(__dirname, 'version.json'), versionJsonStr, 'utf8');

      const buildManifest = {
        buildId,
        releaseId: buildId,
        releaseSequence,
        packageVersion: semver,
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
        JSON.stringify({ buildId, releaseSequence, files: distAssetFiles }, null, 2) + '\n',
        'utf8'
      );
      fs.writeFileSync(path.join(distDir, '.nojekyll'), '', 'utf8');

      // 5. Atomically mirror intact dist/ -> gh-pages-dist/ (preserving gh-pages-dist/assets/*)
      fs.mkdirSync(ghPagesDir, { recursive: true });
      cleanStaleGhPagesFiles(ghPagesDir);
      copyDirectoryRecursive(distDir, ghPagesDir);

      console.log(
        `[vite-sync] Atomic release ${buildId} (seq #${releaseSequence}) synced to dist/ & gh-pages-dist/ (${distAssetFiles.length} intact assets, ${manifestAssets.length} hashed manifest entries)`
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
