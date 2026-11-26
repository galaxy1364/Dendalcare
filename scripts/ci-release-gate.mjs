#!/usr/bin/env node
/**
 * MinaDental V8 CI Release Assurance Gate
 *
 * Provides deterministic, shell-injection-safe release pipeline gates:
 * 1. --compute-sequence: Strictly parses integer release sequence and checks remote pointer monotonicity.
 * 2. --verify-local <distDir> [--require-ci-origin]: Verifies built dist/ HTML, meta tags, pointers,
 *    complete immutable releases/<releaseId>/ directory, and SHA-256 + byte sizes of every asset.
 * 3. --compare <distDirA> <distDirB>: Double-build determinism proof (identical releaseId, contentDigest, assets).
 * 4. --verify-remote <baseUrl> [--expected-release-id <id>]: Real live HTTP(S) post-deploy health gate
 *    checking index.html (no raw src/main.tsx!), pointers, versioned manifest, sw.js, MIME types, sizes, and SHA-256.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const BUILD_ID_RE = /^v\d+\.\d+\.\d+-[0-9a-f]{10}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

export function parseStrictPositiveInt(raw, label = 'MINA_RELEASE_SEQUENCE') {
  const trimmed = String(raw ?? '').trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be a strict positive integer, got: ${JSON.stringify(trimmed)}`);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a safe positive integer, got: ${parsed}`);
  }
  return parsed;
}

export async function computeMonotonicSequence(options = {}) {
  const baseSeq = parseStrictPositiveInt(options.baseSequence ?? 224, 'baseSequence');
  const runNumber = options.runNumber ? parseStrictPositiveInt(options.runNumber, 'GITHUB_RUN_NUMBER') : 1;
  const overrideRaw = String(options.overrideInput ?? '').trim();
  const requireRemotePointer = Boolean(options.requireRemotePointer);
  const bootstrapFirstRelease = Boolean(options.bootstrapFirstRelease);
  const allowLegacyRootMigration = Boolean(options.allowLegacyRootMigration);
  let remoteSequence = 0;
  let remoteError = null;
  let pointerStatus = null;
  let bootstrapped = false;

  // Bound both connection and body reads; never interpret a network/5xx error as first deployment.
  const fetchFresh = (url) => fetch(url, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });

  if (options.remotePointerUrl) {
    try {
      const res = await fetchFresh(options.remotePointerUrl);
      pointerStatus = res.status;
      if (res.ok) {
        const ct = String(res.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('json')) {
          remoteError = 'Remote pointer did not return JSON';
        } else {
          const pointer = await res.json();
          if (typeof pointer?.releaseSequence === 'number' &&
              Number.isSafeInteger(pointer.releaseSequence) && pointer.releaseSequence > 0) {
            remoteSequence = pointer.releaseSequence;
          } else {
            remoteError = 'Remote pointer missing valid positive releaseSequence';
          }
        }
      } else {
        remoteError = `Remote pointer returned HTTP ${res.status}`;
      }
    } catch (err) {
      remoteError = `Remote pointer unreachable: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else if (requireRemotePointer) {
    remoteError = 'Remote pointer URL required when --require-remote-pointer is set';
  }

  // A 404 alone is NOT evidence of a first release. Inspect the live root independently.
  // The automatic migration is restricted to a real raw TS/TSX entry script; do not match
  // error messages or strings embedded in a production HTML document.
  if (requireRemotePointer && remoteSequence <= 0 && pointerStatus === 404 &&
      (bootstrapFirstRelease || allowLegacyRootMigration)) {
    try {
      const rootUrl = new URL('./', options.remotePointerUrl);
      const rootRes = await fetchFresh(rootUrl);
      const ct = String(rootRes.headers.get('content-type') || '').toLowerCase();
      const html = rootRes.ok && ct.includes('text/html') ? await rootRes.text() : '';
      const rawEntry = /<script\b[^>]*\bsrc\s*=\s*["'](?:\.\/|\/)?(?:[^"'<>]*\/)?src\/main\.(?:tsx|ts)["'][^>]*>/i.test(html);
      const productionIdentity = /<meta\b[^>]*\bname=["']minadental-build-id["'][^>]*\bcontent=["']v\d+\.\d+\.\d+-[a-f0-9]{10}["']/i.test(html);
      if ((rawEntry && !productionIdentity) || (bootstrapFirstRelease && rootRes.status === 404)) {
        bootstrapped = true;
      } else {
        remoteError = `Pointer is 404 but root is not a verified legacy raw entry or explicitly authorized empty site (HTTP ${rootRes.status})`;
      }
    } catch (err) {
      remoteError = `First-release root verification failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  if (requireRemotePointer && remoteSequence <= 0 && !bootstrapped) {
    throw new Error(
      `Fail-closed monotonic sequence guard: cannot safely increment release sequence (${remoteError || 'unknown reason'}). Bootstrap requires a confirmed 404 pointer and a verified legacy root, or an explicitly authorized empty site.`
    );
  }

  const floor = Math.max(baseSeq, remoteSequence);
  let candidate;
  if (overrideRaw) {
    candidate = parseStrictPositiveInt(overrideRaw, 'release_sequence');
    if (candidate <= floor) {
      throw new Error(`Non-monotonic release_sequence override rejected: requested #${candidate} <= floor #${floor}`);
    }
  } else {
    candidate = Math.max(baseSeq + runNumber, floor + 1);
  }
  if (!Number.isSafeInteger(candidate)) throw new Error('Release sequence exceeds safe integer range');

  return { sequence: candidate, remoteSequence, usedOverride: Boolean(overrideRaw), bootstrapped };
}

function assertValidMime(pathname, contentType) {
  const lowerPath = String(pathname || '').toLowerCase();
  const ct = String(contentType || '').toLowerCase();
  if (lowerPath.endsWith('.js') || lowerPath.endsWith('.mjs')) {
    assert.ok(ct.includes('javascript'), `Invalid JS MIME for ${pathname}: ${ct}`);
    assert.ok(!ct.includes('text/html'), `HTML MIME returned for JS asset ${pathname}`);
  } else if (lowerPath.endsWith('.css')) {
    assert.ok(ct.includes('text/css'), `Invalid CSS MIME for ${pathname}: ${ct}`);
  } else if (lowerPath.endsWith('.json') || lowerPath.endsWith('.webmanifest')) {
    assert.ok(ct.includes('json'), `Invalid JSON MIME for ${pathname}: ${ct}`);
  } else if (lowerPath.endsWith('.woff2')) {
    assert.ok(!ct.includes('text/html'), `HTML MIME returned for WOFF2 font ${pathname}`);
  } else if (lowerPath.endsWith('.ttf') || lowerPath.endsWith('.woff')) {
    assert.ok(!ct.includes('text/html'), `HTML MIME returned for font ${pathname}`);
  } else if (lowerPath.endsWith('.html') || lowerPath.endsWith('/')) {
    assert.ok(ct.includes('text/html'), `Invalid HTML MIME for ${pathname}: ${ct}`);
  }
}

function assertValidFontMagicBytes(assetPath, buf, scopeLabel = 'release') {
  const lower = String(assetPath || '').toLowerCase();
  if (!lower.endsWith('.woff2') && !lower.endsWith('.woff') && !lower.endsWith('.ttf')) return;
  assert.ok(buf.byteLength >= 1024, `[${scopeLabel}] Font file too small (${buf.byteLength} bytes): ${assetPath}`);
  const magic = buf.subarray(0, 4).toString('hex');
  if (lower.endsWith('.woff2')) {
    assert.equal(magic, '774f4632', `[${scopeLabel}] Invalid WOFF2 magic bytes for ${assetPath}: ${magic}`);
  } else if (lower.endsWith('.woff')) {
    assert.equal(magic, '774f4646', `[${scopeLabel}] Invalid WOFF magic bytes for ${assetPath}: ${magic}`);
  } else if (lower.endsWith('.ttf')) {
    assert.ok(
      magic === '00010000' || magic === '4f54544f' || magic === '74727565',
      `[${scopeLabel}] Invalid TTF/OTF magic bytes for ${assetPath}: ${magic}`
    );
  }
}

export function verifyLocalReleaseDirectory(distDir, options = {}) {
  const absDist = path.resolve(distDir);
  assert.ok(fs.existsSync(absDist), `Release directory missing: ${absDist}`);

  const indexPath = path.join(absDist, 'index.html');
  assert.ok(fs.existsSync(indexPath), 'dist/index.html missing');
  const html = fs.readFileSync(indexPath, 'utf8');

  assert.ok(!html.includes('src/main.tsx'), 'Built index.html must NEVER reference raw src/main.tsx');
  assert.ok(!html.includes('__MINA_BUILD_ID'), 'Unresolved __MINA_BUILD_ID in dist/index.html');
  assert.ok(!html.includes('__MINA_RELEASE_SEQ'), 'Unresolved __MINA_RELEASE_SEQ in dist/index.html');
  assert.ok(!html.includes('__MINA_SEMVER'), 'Unresolved __MINA_SEMVER in dist/index.html');
  assert.ok(!html.includes('__MINA_CONTENT_DIGEST'), 'Unresolved __MINA_CONTENT_DIGEST in dist/index.html');

  const buildId = html.match(/<meta\s+name="minadental-build-id"\s+content="([^"]+)"/i)?.[1];
  const seqStr = html.match(/<meta\s+name="minadental-release-seq"\s+content="([^"]+)"/i)?.[1];
  const semver = html.match(/<meta\s+name="minadental-semver"\s+content="([^"]+)"/i)?.[1];
  const contentDigest = html.match(/<meta\s+name="minadental-content-digest"\s+content="([^"]+)"/i)?.[1];

  assert.ok(buildId && buildId !== 'dev-local' && BUILD_ID_RE.test(buildId), `Invalid minadental-build-id: ${buildId}`);
  const releaseSequence = parseStrictPositiveInt(seqStr, 'minadental-release-seq');
  assert.ok(semver && /^\d+\.\d+\.\d+$/.test(semver), `Invalid minadental-semver: ${semver}`);
  assert.ok(contentDigest && SHA256_RE.test(contentDigest), `Invalid minadental-content-digest: ${contentDigest}`);
  assert.equal(buildId, `v${semver}-${contentDigest.slice(0, 10)}`, 'buildId must derive from semver + contentDigest');

  // V9: Verify coherent 404.html exists in dist/ and matches dist/index.html
  const fallback404Path = path.join(absDist, '404.html');
  assert.ok(fs.existsSync(fallback404Path), 'dist/404.html missing');
  assert.equal(
    fs.readFileSync(fallback404Path, 'utf8'),
    html,
    'dist/404.html must match dist/index.html byte-for-byte'
  );

  // GE-0007 P0-PWA: Verify root ./manifest.json (NEVER Vite-hashed /assets/manifest-*.json) and 192/512 PNG icons
  const manifestTag = html.match(/<link\b[^>]*rel=["']manifest["'][^>]*>/i)?.[0] || '';
  const manifestHref = manifestTag.match(/\bhref=["']([^"']+)["']/i)?.[1] || '';
  assert.equal(
    manifestHref,
    './manifest.json',
    `CRITICAL PWA BUG: dist/index.html manifest href must be "./manifest.json", got ${JSON.stringify(manifestHref)}`
  );
  const localPwaManifestPath = path.join(absDist, 'manifest.json');
  assert.ok(fs.existsSync(localPwaManifestPath), 'dist/manifest.json missing');
  const pwaManifest = JSON.parse(fs.readFileSync(localPwaManifestPath, 'utf8'));
  assert.ok(pwaManifest.id && pwaManifest.start_url && pwaManifest.scope, 'dist/manifest.json missing id/start_url/scope');
  assert.ok(['standalone', 'fullscreen', 'minimal-ui'].includes(pwaManifest.display), `Invalid manifest display: ${pwaManifest.display}`);
  let hasLocal192 = false;
  let hasLocal512 = false;
  for (const icon of pwaManifest.icons || []) {
    const cleanIcon = String(icon.src || '').replace(/^\.\//, '');
    const iconFile = path.join(absDist, cleanIcon);
    assert.ok(fs.existsSync(iconFile), `dist/manifest.json icon missing on disk: ${cleanIcon}`);
    const iconBuf = fs.readFileSync(iconFile);
    assert.equal(iconBuf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `Manifest icon is not valid PNG: ${cleanIcon}`);
    const w = iconBuf.readUInt32BE(16);
    const h = iconBuf.readUInt32BE(20);
    if (w === 192 && h === 192) hasLocal192 = true;
    if (w === 512 && h === 512) hasLocal512 = true;
  }
  assert.ok(hasLocal192 && hasLocal512, 'dist/manifest.json must reference valid 192x192 and 512x512 PNG icons');

  // Verify web, android, and ios pointers exist and are coherent
  const pointerFiles = [
    ['release-pointer.json', 'web'],
    ['android-release-pointer.json', 'android'],
    ['ios-release-pointer.json', 'ios'],
  ];

  let webPointer = null;
  for (const [fileName, expectedPlatform] of pointerFiles) {
    const ptrPath = path.join(absDist, fileName);
    assert.ok(fs.existsSync(ptrPath), `Missing platform pointer: ${fileName}`);
    const ptr = JSON.parse(fs.readFileSync(ptrPath, 'utf8'));
    assert.equal(ptr.schemaVersion, 2, `${fileName} schemaVersion must be 2`);
    assert.equal(ptr.platform, expectedPlatform, `${fileName} platform mismatch`);
    assert.equal(ptr.currentReleaseId, buildId, `${fileName} currentReleaseId mismatch`);
    assert.equal(ptr.releaseSequence, releaseSequence, `${fileName} releaseSequence mismatch`);
    assert.equal(
      ptr.manifestUrl,
      `./releases/${buildId}/release-manifest.json`,
      `${fileName} must point to immutable versioned release manifest`
    );
    if (fileName === 'release-pointer.json') webPointer = ptr;
  }

  // Verify COMPLETE immutable release directory dist/releases/<releaseId>/
  const relDir = path.join(absDist, 'releases', buildId);
  const relManifestPath = path.join(relDir, 'release-manifest.json');
  assert.ok(fs.existsSync(relManifestPath), `Immutable release manifest missing: ${relManifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(relManifestPath, 'utf8'));
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.releaseId, buildId);
  assert.equal(manifest.releaseSequence, releaseSequence);
  assert.equal(manifest.semver, semver);
  assert.equal(manifest.contentDigest, contentDigest);
  if (options.requireCiOrigin) {
    assert.equal(
      manifest.origin,
      'ci_pipeline',
      `CI release gate forbids origin=${manifest.origin} (must set MINA_RELEASE_SEQUENCE)`
    );
  }
  assert.ok(Array.isArray(manifest.assets) && manifest.assets.length > 0, 'Manifest assets list empty');

  // Verify EVERY manifest asset exists and matches exact byte size + SHA-256 in BOTH root dist/ AND immutable releases/<id>/
  for (const asset of manifest.assets) {
    const cleanRel = String(asset.path || '').replace(/^\.\//, '');
    for (const [scopeName, baseDir] of [
      ['dist', absDist],
      [`releases/${buildId}`, relDir],
    ]) {
      const target = path.join(baseDir, cleanRel);
      assert.ok(fs.existsSync(target), `[${scopeName}] Missing manifest asset: ${cleanRel}`);
      const buf = fs.readFileSync(target);
      assertValidFontMagicBytes(cleanRel, buf, scopeName);
      assert.equal(buf.byteLength, asset.size, `[${scopeName}] Size mismatch for ${cleanRel}`);
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      assert.equal(sha, asset.sha256, `[${scopeName}] SHA-256 mismatch for ${cleanRel}`);
    }
  }

  // Verify root release-manifest.json matches immutable versioned manifest byte-for-byte
  const rootManifestPath = path.join(absDist, 'release-manifest.json');
  assert.ok(fs.existsSync(rootManifestPath), 'Root release-manifest.json missing');
  assert.equal(
    fs.readFileSync(rootManifestPath, 'utf8'),
    fs.readFileSync(relManifestPath, 'utf8'),
    'Root release-manifest.json must match immutable versioned manifest'
  );

  return {
    releaseId: buildId,
    releaseSequence,
    semver,
    contentDigest,
    origin: manifest.origin,
    assetCount: manifest.assets.length,
    manifestUrl: webPointer.manifestUrl,
  };
}

export function verifyCrossTargetParity(reference, rootDir = process.cwd()) {
  const absRoot = path.resolve(rootDir);
  const targets = [
    ['root/version.json', path.join(absRoot, 'version.json')],
    ['gh-pages-dist/version.json', path.join(absRoot, 'gh-pages-dist', 'version.json')],
    ['android-www/version.json', path.join(absRoot, 'app', 'src', 'main', 'assets', 'www', 'version.json')],
  ];
  const checked = [];
  for (const [label, filePath] of targets) {
    if (!fs.existsSync(filePath)) continue;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(
      data.releaseId,
      reference.releaseId,
      `Build identity drift detected in ${label}: ${data.releaseId} !== ${reference.releaseId}`
    );
    assert.equal(
      data.contentDigest,
      reference.contentDigest,
      `Content digest drift detected in ${label}: ${data.contentDigest} !== ${reference.contentDigest}`
    );
    assert.equal(
      data.releaseSequence,
      reference.releaseSequence,
      `Release sequence drift detected in ${label}: #${data.releaseSequence} !== #${reference.releaseSequence}`
    );
    checked.push(label);
  }
  return checked;
}

export function compareReleaseDeterminism(dirA, dirB) {
  const a = verifyLocalReleaseDirectory(dirA);
  const b = verifyLocalReleaseDirectory(dirB);
  assert.equal(a.releaseId, b.releaseId, `Non-deterministic releaseId: ${a.releaseId} vs ${b.releaseId}`);
  assert.equal(
    a.contentDigest,
    b.contentDigest,
    `Non-deterministic contentDigest: ${a.contentDigest} vs ${b.contentDigest}`
  );

  const mA = JSON.parse(fs.readFileSync(path.join(path.resolve(dirA), 'release-manifest.json'), 'utf8'));
  const mB = JSON.parse(fs.readFileSync(path.join(path.resolve(dirB), 'release-manifest.json'), 'utf8'));
  assert.deepEqual(mA.assets, mB.assets, 'Asset inventory or hashes differed across double build');
  return a;
}

export async function verifyRemoteDeployment(baseUrl, options = {}) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  // 1. Check root index.html (catches GitHub Pages branch-root raw TSX deployment incident!)
  const indexRes = await fetch(normalizedBase, { cache: 'no-store' });
  assert.equal(indexRes.status, 200, `Remote root HTML returned HTTP ${indexRes.status}`);
  assertValidMime('/index.html', indexRes.headers.get('content-type'));
  const indexHtml = await indexRes.text();
  assert.ok(
    !indexHtml.includes('src/main.tsx'),
    'CRITICAL: Remote deployment is serving dev index.html with raw src/main.tsx! Set GitHub Pages source to GitHub Actions.'
  );
  assert.ok(!indexHtml.includes('__MINA_BUILD_ID'), 'Remote index.html contains unresolved __MINA_BUILD_ID');
  assert.ok(!indexHtml.includes('__MINA_CONTENT_DIGEST'), 'Remote index.html contains unresolved __MINA_CONTENT_DIGEST');

  const htmlBuildId = indexHtml.match(/<meta\s+name="minadental-build-id"\s+content="([^"]+)"/i)?.[1];
  const htmlSeqStr = indexHtml.match(/<meta\s+name="minadental-release-seq"\s+content="([^"]+)"/i)?.[1];
  const htmlDigest = indexHtml.match(/<meta\s+name="minadental-content-digest"\s+content="([^"]+)"/i)?.[1];
  assert.ok(
    htmlBuildId && htmlBuildId !== 'dev-local' && BUILD_ID_RE.test(htmlBuildId),
    `CRITICAL: Remote index.html missing valid buildId (got ${htmlBuildId}). Ensure GitHub Pages Source = GitHub Actions.`
  );
  const htmlSeq = parseStrictPositiveInt(htmlSeqStr, 'remote minadental-release-seq');
  assert.ok(htmlDigest && SHA256_RE.test(htmlDigest), `Remote index.html missing valid contentDigest: ${htmlDigest}`);

  if (options.expectedReleaseId) {
    assert.equal(
      htmlBuildId,
      options.expectedReleaseId,
      `Remote deployed buildId ${htmlBuildId} does not match expected ${options.expectedReleaseId}`
    );
  }

  // 1b. Verify 404.html is coherent and NOT serving raw src/main.tsx or dev-local
  const remote404Res = await fetch(new URL('404.html', normalizedBase), { cache: 'no-store' });
  if (remote404Res.ok) {
    const remote404Html = await remote404Res.text();
    assert.ok(!remote404Html.includes('src/main.tsx'), 'Remote 404.html contains raw src/main.tsx');
    assert.ok(remote404Html.includes(htmlBuildId), 'Remote 404.html buildId does not match index.html');
  }

  // 2. Check web, android, and ios pointers
  for (const ptrFile of ['release-pointer.json', 'android-release-pointer.json', 'ios-release-pointer.json']) {
    const ptrUrl = new URL(ptrFile, normalizedBase).toString();
    const ptrRes = await fetch(ptrUrl, { cache: 'no-store' });
    assert.equal(ptrRes.status, 200, `Remote ${ptrFile} returned HTTP ${ptrRes.status}`);
    assertValidMime(ptrFile, ptrRes.headers.get('content-type'));
    const ptr = await ptrRes.json();
    assert.equal(ptr.currentReleaseId, htmlBuildId, `Remote ${ptrFile} releaseId mismatch`);
    assert.equal(ptr.releaseSequence, htmlSeq, `Remote ${ptrFile} releaseSequence mismatch`);
  }

  // 3. Fetch authoritative versioned manifest from release-pointer.json
  const webPtrRes = await fetch(new URL('release-pointer.json', normalizedBase), { cache: 'no-store' });
  const webPtr = await webPtrRes.json();
  const manifestUrl = new URL(webPtr.manifestUrl, normalizedBase).toString();
  const manifestRes = await fetch(manifestUrl, { cache: 'no-store' });
  assert.equal(manifestRes.status, 200, `Remote versioned manifest returned HTTP ${manifestRes.status}`);
  assertValidMime(manifestUrl, manifestRes.headers.get('content-type'));
  const manifest = await manifestRes.json();
  assert.equal(manifest.releaseId, htmlBuildId, 'Remote manifest releaseId mismatch');
  assert.equal(manifest.contentDigest, htmlDigest, 'Remote manifest contentDigest mismatch');

  // 4. Verify EVERY asset listed in remote manifest (HTTP 200 + MIME + magic bytes + exact byte size + exact SHA-256)
  let verifiedAssets = 0;
  for (const entry of manifest.assets) {
    const assetUrl = new URL(entry.path, manifestUrl).toString();
    const assetRes = await fetch(assetUrl, { cache: 'no-store' });
    assert.equal(assetRes.status, 200, `Remote asset ${assetUrl} returned HTTP ${assetRes.status}`);
    assertValidMime(new URL(assetUrl).pathname, assetRes.headers.get('content-type'));
    const rawBuf = Buffer.from(await assetRes.arrayBuffer());
    assertValidFontMagicBytes(entry.path, rawBuf, 'remote');
    assert.equal(rawBuf.byteLength, entry.size, `Remote asset size mismatch for ${entry.path}`);
    const sha = crypto.createHash('sha256').update(rawBuf).digest('hex');
    assert.equal(sha, entry.sha256, `Remote asset SHA-256 mismatch for ${entry.path}`);
    verifiedAssets += 1;
  }

  // 5. Explicitly verify primary Vazirmatn font URLs at root deployment path
  for (const fontRel of ['fonts/vazirmatn-arabic.woff2', 'fonts/vazirmatn.ttf']) {
    const fontUrl = new URL(fontRel, normalizedBase).toString();
    const fontRes = await fetch(fontUrl, { cache: 'no-store' });
    assert.equal(fontRes.status, 200, `Remote font ${fontUrl} returned HTTP ${fontRes.status}`);
    assertValidMime(fontRel, fontRes.headers.get('content-type'));
    const fontBuf = Buffer.from(await fontRes.arrayBuffer());
    assertValidFontMagicBytes(fontRel, fontBuf, 'remote-root-font');
  }

  // 6. GE-0007 P0-PWA: Verify live Chrome PWA installability (root ./manifest.json, scope, 192/512 PNGs)
  const remoteManifestTag = indexHtml.match(/<link\b[^>]*rel=["']manifest["'][^>]*>/i)?.[0] || '';
  const remoteManifestHref = remoteManifestTag.match(/\bhref=["']([^"']+)["']/i)?.[1] || '';
  assert.equal(
    remoteManifestHref,
    './manifest.json',
    `CRITICAL PWA BUG: Remote index.html manifest href must be "./manifest.json", got ${JSON.stringify(remoteManifestHref)}`
  );
  const remotePwaManifestUrl = new URL(remoteManifestHref, normalizedBase).toString();
  const remotePwaRes = await fetch(remotePwaManifestUrl, { cache: 'no-store' });
  assert.equal(remotePwaRes.status, 200, `Remote manifest.json returned HTTP ${remotePwaRes.status}`);
  assertValidMime('manifest.json', remotePwaRes.headers.get('content-type'));
  const remotePwa = await remotePwaRes.json();
  const remoteScope = new URL(remotePwa.scope || './', remotePwaManifestUrl).toString();
  assert.equal(remoteScope, normalizedBase, `Remote manifest scope (${remoteScope}) must equal ${normalizedBase}`);
  for (const requiredIcon of ['icon-192.png', 'icon-512.png']) {
    const iconUrl = new URL(requiredIcon, remotePwaManifestUrl).toString();
    const iconRes = await fetch(iconUrl, { cache: 'no-store' });
    assert.equal(iconRes.status, 200, `Remote PWA icon ${iconUrl} returned HTTP ${iconRes.status}`);
    const iconBuf = Buffer.from(await iconRes.arrayBuffer());
    assert.equal(iconBuf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `Remote PWA icon ${requiredIcon} is not a valid PNG`);
  }

  return {
    baseUrl: normalizedBase,
    releaseId: htmlBuildId,
    releaseSequence: manifest.releaseSequence,
    contentDigest: htmlDigest,
    verifiedAssets,
  };
}

async function runCli() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === '--compute-sequence') {
    const remoteIdx = args.indexOf('--remote-pointer');
    const remotePointerUrl = remoteIdx >= 0 ? args[remoteIdx + 1] : undefined;
    const requireRemotePointer = args.includes('--require-remote-pointer');
    const bootstrapFirstRelease =
      args.includes('--bootstrap-first-release') ||
      String(process.env.MINA_BOOTSTRAP_FIRST_RELEASE || '').toLowerCase() === 'true';
    const res = await computeMonotonicSequence({
      baseSequence: process.env.MINA_BASE_SEQUENCE || '224',
      runNumber: process.env.GITHUB_RUN_NUMBER || '1',
      overrideInput: process.env.MINA_RELEASE_SEQUENCE_INPUT || '',
      remotePointerUrl,
      requireRemotePointer,
      bootstrapFirstRelease,
      allowLegacyRootMigration: args.includes('--allow-legacy-root-migration'),
    });
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `value=${res.sequence}\n`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `remote_sequence=${res.remoteSequence}\n`);
    }
    console.log(JSON.stringify(res));
    return;
  }

  if (cmd === '--verify-local') {
    const targetDir = args[1] || 'dist';
    const requireCiOrigin = args.includes('--require-ci-origin');
    const verifyParity = args.includes('--verify-parity');
    const res = verifyLocalReleaseDirectory(targetDir, { requireCiOrigin });
    const parityChecked = verifyParity ? verifyCrossTargetParity(res) : [];
    const paritySuffix = parityChecked.length > 0 ? `, parity=${parityChecked.join('+')}` : '';
    console.log(
      `✔ [ci-release-gate] Local release verified: ${res.releaseId} (seq=#${res.releaseSequence}, origin=${res.origin}, ${res.assetCount} dual-verified assets${paritySuffix})`
    );
    return;
  }

  if (cmd === '--compare') {
    const dirA = args[1];
    const dirB = args[2];
    assert.ok(dirA && dirB, 'Usage: --compare <dirA> <dirB>');
    const res = compareReleaseDeterminism(dirA, dirB);
    console.log(
      `✔ [ci-release-gate] Double-build determinism verified: ${res.releaseId} (digest=${res.contentDigest})`
    );
    return;
  }

  if (cmd === '--verify-remote') {
    const remoteUrl = args[1];
    assert.ok(remoteUrl, 'Usage: --verify-remote <baseUrl> [--expected-release-id <id>]');
    const expIdx = args.indexOf('--expected-release-id');
    const expectedReleaseId = expIdx >= 0 ? args[expIdx + 1] : undefined;
    const res = await verifyRemoteDeployment(remoteUrl, { expectedReleaseId });
    console.log(
      `✔ [ci-release-gate] Remote HTTP health gate passed: ${res.baseUrl} -> ${res.releaseId} (#${res.releaseSequence}, ${res.verifiedAssets} SHA-256 verified assets)`
    );
    return;
  }

  console.error(
    'Usage: node scripts/ci-release-gate.mjs [--compute-sequence | --verify-local <dir> | --compare <dirA> <dirB> | --verify-remote <url>]'
  );
  process.exit(1);
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isDirectExecution) {
  runCli().catch((err) => {
    console.error('✖ [ci-release-gate] FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
