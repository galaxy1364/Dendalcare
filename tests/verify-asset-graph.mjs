import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const ROOT = process.cwd();

const MIME_BY_EXT = {
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

const BUILD_ID_PATTERN = /^v\d+\.\d+\.\d+-[0-9a-f]{10}$/;

function walkFilesRelative(dirPath, baseDir = dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const abs = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFilesRelative(abs, baseDir));
    } else if (entry.isFile()) {
      out.push(path.relative(baseDir, abs).split(path.sep).join('/'));
    }
  }
  return out.sort();
}

function startStaticServer(dirPath, mountPrefix = '/') {
  const normalizedPrefix = mountPrefix.endsWith('/') ? mountPrefix : `${mountPrefix}/`;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(reqUrl.pathname);

      if (normalizedPrefix !== '/') {
        const barePrefix = normalizedPrefix.slice(0, -1);
        if (pathname === barePrefix) {
          pathname = normalizedPrefix;
        }
        if (!pathname.startsWith(normalizedPrefix)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Outside mount prefix');
          return;
        }
        pathname = pathname.slice(normalizedPrefix.length);
      }

      let relPath = pathname.replace(/^\/+/, '');
      if (!relPath || relPath.endsWith('/')) {
        relPath = path.join(relPath, 'index.html');
      }
      const absPath = path.resolve(dirPath, relPath);
      if (!absPath.startsWith(path.resolve(dirPath))) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      const ext = path.extname(absPath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream',
      });
      fs.createReadStream(absPath).pipe(res);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}${normalizedPrefix}`,
      });
    });
  });
}

function isLocalRef(ref) {
  if (!ref || typeof ref !== 'string') return false;
  const trimmed = ref.trim();
  if (!trimmed) return false;
  if (/^(https?:|data:|blob:|mailto:|tel:|#|javascript:)/i.test(trimmed)) return false;
  return true;
}

function resolveRefUrl(ref, parentUrl) {
  const cleaned = ref.split('?')[0].split('#')[0];
  return new URL(cleaned, parentUrl).toString();
}

function assertValidMime(urlStr, contentType) {
  const pathname = new URL(urlStr).pathname.toLowerCase();
  const ct = (contentType || '').toLowerCase();
  if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) {
    assert.ok(ct.includes('javascript'), `Invalid JS MIME for ${pathname}: ${ct}`);
    assert.ok(!ct.includes('text/html'), `JS asset returned HTML MIME for ${pathname}`);
  } else if (pathname.endsWith('.css')) {
    assert.ok(ct.includes('text/css'), `Invalid CSS MIME for ${pathname}: ${ct}`);
  } else if (pathname.endsWith('.json') || pathname.endsWith('.webmanifest')) {
    assert.ok(ct.includes('json'), `Invalid JSON MIME for ${pathname}: ${ct}`);
  } else if (pathname.endsWith('.woff2') || pathname.endsWith('.woff') || pathname.endsWith('.ttf')) {
    assert.ok(!ct.includes('text/html'), `Font returned HTML MIME for ${pathname}`);
  } else if (pathname.endsWith('.svg')) {
    assert.ok(ct.includes('image/svg'), `Invalid SVG MIME for ${pathname}: ${ct}`);
  } else if (pathname.endsWith('.png') || pathname.endsWith('.webp') || pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
    assert.ok(ct.includes('image/'), `Invalid image MIME for ${pathname}: ${ct}`);
  } else if (pathname.endsWith('.html') || pathname.endsWith('/')) {
    assert.ok(ct.includes('text/html'), `Invalid HTML MIME for ${pathname}: ${ct}`);
  }
}

function parseScriptSyntaxWithNodeCheck(source, isModule, label) {
  const args = isModule ? ['--input-type=module', '--check'] : ['--check'];
  try {
    execFileSync(process.execPath, args, {
      input: source,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (err) {
    const stderr = err && err.stderr ? String(err.stderr).trim() : String(err);
    throw new Error(`[${label}] Syntax check failed: ${stderr}`);
  }
}

function validateInlineScriptsInHtml(html, htmlLabel) {
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let scriptIndex = 0;
  let parsedCount = 0;

  for (const match of html.matchAll(scriptRegex)) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    // Skip external <script src="..."> tags with empty body
    if (/\bsrc\s*=\s*['"][^'"]+['"]/i.test(attrs) && !body.trim()) {
      continue;
    }
    if (!body.trim()) continue;
    scriptIndex += 1;

    const typeMatch = attrs.match(/\btype\s*=\s*['"]([^'"]+)['"]/i);
    const scriptType = (typeMatch ? typeMatch[1] : 'text/javascript').trim().toLowerCase();
    const scriptLabel = `${htmlLabel}#inline-script-${scriptIndex}(${scriptType})`;

    if (scriptType === 'application/json' || scriptType === 'application/ld+json' || scriptType === 'importmap') {
      try {
        JSON.parse(body);
      } catch (err) {
        throw new Error(`[${scriptLabel}] Invalid JSON inline script: ${err.message}`);
      }
      parsedCount += 1;
      continue;
    }

    if (scriptType === 'module') {
      parseScriptSyntaxWithNodeCheck(body, true, scriptLabel);
      parsedCount += 1;
      continue;
    }

    if (
      scriptType === '' ||
      scriptType === 'text/javascript' ||
      scriptType === 'application/javascript' ||
      scriptType === 'text/ecmascript' ||
      scriptType === 'application/ecmascript'
    ) {
      // 1. Parse directly with V8 compiler
      try {
        new vm.Script(body, { filename: scriptLabel });
      } catch (err) {
        throw new Error(`[${scriptLabel}] V8 parse error: ${err.message}`);
      }
      // 2. Cross-verify with `node --check`
      parseScriptSyntaxWithNodeCheck(body, false, scriptLabel);
      parsedCount += 1;
    }
  }

  return parsedCount;
}

