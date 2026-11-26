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

const MIN_NATIVE_VERSION = '4.9.0';
const MIN_SCHEMA_VERSION = 4;

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

function readAndroidGradleBaseline(): {
  versionName: string | null;
  versionCode: number | null;
} {
  const gradlePath = path.resolve(__dirname, 'app/build.gradle.kts');
  if (!fs.existsSync(gradlePath)) {
    return { versionName: null, versionCode: null };
  }
  const raw = fs.readFileSync(gradlePath, 'utf8');
  const versionName = raw.match(/versionName\s*=\s*"([^"]+)"/)?.[1] || null;
  const parsedCode = Number(raw.match(/versionCode\s*=\s*(\d+)/)?.[1] || 0);
  return {
    versionName,
    versionCode: Number.isInteger(parsedCode) && parsedCode > 0 ? parsedCode : null,
  };
}

function resolveBuildIdentityInputs(): {
  semver: string;
  releaseSequence: number;
  isCiRelease: boolean;
  releaseChannel: 'stable' | 'staging' | 'canary';
  baseVersionMeta: Record<string, unknown>;
} {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
  const semver = String(pkg.version || '4.18.0');
  const androidBaseline = readAndroidGradleBaseline();
  if (androidBaseline.versionName && androidBaseline.versionName !== semver) {
    throw new Error(
      `[vite-sync] Web/Android versionName mismatch: package.json (${semver}) != app/build.gradle.kts (${androidBaseline.versionName})`
    );
  }

  const publicDir = path.resolve(__dirname, 'public');
  const baseVersionPath = path.join(publicDir, 'version.json');
  let baseVersionMeta: Record<string, unknown> = {
    releaseSequence: androidBaseline.versionCode ?? 224,
    build: androidBaseline.versionCode ?? 224,
    channel: 'stable',
  };
  if (fs.existsSync(baseVersionPath)) {
    try {
      baseVersionMeta = JSON.parse(fs.readFileSync(baseVersionPath, 'utf8'));
    } catch {
      // fallback to baseline
    }
  }

  const envSeqRaw = (process.env.MINA_RELEASE_SEQUENCE || '').trim();
  const isCiRelease = Boolean(envSeqRaw && /^\d+$/.test(envSeqRaw) && Number(envSeqRaw) > 0);
  const releaseSequence = isCiRelease
    ? Number(envSeqRaw)
    : Number(baseVersionMeta.releaseSequence || baseVersionMeta.build || androidBaseline.versionCode || 224);
  if (androidBaseline.versionCode && releaseSequence < androidBaseline.versionCode) {
    throw new Error(
      `[vite-sync] Monotonic sequence drift: Web releaseSequence (#${releaseSequence}) < Android baseline versionCode (#${androidBaseline.versionCode})`
    );
  }
  const releaseChannel: 'stable' | 'staging' | 'canary' =
    process.env.MINA_RELEASE_CHANNEL === 'staging' || process.env.MINA_RELEASE_CHANNEL === 'canary'
      ? process.env.MINA_RELEASE_CHANNEL
      : 'stable';

  return { semver, releaseSequence, isCiRelease, releaseChannel, baseVersionMeta };
}

function canonicalManifestPayloadForSigning(manifest: Record<string, unknown>): string {
  const { signature: _omit, ...rest } = manifest;
  const sortKeysDeep = (val: unknown): unknown => {
    if (Array.isArray(val)) return val.map(sortKeysDeep);
    if (val && typeof val === 'object') {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        const v = (val as Record<string, unknown>)[k];
        if (v !== undefined) sorted[k] = sortKeysDeep(v);
      }
      return sorted;
    }
    return val;
  };
  return JSON.stringify(sortKeysDeep(rest));
}

