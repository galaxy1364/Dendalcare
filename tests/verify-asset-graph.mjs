import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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

function startStaticServer(dirPath) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      let relPath = decodeURIComponent(reqUrl.pathname).replace(/^\/+/, '');
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
        baseUrl: `http://127.0.0.1:${addr.port}/`,
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
  } else if (pathname.endsWith('.png') || pathname.endsWith('.webp') || pathname.endsWith('.jpg')) {
    assert.ok(ct.includes('image/'), `Invalid image MIME for ${pathname}: ${ct}`);
  } else if (pathname.endsWith('.html') || pathname.endsWith('/')) {
    assert.ok(ct.includes('text/html'), `Invalid HTML MIME for ${pathname}: ${ct}`);
  }
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
  // Static ESM imports/exports: import ... from "./foo.js" or import "./foo.js"
  for (const m of js.matchAll(/(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+\.(?:js|mjs|css))['"]/g)) {
    refs.push(m[1]);
  }
  // Dynamic imports: import("./chunk.js")
  for (const m of js.matchAll(/import\(\s*['"](\.[^'"]+\.(?:js|mjs))['"]\s*\)/g)) {
    refs.push(m[1]);
  }
  // Vite __vite__mapDeps asset list entries like "assets/Foo-HASH.js" or "assets/Foo-HASH.css"
  for (const m of js.matchAll(/["'](assets\/[A-Za-z0-9._-]+\.(?:js|mjs|css))["']/g)) {
    refs.push(new URL(m[1], baseUrl).toString());
  }
  return refs;
}

async function verifyTargetDirectory(label, relDir) {
  const absDir = path.resolve(ROOT, relDir);
  assert.ok(fs.existsSync(absDir), `[${label}] Directory does not exist: ${relDir}`);

  const { server, baseUrl } = await startStaticServer(absDir);
  const visited = new Set();
  const queue = [new URL('index.html', baseUrl).toString()];
  let checkedCount = 0;

  try {
    // 1. Verify root HTML has zero raw ./src/main.tsx references and valid BUILD_ID
    const indexRes = await fetch(new URL('index.html', baseUrl));
    assert.equal(indexRes.status, 200, `[${label}] index.html HTTP status must be 200`);
    const indexHtml = await indexRes.text();
    assert.ok(!indexHtml.includes('src/main.tsx'), `[${label}] Built index.html must NOT execute raw src/main.tsx`);
    assert.ok(!indexHtml.includes('gh-pages-dist/app.js'), `[${label}] Built index.html must NOT inject deprecated gh-pages-dist/app.js`);

    const buildIdMatch = indexHtml.match(/<meta\s+name="minadental-build-id"\s+content="([^"]+)"/i);
    assert.ok(buildIdMatch && buildIdMatch[1] && !buildIdMatch[1].startsWith('__'), `[${label}] index.html missing stamped minadental-build-id`);
    const htmlBuildId = buildIdMatch[1];

    // 2. Verify coherent BUILD_ID across version.json, build-manifest.json, and sw.js
    const versionRes = await fetch(new URL('version.json', baseUrl));
    assert.equal(versionRes.status, 200, `[${label}] version.json must return HTTP 200`);
    assertValidMime(new URL('version.json', baseUrl).toString(), versionRes.headers.get('content-type'));
    const versionJson = await versionRes.json();
    assert.equal(versionJson.buildId, htmlBuildId, `[${label}] version.json buildId must match index.html`);

    const manifestBuildRes = await fetch(new URL('build-manifest.json', baseUrl));
    assert.equal(manifestBuildRes.status, 200, `[${label}] build-manifest.json must return HTTP 200`);
    const buildManifest = await manifestBuildRes.json();
    assert.equal(buildManifest.buildId, htmlBuildId, `[${label}] build-manifest.json buildId must match index.html`);
    for (const assetRel of buildManifest.assets || []) {
      queue.push(new URL(assetRel, baseUrl).toString());
    }

    const swRes = await fetch(new URL('sw.js', baseUrl));
    assert.equal(swRes.status, 200, `[${label}] sw.js must return HTTP 200`);
    assertValidMime(new URL('sw.js', baseUrl).toString(), swRes.headers.get('content-type'));
    const swText = await swRes.text();
    assert.ok(swText.includes(htmlBuildId), `[${label}] sw.js must contain matching BUILD_ID ${htmlBuildId}`);

    const precacheBlock = swText.match(/const PRECACHE_ASSETS = (\[[\s\S]*?\]);/);
    assert.ok(precacheBlock, `[${label}] sw.js missing PRECACHE_ASSETS array`);
    const precacheList = JSON.parse(precacheBlock[1]);
    for (const assetUrl of precacheList) {
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
        // Drain response stream
        await res.arrayBuffer();
      }
    }

    console.log(
      `✔ [${label}] Asset graph verified: ${checkedCount} local URLs returned HTTP 200 with valid MIME (BUILD_ID=${htmlBuildId})`
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const targets = [
    ['dist', 'dist'],
    ['gh-pages-dist', 'gh-pages-dist'],
  ];
  if (fs.existsSync(path.resolve(ROOT, 'app/src/main/assets/www/index.html'))) {
    targets.push(['android-www', 'app/src/main/assets/www']);
  }

  for (const [label, relDir] of targets) {
    await verifyTargetDirectory(label, relDir);
  }
}

main().catch((err) => {
  console.error('✖ Asset graph verification FAILED:', err);
  process.exit(1);
});
