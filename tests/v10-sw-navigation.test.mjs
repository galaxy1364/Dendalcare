import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const BUILD = 'v4.9.6-1234567890';
const NEXT = 'v4.9.7-0987654321';
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  .replace('__MINA_BUILD_ID_VALUE__', BUILD);
const request = { url: 'https://example.test/Dendalcare/', mode: 'navigate' };
const html = (id, entry = './assets/index-123.js') =>
  `<!doctype html><meta name="minadental-build-id" content="${id}"><script type="module" src="${entry}"></script>`;
const response = (body, status = 200, mime = 'text/html') => {
  const res = new Response(body, { status, headers: { 'content-type': mime } });
  Object.defineProperty(res, 'type', { value: 'basic' });
  return res;
};
function harness(network, entries = {}, cacheError = false) {
  const writes = [];
  const cache = {
    async match(key) {
      const value = entries[typeof key === 'string' ? key : key.url];
      return value?.clone();
    },
    async put(key, value) { writes.push({ key, value }); },
  };
  const context = vm.createContext({
    self: { addEventListener() {}, location: new URL('https://example.test/Dendalcare/sw.js') },
    caches: { async open() { if (cacheError) throw Error('storage disabled'); return cache; } },
    fetch: async () => { if (network instanceof Error) throw network; return network; },
    Response, URL, AbortController, setTimeout, clearTimeout, console,
  });
  vm.runInContext(source, context);
  return { writes, navigate: () => context.handleNavigationRequest(request, new URL(request.url)) };
}

test('valid same-release network shell is served and cached', async () => {
  const h = harness(response(html(BUILD)));
  assert.match(await (await h.navigate()).text(), new RegExp(BUILD));
  assert.equal(h.writes.length, 1);
});
test('new valid release is served without mixing release caches', async () => {
  const h = harness(response(html(NEXT)));
  assert.match(await (await h.navigate()).text(), new RegExp(NEXT));
  assert.equal(h.writes.length, 0);
});
test('raw TSX / missing identity / 404 / wrong MIME never replace valid cached shell', async () => {
  for (const bad of [
    response(html('dev-local', './src/main.tsx')),
    response(html(BUILD, './src/main.tsx')),
    response('<html>missing identity</html>'),
    response(html(BUILD), 404),
    response(html(BUILD), 200, 'text/plain'),
  ]) {
    const h = harness(bad, { './index.html': response(html(BUILD)) });
    assert.match(await (await h.navigate()).text(), new RegExp(BUILD));
    assert.equal(h.writes.length, 0);
  }
});
test('offline exact-match with wrong release is skipped for verified same-release shell', async () => {
  const h = harness(Error('offline'), {
    [request.url]: response(html(NEXT)),
    './index.html': response(html(BUILD)),
  });
  assert.match(await (await h.navigate()).text(), new RegExp(BUILD));
});
test('no valid shell returns bounded recoverable page, not raw source', async () => {
  const h = harness(response(html('dev-local', './src/main.tsx')), {
    './index.html': response(html(NEXT)),
  });
  const result = await h.navigate();
  assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /src\/main\.tsx/);
});
test('unavailable cache does not block valid online shell', async () => {
  const h = harness(response(html(BUILD)), {}, true);
  assert.equal((await h.navigate()).status, 200);
});
test('unavailable cache and offline network return recovery page', async () => {
  const h = harness(Error('offline'), {}, true);
  assert.equal((await h.navigate()).status, 503);
});