function maybeSignManifestInCi(manifest: Record<string, unknown>): Record<string, unknown> {
  const privateJwkRaw = (process.env.MINA_SIGNING_PRIVATE_KEY_JWK || '').trim();
  const keyId = (process.env.MINA_SIGNING_KEY_ID || '').trim();
  if (!privateJwkRaw || !keyId) {
    return manifest;
  }

  const parsedJwk = JSON.parse(privateJwkRaw) as crypto.JsonWebKey;
  const privateKey = crypto.createPrivateKey({ key: parsedJwk, format: 'jwk' });
  const unsigned = { ...manifest, keyId };
  const payload = canonicalManifestPayloadForSigning(unsigned);
  // IEEE P1363 raw (r || s) matches Web Crypto SubtleCrypto ECDSA verify() format
  const sigBuf = crypto.sign('sha256', Buffer.from(payload, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return {
    ...unsigned,
    signature: sigBuf.toString('base64'),
  };
}

/**
 * V8 Atomic Deterministic Release & Authoritative Manifest Plugin:
 * 1. Strips dev-only `assets/aistudio/` artifacts BEFORE hashing, manifests, or mirroring.
 * 2. Computes full 64-hex SHA-256 `contentDigest` across canonical `assets/*`, pre-stamp `index.html`,
 *    pre-stamp `public/sw.js`, `manifest.json`, and compatibility metadata (zero self-reference).
 * 3. Derives deterministic `releaseId` (`v<semver>-<10hex>`) from `contentDigest`.
 * 4. Stamps value-only placeholders strictly into HTML meta tags and SW string literal — NEVER mutating JS identifiers.
 * 5. Emits COMPLETE immutable versioned release files under `dist/releases/<releaseId>/`
 *    (`index.html`, `assets/*`, `manifest.json`, `sw.js`, `release-manifest.json`), plus root copies and
 *    platform-specific pointers (`release-pointer.json`, `android-release-pointer.json`, `ios-release-pointer.json`).
 * 6. Optionally signs the manifest with ECDSA P-256 when CI signing env vars are provided (never stored in repo).
 * 7. Atomically mirrors clean dist/ -> gh-pages-dist/ preserving intact gh-pages-dist/assets/* structure.
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

      const { semver, releaseSequence, isCiRelease, releaseChannel, baseVersionMeta } =
        resolveBuildIdentityInputs();

      const gitCommit = String(
        process.env.GITHUB_SHA || process.env.MINA_GIT_COMMIT || 'local-uncommitted'
      ).slice(0, 40);
      const publishedAt = process.env.MINA_PUBLISHED_AT || new Date().toISOString();
      const ttlDays = Number(process.env.MINA_MANIFEST_TTL_DAYS || 365);
      const expiresAt = Number.isFinite(ttlDays) && ttlDays > 0
        ? new Date(Date.parse(publishedAt) + ttlDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined;

      // 0b. GE-0007 P0-PWA: Never let Vite hash manifest.json into dist/assets/manifest-*.json,
      // because relative start_url ("./"), scope ("./"), and icon paths ("./icon-192.png") would
      // resolve under /assets/ (404 icons + out-of-scope page -> Chrome "This app cannot be installed").
      const distIndexPath = path.join(distDir, 'index.html');
      let rawBuiltHtml = fs.readFileSync(distIndexPath, 'utf8');
      rawBuiltHtml = rawBuiltHtml.replace(
        /<link\b[^>]*rel=["']manifest["'][^>]*>/i,
        '<link rel="manifest" href="./manifest.json" />'
      );
      fs.writeFileSync(distIndexPath, rawBuiltHtml, 'utf8');

      // Remove any duplicate hashed manifest-*.json emitted under dist/assets/
      for (const entry of fs.readdirSync(assetsDir)) {
        if (/^manifest-[A-Za-z0-9_-]+\.json$/i.test(entry)) {
          fs.unlinkSync(path.join(assetsDir, entry));
        }
      }

      // Guarantee authoritative public/manifest.json is copied to dist/manifest.json and root manifest.json
      const publicManifestPath = path.join(publicDir, 'manifest.json');
      const distManifestJsonPath = path.join(distDir, 'manifest.json');
      if (fs.existsSync(publicManifestPath)) {
        fs.copyFileSync(publicManifestPath, distManifestJsonPath);
        fs.copyFileSync(publicManifestPath, path.resolve(__dirname, 'manifest.json'));
      }

      const distAssetFiles = walkFilesRelative(assetsDir).map((rel) => `assets/${rel}`);
      const preStampHtml = fs.readFileSync(distIndexPath, 'utf8');
      const swTemplatePath = path.join(publicDir, 'sw.js');
      const preStampSw = fs.existsSync(swTemplatePath)
        ? fs.readFileSync(swTemplatePath, 'utf8')
        : '';
      const distManifestJsonBuf = fs.existsSync(distManifestJsonPath)
        ? fs.readFileSync(distManifestJsonPath)
        : Buffer.alloc(0);

      // Compute full 64-hex contentDigest over canonical assets + pre-stamp shell/SW/manifest + compat metadata
      const contentHash = crypto.createHash('sha256');
      contentHash.update(`semver:${semver}\n`);
      contentHash.update(`channel:${releaseChannel}\n`);
      contentHash.update(`minNative:${MIN_NATIVE_VERSION}\n`);
      contentHash.update(`minSchema:${MIN_SCHEMA_VERSION}\n`);
      contentHash.update('prestamp:index.html\n');
      contentHash.update(preStampHtml, 'utf8');
      contentHash.update('prestamp:sw.js\n');
      contentHash.update(preStampSw, 'utf8');
      contentHash.update('manifest.json\n');
      contentHash.update(distManifestJsonBuf);
      for (const relAsset of distAssetFiles) {
        const abs = path.join(distDir, relAsset);
        contentHash.update(`asset:${relAsset}\n`);
        contentHash.update(fs.readFileSync(abs));
      }
      const contentDigest = contentHash.digest('hex');
      const shortHash = contentDigest.slice(0, 10);
      const buildId = `v${semver}-${shortHash}`;

      // 1. Stamp BUILD_ID, RELEASE_SEQ, SEMVER, and CONTENT_DIGEST strictly into HTML meta attributes
      let distHtml = preStampHtml;
      const requiredHtmlReplacements: Array<[string, string]> = [
        ['content="__MINA_BUILD_ID_VALUE__"', `content="${escapeHtmlAttribute(buildId)}"`],
        ['content="__MINA_RELEASE_SEQ_VALUE__"', `content="${escapeHtmlAttribute(String(releaseSequence))}"`],
        ['content="__MINA_SEMVER_VALUE__"', `content="${escapeHtmlAttribute(semver)}"`],
        ['content="__MINA_CONTENT_DIGEST_VALUE__"', `content="${escapeHtmlAttribute(contentDigest)}"`],
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
        distHtml.includes('__MINA_SEMVER') ||
        distHtml.includes('__MINA_CONTENT_DIGEST')
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

      if (fs.existsSync(swTemplatePath)) {
        let swSource = preStampSw;
        const swBuildPlaceholder = "'__MINA_BUILD_ID_VALUE__'";
        if (!swSource.includes(swBuildPlaceholder)) {
          throw new Error("[vite-sync] Expected value-only placeholder '__MINA_BUILD_ID_VALUE__' in public/sw.js");
        }
        swSource = swSource.replace(swBuildPlaceholder, JSON.stringify(buildId));
        const swSeqPlaceholder = "'__MINA_RELEASE_SEQ_VALUE__'";
        if (swSource.includes(swSeqPlaceholder)) {
          swSource = swSource.replace(swSeqPlaceholder, JSON.stringify(String(releaseSequence)));
        }
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
          swSource.includes('__MINA_RELEASE_SEQ') ||
          swSource.includes('__MINA_PRECACHE_ASSETS__') ||
          swSource.includes('__MINA_CRITICAL_ASSETS__')
        ) {
          throw new Error('[vite-sync] Unresolved placeholder remained in dist/sw.js');
        }
        fs.writeFileSync(path.join(distDir, 'sw.js'), swSource, 'utf8');
        fs.writeFileSync(path.resolve(__dirname, 'sw.js'), swSource, 'utf8');
      }

      // 3. Build per-file SHA-256 + byte size inventory for authoritative release-manifest.json (Schema v2)
      const distFontsDir = path.join(distDir, 'fonts');
      const distFontFiles = fs.existsSync(distFontsDir)
        ? walkFilesRelative(distFontsDir).map((rel) => `fonts/${rel}`)
        : [];
      const criticalAssetSet = new Set([
        './index.html',
        ...entryScripts,
        ...entryStyles,
      ]);
      const assetInventoryPaths = Array.from(
        new Set([
          './index.html',
          ...distAssetFiles.map((f) => `./${f}`),
          ...distFontFiles.map((f) => `./${f}`),
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

      const unsignedManifest: Record<string, unknown> = {
        schemaVersion: 2,
        releaseId: buildId,
        releaseSequence,
        semver,
        gitCommit,
        channel: releaseChannel,
        platform: 'web',
        minNativeVersion: MIN_NATIVE_VERSION,
        minSchemaVersion: MIN_SCHEMA_VERSION,
        publishedAt,
        ...(expiresAt ? { expiresAt } : {}),
        contentDigest,
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

      const authoritativeManifest = maybeSignManifestInCi(unsignedManifest);
      const releaseManifestStr = JSON.stringify(authoritativeManifest, null, 2) + '\n';

      // Emit GitHub Pages SPA 404.html from the exact same built index.html artifact
      fs.copyFileSync(distIndexPath, path.join(distDir, '404.html'));

      // 4. Stage COMPLETE immutable release directory at dist/releases/<releaseId>/
      //    so versioned manifestUrl resolves ALL relative assets & fonts cleanly and supports retention/rollback!
      const versionedReleaseDir = path.join(distDir, 'releases', buildId);
      fs.mkdirSync(path.join(versionedReleaseDir, 'assets'), { recursive: true });
      fs.copyFileSync(distIndexPath, path.join(versionedReleaseDir, 'index.html'));
      fs.copyFileSync(distIndexPath, path.join(versionedReleaseDir, '404.html'));
      if (fs.existsSync(distManifestJsonPath)) {
        fs.copyFileSync(distManifestJsonPath, path.join(versionedReleaseDir, 'manifest.json'));
      }
      if (fs.existsSync(path.join(distDir, 'sw.js'))) {
        fs.copyFileSync(path.join(distDir, 'sw.js'), path.join(versionedReleaseDir, 'sw.js'));
      }
      copyDirectoryRecursive(assetsDir, path.join(versionedReleaseDir, 'assets'));
      if (fs.existsSync(distFontsDir)) {
        copyDirectoryRecursive(distFontsDir, path.join(versionedReleaseDir, 'fonts'));
      }
      fs.writeFileSync(
        path.join(versionedReleaseDir, 'release-manifest.json'),
        releaseManifestStr,
        'utf8'
      );

      // Write root convenience copy + atomic release pointers (web + android + ios)
      fs.writeFileSync(path.join(distDir, 'release-manifest.json'), releaseManifestStr, 'utf8');

      const versionedManifestRelUrl = `./releases/${buildId}/release-manifest.json`;
      const webPointer = {
        schemaVersion: 2,
        channel: releaseChannel,
        platform: 'web',
        currentReleaseId: buildId,
        releaseSequence,
        manifestUrl: versionedManifestRelUrl,
        updatedAt: publishedAt,
        revokedReleaseIds: [],
        minSupportedSequence: 1,
      };
      fs.writeFileSync(
        path.join(distDir, 'release-pointer.json'),
        JSON.stringify(webPointer, null, 2) + '\n',
        'utf8'
      );

      const androidPointer = {
        schemaVersion: 2,
        channel: releaseChannel,
        platform: 'android',
        currentReleaseId: buildId,
        releaseSequence,
        androidVersionCode: releaseSequence,
        androidVersionName: semver,
        manifestUrl: versionedManifestRelUrl,
        updatedAt: publishedAt,
        revokedReleaseIds: [],
        minSupportedSequence: 1,
        storeUrl: (process.env.VITE_ANDROID_PLAY_STORE_URL || '').trim() || null,
      };
      fs.writeFileSync(
        path.join(distDir, 'android-release-pointer.json'),
        JSON.stringify(androidPointer, null, 2) + '\n',
        'utf8'
      );

      const iosPointer = {
        schemaVersion: 2,
        channel: releaseChannel,
        platform: 'ios',
        currentReleaseId: buildId,
        releaseSequence,
        manifestUrl: versionedManifestRelUrl,
        updatedAt: publishedAt,
        revokedReleaseIds: [],
        minSupportedSequence: 1,
        storeUrl: (process.env.VITE_IOS_APP_STORE_URL || '').trim() || null,
      };
      fs.writeFileSync(
        path.join(distDir, 'ios-release-pointer.json'),
        JSON.stringify(iosPointer, null, 2) + '\n',
        'utf8'
      );

      // 5. Emit coherent version.json, build-manifest.json & chunks.json from the exact same release identity
      const versionPayload = {
        schemaVersion: 2,
        version: semver,
        semver,
        build: releaseSequence,
        releaseSequence,
        androidVersionCode: releaseSequence,
        androidVersionName: semver,
        buildId,
        releaseId: buildId,
        contentDigest,
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
        contentDigest,
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
        JSON.stringify({ buildId, releaseSequence, contentDigest, files: distAssetFiles }, null, 2) + '\n',
        'utf8'
      );
      fs.writeFileSync(path.join(distDir, '.nojekyll'), '', 'utf8');

      // 6. Atomically mirror intact dist/ -> gh-pages-dist/ (preserving gh-pages-dist/assets/* & releases/*)
      fs.mkdirSync(ghPagesDir, { recursive: true });
      cleanStaleGhPagesFiles(ghPagesDir);
      copyDirectoryRecursive(distDir, ghPagesDir);

      // 7. Atomically sync Android WebView bundled assets when app/src/main/assets exists (keeps CI & local verify:assets 100% coherent)
      const androidAssetsParent = path.resolve(__dirname, 'app/src/main/assets');
      if (fs.existsSync(androidAssetsParent)) {
        const androidWwwDir = path.join(androidAssetsParent, 'www');
        fs.rmSync(androidWwwDir, { recursive: true, force: true });
        copyDirectoryRecursive(distDir, androidWwwDir);
      }

      console.log(
        `[vite-sync] Atomic V9 release ${buildId} (seq #${releaseSequence}, digest=${contentDigest.slice(0, 12)}..., origin=${authoritativeManifest.origin}) synced to dist/, gh-pages-dist/ & android-www (${distAssetFiles.length} assets, ${manifestAssets.length} hashed manifest entries, immutable releases/${buildId}/ staged)`
      );
    },
  };
}

const embeddedIdentity = resolveBuildIdentityInputs();

export default defineConfig({
  base: './',
  define: {
    __MINA_EMBEDDED_SEMVER__: JSON.stringify(embeddedIdentity.semver),
    __MINA_EMBEDDED_SEQUENCE__: JSON.stringify(embeddedIdentity.releaseSequence),
    __MINA_EMBEDDED_CHANNEL__: JSON.stringify(embeddedIdentity.releaseChannel),
    __MINA_EMBEDDED_SCHEMA_VERSION__: JSON.stringify(MIN_SCHEMA_VERSION),
  },
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