function extractHtmlRefs(html) {
  const refs = [];
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/gi)) refs.push(m[1]);
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/gi)) refs.push(m[1]);
  for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/gi)) refs.push(m[1]);
  return refs.filter(isLocalRef);
}

function extractCssRefs(css) {
  const refs = [];
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
    if (isLocalRef(m[1])) refs.push(m[1]);
  }
  return refs;
}

function extractJsRefs(js, baseUrl) {
  const refs = [];
  for (const m of js.matchAll(/(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+\.(?:js|mjs|css))['"]/g)) {
    refs.push(m[1]);
  }
  for (const m of js.matchAll(/import\(\s*['"](\.[^'"]+\.(?:js|mjs))['"]\s*\)/g)) {
    refs.push(m[1]);
  }
  for (const m of js.matchAll(/["'](assets\/[A-Za-z0-9._-]+\.(?:js|mjs|css))["']/g)) {
    refs.push(new URL(m[1], baseUrl).toString());
  }
  return refs;
}

async function verifyTargetDirectory(label, relDir, mountPrefix = '/') {
  const absDir = path.resolve(ROOT, relDir);
  assert.ok(fs.existsSync(absDir), `[${label}] Directory does not exist: ${relDir}`);

  // Hygiene gate: zero dev-only assets/aistudio artifacts on disk
  const allDiskFiles = walkFilesRelative(absDir);
  const leakedAiStudioFiles = allDiskFiles.filter((f) => f.includes('assets/aistudio'));
  assert.equal(
    leakedAiStudioFiles.length,
    0,
    `[${label}] Dev-only assets/aistudio files leaked into release artifact: ${leakedAiStudioFiles.slice(0, 5).join(', ')}`
  );

  // Parse EVERY HTML file's inline scripts with real V8 + node --check
  const htmlFiles = allDiskFiles.filter((f) => f.toLowerCase().endsWith('.html'));
  assert.ok(htmlFiles.length > 0, `[${label}] No HTML files found in ${relDir}`);
  let totalParsedInlineScripts = 0;
  for (const relHtml of htmlFiles) {
    const content = fs.readFileSync(path.join(absDir, relHtml), 'utf8');
    totalParsedInlineScripts += validateInlineScriptsInHtml(content, `${label}:${relHtml}`);
  }
  assert.ok(
    totalParsedInlineScripts > 0,
    `[${label}] Expected at least 1 parsed inline script across built HTML files`
  );

  const { server, baseUrl } = await startStaticServer(absDir, mountPrefix);
  const visited = new Set();
  const queue = [new URL('index.html', baseUrl).toString()];
  let checkedCount = 0;

  try {
    // 1. Verify root HTML has zero syntax corruption, zero raw src/main.tsx, and valid BUILD_ID
    const indexRes = await fetch(new URL('index.html', baseUrl));
    assert.equal(indexRes.status, 200, `[${label}] index.html HTTP status must be 200`);
    const indexHtml = await indexRes.text();
    assert.ok(!indexHtml.includes('src/main.tsx'), `[${label}] Built index.html must NOT execute raw src/main.tsx`);
    assert.ok(!indexHtml.includes('gh-pages-dist/app.js'), `[${label}] Built index.html must NOT inject deprecated gh-pages-dist/app.js`);
    assert.ok(!indexHtml.includes('__MINA_BUILD_ID'), `[${label}] Unresolved __MINA_BUILD_ID placeholder found in index.html`);
    assert.ok(!indexHtml.includes('__MINA_RELEASE_SEQ'), `[${label}] Unresolved __MINA_RELEASE_SEQ placeholder found in index.html`);
    assert.ok(!indexHtml.includes('__MINA_SEMVER'), `[${label}] Unresolved __MINA_SEMVER placeholder found in index.html`);
    assert.ok(!indexHtml.includes('__MINA_CONTENT_DIGEST'), `[${label}] Unresolved __MINA_CONTENT_DIGEST placeholder found in index.html`);

    const buildIdMatch = indexHtml.match(/<meta\s+name="minadental-build-id"\s+content="([^"]+)"/i);
    assert.ok(buildIdMatch && buildIdMatch[1], `[${label}] index.html missing stamped minadental-build-id`);
    const htmlBuildId = buildIdMatch[1];
    assert.match(htmlBuildId, BUILD_ID_PATTERN, `[${label}] Invalid BUILD_ID format: ${htmlBuildId}`);

    const seqMatch = indexHtml.match(/<meta\s+name="minadental-release-seq"\s+content="([^"]+)"/i);
    assert.ok(seqMatch && /^\d+$/.test(seqMatch[1]) && Number(seqMatch[1]) > 0, `[${label}] index.html missing valid minadental-release-seq`);
    const htmlReleaseSeq = Number(seqMatch[1]);

    const semverMatch = indexHtml.match(/<meta\s+name="minadental-semver"\s+content="([^"]+)"/i);
    assert.ok(semverMatch && /^\d+\.\d+\.\d+$/.test(semverMatch[1]), `[${label}] index.html missing valid minadental-semver`);
    const htmlSemver = semverMatch[1];

    const digestMatch = indexHtml.match(/<meta\s+name="minadental-content-digest"\s+content="([^"]+)"/i);
    assert.ok(digestMatch && /^[a-f0-9]{64}$/.test(digestMatch[1]), `[${label}] index.html missing valid 64-hex minadental-content-digest`);
    const htmlContentDigest = digestMatch[1];
    assert.equal(htmlBuildId, `v${htmlSemver}-${htmlContentDigest.slice(0, 10)}`, `[${label}] buildId must derive from semver + contentDigest`);

    // Regression guard for V6 P0 bug: window.<buildId> = buildId MUST NEVER happen
    assert.ok(
      indexHtml.includes('window.__minaBuildId = buildId;'),
      `[${label}] index.html must assign fixed identifier window.__minaBuildId = buildId;`
    );
    assert.ok(
      !indexHtml.includes(`window.${htmlBuildId}`),
      `[${label}] Corrupted JS syntax detected: window.${htmlBuildId}`
    );

    // 2. Verify coherent V8 release pointers (web, android, ios) & immutable versioned release-manifest.json
    const pointerUrl = new URL('release-pointer.json', baseUrl).toString();
    const pointerRes = await fetch(pointerUrl);
    assert.equal(pointerRes.status, 200, `[${label}] release-pointer.json must return HTTP 200`);
    assertValidMime(pointerUrl, pointerRes.headers.get('content-type'));
    const pointerJson = await pointerRes.json();
    assert.equal(pointerJson.schemaVersion, 2, `[${label}] release-pointer.json schemaVersion must be 2`);
    assert.equal(pointerJson.currentReleaseId, htmlBuildId, `[${label}] release-pointer.json currentReleaseId must match index.html`);
    assert.equal(pointerJson.releaseSequence, htmlReleaseSeq, `[${label}] release-pointer.json releaseSequence must match index.html`);
    assert.equal(
      pointerJson.manifestUrl,
      `./releases/${htmlBuildId}/release-manifest.json`,
      `[${label}] release-pointer.json must point to immutable versioned release manifest`
    );

    for (const [platformPtr, expectedPlatform] of [
      ['android-release-pointer.json', 'android'],
      ['ios-release-pointer.json', 'ios'],
    ]) {
      const pUrl = new URL(platformPtr, baseUrl).toString();
      const pRes = await fetch(pUrl);
      assert.equal(pRes.status, 200, `[${label}] ${platformPtr} must return HTTP 200`);
      assertValidMime(pUrl, pRes.headers.get('content-type'));
      const pJson = await pRes.json();
      assert.equal(pJson.platform, expectedPlatform, `[${label}] ${platformPtr} platform mismatch`);
      assert.equal(pJson.currentReleaseId, htmlBuildId, `[${label}] ${platformPtr} releaseId mismatch`);
      assert.equal(pJson.releaseSequence, htmlReleaseSeq, `[${label}] ${platformPtr} sequence mismatch`);
    }

    const releaseManifestUrl = new URL(pointerJson.manifestUrl || 'release-manifest.json', pointerUrl).toString();
    const releaseManifestRes = await fetch(releaseManifestUrl);
    assert.equal(releaseManifestRes.status, 200, `[${label}] immutable release-manifest.json must return HTTP 200`);
    assertValidMime(releaseManifestUrl, releaseManifestRes.headers.get('content-type'));
    const releaseManifest = await releaseManifestRes.json();
    assert.equal(releaseManifest.schemaVersion, 2, `[${label}] release-manifest.json schemaVersion must be 2`);
    assert.equal(releaseManifest.releaseId, htmlBuildId, `[${label}] release-manifest.json releaseId must match index.html`);
    assert.equal(releaseManifest.releaseSequence, htmlReleaseSeq, `[${label}] release-manifest.json releaseSequence must match index.html`);
    assert.equal(releaseManifest.semver, htmlSemver, `[${label}] release-manifest.json semver must match index.html`);
    assert.equal(releaseManifest.contentDigest, htmlContentDigest, `[${label}] release-manifest.json contentDigest must match index.html`);
    assert.ok(Array.isArray(releaseManifest.assets) && releaseManifest.assets.length > 0, `[${label}] release-manifest.json must list hashed assets`);
    assert.ok(releaseManifest.rollbackPolicy && releaseManifest.rollbackPolicy.strategy === 'forward_release', `[${label}] release-manifest.json missing valid rollbackPolicy`);

    let verifiedManifestAssets = 0;
    for (const entry of releaseManifest.assets) {
      assert.ok(!String(entry.path).includes('aistudio'), `[${label}] release-manifest.json leaked aistudio asset: ${entry.path}`);
      assert.match(String(entry.sha256 || ''), /^[a-f0-9]{64}$/, `[${label}] Invalid SHA-256 in release-manifest.json for ${entry.path}`);
      const assetHttpUrl = new URL(entry.path, releaseManifestUrl).toString();
      const assetRes = await fetch(assetHttpUrl);
      assert.equal(assetRes.status, 200, `[${label}] Manifest asset HTTP error: ${entry.path} -> ${assetRes.status}`);
      assertValidMime(assetHttpUrl, assetRes.headers.get('content-type'));
      const rawBuf = Buffer.from(await assetRes.arrayBuffer());
      assert.equal(rawBuf.byteLength, entry.size, `[${label}] Manifest asset byte size mismatch for ${entry.path}: expected ${entry.size}, got ${rawBuf.byteLength}`);
      const actualSha = crypto.createHash('sha256').update(rawBuf).digest('hex');
      assert.equal(actualSha, entry.sha256, `[${label}] Manifest asset SHA-256 mismatch for ${entry.path}`);
      verifiedManifestAssets += 1;
    }

    // 2b. Verify coherent BUILD_ID across version.json, build-manifest.json, chunks.json, and sw.js
    const versionRes = await fetch(new URL('version.json', baseUrl));
    assert.equal(versionRes.status, 200, `[${label}] version.json must return HTTP 200`);
    assertValidMime(new URL('version.json', baseUrl).toString(), versionRes.headers.get('content-type'));
    const versionJson = await versionRes.json();
    assert.equal(versionJson.buildId, htmlBuildId, `[${label}] version.json buildId must match index.html`);
    assert.equal(versionJson.releaseId, htmlBuildId, `[${label}] version.json releaseId must match index.html`);
    assert.equal(versionJson.releaseSequence, htmlReleaseSeq, `[${label}] version.json releaseSequence must match index.html`);
    assert.equal(versionJson.semver, htmlSemver, `[${label}] version.json semver must match index.html`);

    const manifestBuildRes = await fetch(new URL('build-manifest.json', baseUrl));
    assert.equal(manifestBuildRes.status, 200, `[${label}] build-manifest.json must return HTTP 200`);
    const buildManifest = await manifestBuildRes.json();
    assert.equal(buildManifest.buildId, htmlBuildId, `[${label}] build-manifest.json buildId must match index.html`);
    assert.ok(
      !(buildManifest.files || []).some((f) => String(f).includes('aistudio')),
      `[${label}] build-manifest.json must NOT list aistudio dev artifacts`
    );
    for (const assetRel of buildManifest.assets || []) {
      assert.ok(!String(assetRel).includes('aistudio'), `[${label}] build-manifest assets leaked aistudio`);
      queue.push(new URL(assetRel, baseUrl).toString());
    }

    const chunksRes = await fetch(new URL('chunks.json', baseUrl));
    assert.equal(chunksRes.status, 200, `[${label}] chunks.json must return HTTP 200`);
    const chunksJson = await chunksRes.json();
    assert.equal(chunksJson.buildId, htmlBuildId, `[${label}] chunks.json buildId must match index.html`);
    assert.ok(
      !(chunksJson.files || []).some((f) => String(f).includes('aistudio')),
      `[${label}] chunks.json must NOT list aistudio dev artifacts`
    );

    const swRes = await fetch(new URL('sw.js', baseUrl));
    assert.equal(swRes.status, 200, `[${label}] sw.js must return HTTP 200`);
    assertValidMime(new URL('sw.js', baseUrl).toString(), swRes.headers.get('content-type'));
    const swText = await swRes.text();
    // Validate sw.js JS syntax with real V8 compiler
    new vm.Script(swText, { filename: `${label}:sw.js` });
    assert.ok(!swText.includes('__MINA_BUILD_ID'), `[${label}] Unresolved __MINA_BUILD_ID placeholder in sw.js`);
    assert.ok(
      swText.includes(`const BUILD_ID = ${JSON.stringify(htmlBuildId)};`),
      `[${label}] sw.js must declare exact BUILD_ID ${htmlBuildId}`
    );

    const criticalBlock = swText.match(/const CRITICAL_PRECACHE_ASSETS = (\[[\s\S]*?\]);/);
    assert.ok(criticalBlock, `[${label}] sw.js missing CRITICAL_PRECACHE_ASSETS array`);
    const criticalList = JSON.parse(criticalBlock[1]);
    assert.ok(
      criticalList.some((u) => u.endsWith('.js')) && criticalList.some((u) => u.endsWith('.css')),
      `[${label}] sw.js CRITICAL_PRECACHE_ASSETS must include entry JS and CSS`
    );

    const precacheBlock = swText.match(/const PRECACHE_ASSETS = (\[[\s\S]*?\]);/);
    assert.ok(precacheBlock, `[${label}] sw.js missing PRECACHE_ASSETS array`);
    const precacheList = JSON.parse(precacheBlock[1]);
    for (const assetUrl of [...criticalList, ...precacheList]) {
      assert.ok(!String(assetUrl).includes('aistudio'), `[${label}] sw.js precache leaked aistudio`);
      if (isLocalRef(assetUrl)) {
        queue.push(resolveRefUrl(assetUrl, baseUrl));
      }
    }

    // 3. Ensure gh-pages-dist has zero flattened root JS/CSS leftovers
    if (relDir === 'gh-pages-dist') {
      const rootEntries = fs.readdirSync(absDir);
      const strayRootAssets = rootEntries.filter(
        (name) => (name.endsWith('.js') && name !== 'sw.js') || name.endsWith('.css')
      );
      assert.equal(
        strayRootAssets.length,
        0,
        `[gh-pages-dist] Found stale flattened root JS/CSS files: ${strayRootAssets.join(', ')}`
      );
    }

    // 4. Recursive BFS across the entire asset graph over real HTTP
    while (queue.length > 0) {
      const targetUrl = queue.shift();
      if (!targetUrl || visited.has(targetUrl)) continue;
      if (!targetUrl.startsWith(baseUrl)) continue;
      visited.add(targetUrl);

      const res = await fetch(targetUrl);
      assert.equal(
        res.status,
        200,
        `[${label}] Asset graph 404/error: ${targetUrl} returned HTTP ${res.status}`
      );
      const ct = res.headers.get('content-type') || '';
      assertValidMime(targetUrl, ct);
      checkedCount += 1;

      const pathname = new URL(targetUrl).pathname.toLowerCase();
      if (pathname.endsWith('.html') || pathname.endsWith('/')) {
        const body = await res.text();
        for (const ref of extractHtmlRefs(body)) {
          queue.push(resolveRefUrl(ref, targetUrl));
        }
      } else if (pathname.endsWith('.css')) {
        const body = await res.text();
        for (const ref of extractCssRefs(body)) {
          queue.push(resolveRefUrl(ref, targetUrl));
        }
      } else if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) {
        const body = await res.text();
        for (const ref of extractJsRefs(body, baseUrl)) {
          queue.push(ref.startsWith('http') ? ref : resolveRefUrl(ref, targetUrl));
        }
      } else if (pathname.endsWith('manifest.json')) {
        const json = await res.json();
        if (Array.isArray(json.icons)) {
          for (const icon of json.icons) {
            if (isLocalRef(icon?.src)) {
              queue.push(resolveRefUrl(icon.src, targetUrl));
            }
          }
        }
      } else {
        await res.arrayBuffer();
      }
    }

    console.log(
      `✔ [${label} @ ${mountPrefix}] Asset graph + ${totalParsedInlineScripts} inline script(s) + ${verifiedManifestAssets} SHA-256 manifest assets verified: ${checkedCount} local URLs HTTP 200 (BUILD_ID=${htmlBuildId}, seq=#${htmlReleaseSeq})`
    );
    return { releaseId: htmlBuildId, releaseSequence: htmlReleaseSeq, semver: htmlSemver };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const targets = [
    ['dist', 'dist', '/'],
    ['dist', 'dist', '/Dendalcare/'],
    ['gh-pages-dist', 'gh-pages-dist', '/'],
    ['gh-pages-dist', 'gh-pages-dist', '/Dendalcare/'],
  ];
  if (fs.existsSync(path.resolve(ROOT, 'app/src/main/assets/www/index.html'))) {
    targets.push(['android-www', 'app/src/main/assets/www', '/']);
  }

  let referenceRelease = null;
  for (const [label, relDir, mountPrefix] of targets) {
    const verified = await verifyTargetDirectory(label, relDir, mountPrefix);
    if (!referenceRelease) {
      referenceRelease = verified;
    } else {
      assert.equal(
        verified.releaseId,
        referenceRelease.releaseId,
        `Cross-target releaseId mismatch on ${label}@${mountPrefix}: ${verified.releaseId} !== ${referenceRelease.releaseId}`
      );
      assert.equal(
        verified.releaseSequence,
        referenceRelease.releaseSequence,
        `Cross-target releaseSequence mismatch on ${label}@${mountPrefix}: ${verified.releaseSequence} !== ${referenceRelease.releaseSequence}`
      );
    }
  }
}

main().catch((err) => {
  console.error('✖ Asset graph verification FAILED:', err);
  process.exit(1);
});
