import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { computeMonotonicSequence } from '../scripts/ci-release-gate.mjs';
import { UpdateCoordinator } from '../src/services/updates/coordinator';
import type { AuthoritativeReleaseManifest, ReleasePointer } from '../src/services/updates/contracts';
import { UpdateLedger } from '../src/services/updates/ledger';
import type { PlatformUpdateAdapter } from '../src/services/updates/adapters/types';

export interface V9TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const ROOT = process.cwd();

function extractInlineBootstrapScript(htmlPath: string): string {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const match = html.match(/<script>\s*([\s\S]*?)<\/script>/i);
  assert.ok(match && match[1], `Inline bootstrap <script> not found in ${htmlPath}`);
  return match[1];
}

interface FakeElement {
  id: string;
  tagName: string;
  textContent: string;
  style: Record<string, string>;
  attrs: Record<string, string>;
  classes: Set<string>;
  classList: {
    add: (cls: string) => void;
    remove: (cls: string) => void;
    contains: (cls: string) => boolean;
  };
  listeners: Record<string, Array<(ev: unknown) => void>>;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, val: string) => void;
  addEventListener: (type: string, fn: (ev: unknown) => void) => void;
  click: () => void;
}

function makeFakeElement(id: string, tagName = 'DIV', attrs: Record<string, string> = {}): FakeElement {
  const classes = new Set<string>();
  const listeners: Record<string, Array<(ev: unknown) => void>> = {};
  return {
    id,
    tagName,
    textContent: '',
    style: { display: id === 'boot-error' ? 'none' : 'block' },
    attrs: { ...attrs },
    classes,
    classList: {
      add: (cls: string) => classes.add(cls),
      remove: (cls: string) => classes.delete(cls),
      contains: (cls: string) => classes.has(cls),
    },
    listeners,
    getAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    setAttribute(name: string, val: string) {
      this.attrs[name] = val;
    },
    addEventListener(type: string, fn: (ev: unknown) => void) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    click() {
      for (const fn of listeners['click'] || []) fn({});
    },
  };
}

function createBootHarness(options?: {
  pathname?: string;
  origin?: string;
  buildId?: string;
  releaseSeq?: string;
  swRegistrations?: Array<{ scope: string; unregister: () => Promise<boolean> }>;
  cacheNames?: string[];
}) {
  const origin = options?.origin ?? 'https://galaxy1364.github.io';
  const pathname = options?.pathname ?? '/Dendalcare/';
  const elements: Record<string, FakeElement> = {
    'boot-error': makeFakeElement('boot-error'),
    'boot-error-meta': makeFakeElement('boot-error-meta'),
    'boot-retry-btn': makeFakeElement('boot-retry-btn', 'BUTTON'),
    'boot-simple-reload-btn': makeFakeElement('boot-simple-reload-btn', 'BUTTON'),
    'boot-copy-diag-btn': makeFakeElement('boot-copy-diag-btn', 'BUTTON'),
    'splash-bar': makeFakeElement('splash-bar'),
    'splash-sub': makeFakeElement('splash-sub'),
  };

  const metas: Record<string, FakeElement> = {
    'meta[name="minadental-build-id"]': makeFakeElement('m1', 'META', {
      content: options?.buildId ?? 'v5.1.0-abcdef1234',
    }),
    'meta[name="minadental-release-seq"]': makeFakeElement('m2', 'META', {
      content: options?.releaseSeq ?? '80',
    }),
    'meta[name="minadental-content-digest"]': makeFakeElement('m3', 'META', {
      content: 'a'.repeat(64),
    }),
  };

  const windowListeners: Record<string, Array<(ev: unknown) => void>> = {};
  const scheduledTimers: Array<{ id: number; fn: () => void; delay: number; cleared: boolean }> = [];
  let nextTimerId = 1;
  let reloadCount = 0;

  const localStore = new Map<string, string>();
  const sessionStore = new Map<string, string>();
  const cacheSet = new Set<string>(options?.cacheNames ?? []);
  const deletedCaches: string[] = [];
  const swRegs = options?.swRegistrations ?? [];

  const docElement = makeFakeElement('html', 'HTML');

  const win: Record<string, unknown> = {
    location: {
      origin,
      pathname,
      protocol: 'https:',
      hostname: 'galaxy1364.github.io',
      port: '',
      href: `${origin}${pathname}`,
      reload: () => {
        reloadCount += 1;
      },
    },
    addEventListener: (type: string, fn: (ev: unknown) => void) => {
      if (!windowListeners[type]) windowListeners[type] = [];
      windowListeners[type].push(fn);
    },
    dispatchEvent: () => true,
    matchMedia: () => ({ matches: false }),
    caches: {
      keys: async () => Array.from(cacheSet),
      delete: async (k: string) => {
        deletedCaches.push(k);
        return cacheSet.delete(k);
      },
    },
  };

  const navigatorObj = {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) SamsungBrowser/25.0',
    clipboard: {
      writeText: async () => undefined,
    },
    serviceWorker: {
      getRegistrations: async () => swRegs,
      addEventListener: () => undefined,
      register: async () => ({ waiting: null, addEventListener: () => undefined }),
    },
  };

  const sandbox: Record<string, unknown> = {
    window: win,
    self: win,
    document: {
      documentElement: docElement,
      getElementById: (id: string) => elements[id] || null,
      querySelector: (sel: string) => metas[sel] || null,
    },
    navigator: navigatorObj,
    caches: win.caches,
    localStorage: {
      getItem: (k: string) => localStore.get(k) ?? null,
      setItem: (k: string, v: string) => localStore.set(k, String(v)),
      removeItem: (k: string) => localStore.delete(k),
    },
    sessionStorage: {
      getItem: (k: string) => sessionStore.get(k) ?? null,
      setItem: (k: string, v: string) => sessionStore.set(k, String(v)),
    },
    CustomEvent: class CustomEvent {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    setTimeout: (fn: () => void, delay: number) => {
      const id = nextTimerId++;
      scheduledTimers.push({ id, fn, delay, cleared: false });
      return id;
    },
    clearTimeout: (id: number) => {
      const found = scheduledTimers.find((t) => t.id === id);
      if (found) found.cleared = true;
    },
    Promise,
    Date,
    Math,
    Number,
    String,
    Array,
    RegExp,
    Error,
  };

  const scriptSrc = extractInlineBootstrapScript(path.join(ROOT, 'index.html'));
  vm.runInNewContext(scriptSrc, sandbox, { filename: 'index.html#bootstrap' });

  return {
    win,
    elements,
    localStore,
    sessionStore,
    deletedCaches,
    cacheSet,
    getReloadCount: () => reloadCount,
    fireWindowEvent(type: string, ev: unknown) {
      for (const fn of windowListeners[type] || []) {
        fn(ev);
      }
    },
    fireWatchdogTimers() {
      for (const t of scheduledTimers) {
        if (!t.cleared) t.fn();
      }
    },
  };
}

export async function runAllV9ResilientBootTests(): Promise<V9TestResult[]> {
  const results: V9TestResult[] = [];

  async function run(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      results.push({ name, passed: true });
    } catch (err) {
      results.push({
        name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await run('V9-01: Font, icon, manifest, preload, and stylesheet load errors are strictly NON-FATAL', () => {
    const h = createBootHarness();

    // 1. Font preload / woff2 404 (exact user screenshot regression!)
    h.fireWindowEvent('error', {
      target: {
        tagName: 'LINK',
        rel: 'preload',
        as: 'font',
        href: 'https://galaxy1364.github.io/Dendalcare/fonts/vazirmatn-arabic.woff2',
        getAttribute: (a: string) =>
          ({ rel: 'preload', as: 'font', href: 'https://galaxy1364.github.io/Dendalcare/fonts/vazirmatn-arabic.woff2' }[a] ?? null),
      },
    });

    // 2. Icon 404
    h.fireWindowEvent('error', {
      target: {
        tagName: 'LINK',
        rel: 'icon',
        href: 'https://galaxy1364.github.io/Dendalcare/icon-192.png',
        getAttribute: (a: string) =>
          ({ rel: 'icon', href: 'https://galaxy1364.github.io/Dendalcare/icon-192.png' }[a] ?? null),
      },
    });

    // 3. Manifest 404
    h.fireWindowEvent('error', {
      target: {
        tagName: 'LINK',
        rel: 'manifest',
        href: 'https://galaxy1364.github.io/Dendalcare/manifest.json',
        getAttribute: (a: string) =>
          ({ rel: 'manifest', href: 'https://galaxy1364.github.io/Dendalcare/manifest.json' }[a] ?? null),
      },
    });

    // 4. Primary CSS error (degraded but must NOT block React mount)
    h.fireWindowEvent('error', {
      target: {
        tagName: 'LINK',
        rel: 'stylesheet',
        href: 'https://galaxy1364.github.io/Dendalcare/assets/index-abc123.css',
        getAttribute: (a: string) =>
          ({ rel: 'stylesheet', href: 'https://galaxy1364.github.io/Dendalcare/assets/index-abc123.css' }[a] ?? null),
      },
    });

    assert.equal(h.elements['boot-error'].style.display, 'none', '#boot-error MUST remain hidden on non-fatal resource failures');
    assert.equal(h.win.__minaBootState, 'BOOTING', 'Boot state must remain BOOTING (not ERROR)');
    assert.equal(h.win.__minaBootFatalRootCause, null, 'No fatal root cause may be recorded for non-fatal assets');
    const warnings = h.win.__minaBootWarnings as Array<{ code: string }>;
    assert.ok(warnings.some((w) => w.code === 'FONT_LOAD_WARNING'), 'Expected FONT_LOAD_WARNING');
    assert.ok(warnings.some((w) => w.code === 'ICON_LOAD_WARNING'), 'Expected ICON_LOAD_WARNING');
    assert.ok(warnings.some((w) => w.code === 'MANIFEST_LOAD_WARNING'), 'Expected MANIFEST_LOAD_WARNING');
    assert.ok(warnings.some((w) => w.code === 'PRIMARY_CSS_DEGRADED'), 'Expected PRIMARY_CSS_DEGRADED');
  });

  await run('V9-02: Non-fatal pre-mount unhandled rejections (Supabase, AbortError, fonts, release-pointer) do NOT block boot', () => {
    const h = createBootHarness();

    h.fireWindowEvent('unhandledrejection', { reason: Object.assign(new Error('Aborted'), { name: 'AbortError' }) });
    h.fireWindowEvent('unhandledrejection', { reason: new Error('Supabase network unreachable') });
    h.fireWindowEvent('unhandledrejection', { reason: new Error('Failed to load fonts/vazirmatn-arabic.woff2') });
    h.fireWindowEvent('unhandledrejection', { reason: new Error('release-pointer.json 404') });
    h.fireWindowEvent('unhandledrejection', { reason: new Error('Failed to fetch') });

    assert.equal(h.elements['boot-error'].style.display, 'none', '#boot-error must NOT open for non-fatal rejections');
    assert.equal(h.win.__minaBootFatalRootCause, null);
    const warnings = h.win.__minaBootWarnings as Array<{ code: string }>;
    assert.equal(warnings.length, 5, 'All 5 non-fatal rejections must be recorded as warnings');
  });

  await run('V9-03: Fatal <script> error stops splash spinner, detects raw .tsx, and locks root cause against watchdog overwrite', () => {
    const h = createBootHarness();

    h.fireWindowEvent('error', {
      target: {
        tagName: 'SCRIPT',
        src: 'https://galaxy1364.github.io/Dendalcare/src/main.tsx',
        getAttribute: (a: string) => (a === 'src' ? 'https://galaxy1364.github.io/Dendalcare/src/main.tsx' : null),
      },
    });

    assert.equal(h.elements['boot-error'].style.display, 'block', '#boot-error must display on fatal entry script failure');
    assert.equal(h.win.__minaBootState, 'ERROR');
    assert.ok(h.elements['splash-bar'].classList.contains('splash-stopped'), 'Splash progress bar animation must stop on fatal error');
    const metaBeforeWatchdog = h.elements['boot-error-meta'].textContent;
    assert.ok(metaBeforeWatchdog.includes('CODE=RAW_TSX_DEPLOY_ERROR'), `Expected RAW_TSX_DEPLOY_ERROR, got ${metaBeforeWatchdog}`);

    // Now simulate 12s watchdog firing AFTER fatal error — MUST NOT overwrite real root cause!
    h.fireWatchdogTimers();
    assert.equal(
      h.elements['boot-error-meta'].textContent,
      metaBeforeWatchdog,
      '12s watchdog MUST NOT overwrite the original fatal root cause'
    );
  });

  await run('V9-04: Scoped safe recovery unregisters ONLY /Dendalcare/ SW & minadental caches while preserving sibling apps & offline queue', async () => {
    const unregisteredScopes: string[] = [];
    const h = createBootHarness({
      origin: 'https://galaxy1364.github.io',
      pathname: '/Dendalcare/',
      swRegistrations: [
        {
          scope: 'https://galaxy1364.github.io/Dendalcare/',
          unregister: async () => {
            unregisteredScopes.push('https://galaxy1364.github.io/Dendalcare/');
            return true;
          },
        },
        {
          scope: 'https://galaxy1364.github.io/other-app/',
          unregister: async () => {
            unregisteredScopes.push('https://galaxy1364.github.io/other-app/');
            return true;
          },
        },
      ],
      cacheNames: ['minadental-shell-v5.0.0-abc', 'minadental-v4', 'other-app-cache-v1'],
    });

    h.localStore.set('minadental_offline_queue_v1', '[{"id":"patient-1"}]');

    const runRecovery = h.win.__minaRunScopedSafeRecovery as () => Promise<void>;
    await runRecovery();

    assert.deepEqual(unregisteredScopes, ['https://galaxy1364.github.io/Dendalcare/']);
    assert.ok(h.deletedCaches.includes('minadental-shell-v5.0.0-abc'));
    assert.ok(h.deletedCaches.includes('minadental-v4'));
    assert.ok(!h.deletedCaches.includes('other-app-cache-v1'), 'Third-party cache must NOT be deleted');
    assert.ok(h.cacheSet.has('other-app-cache-v1'), 'Third-party cache must remain intact');
    assert.equal(h.localStore.get('minadental_offline_queue_v1'), '[{"id":"patient-1"}]', 'Offline queue must remain intact');
    assert.equal(h.sessionStore.get('minadental_boot_recovery_attempts'), '1');
    assert.equal(h.getReloadCount(), 1);
  });

  await run('V9-05: Real Persian font magic bytes (WOFF2 wOF2 + TTF 00010000) & coherent dist/404.html verified on disk', () => {
    const fontFiles = [
      { rel: 'public/fonts/vazirmatn-arabic.woff2', expectedMagic: '774f4632' },
      { rel: 'public/fonts/vazirmatn-latin.woff2', expectedMagic: '774f4632' },
      { rel: 'public/fonts/vazirmatn-latin-ext.woff2', expectedMagic: '774f4632' },
      { rel: 'public/fonts/vazirmatn.ttf', expectedMagic: '00010000' },
    ];
    for (const f of fontFiles) {
      const abs = path.join(ROOT, f.rel);
      assert.ok(fs.existsSync(abs), `Missing font asset: ${f.rel}`);
      const buf = fs.readFileSync(abs);
      assert.ok(buf.byteLength > 10_000, `Font binary unexpectedly tiny: ${f.rel}`);
      assert.equal(buf.subarray(0, 4).toString('hex'), f.expectedMagic, `Invalid font magic bytes for ${f.rel}`);
    }

    // Ensure index.html no longer has early font preload links that caused pre-mount LINK errors
    const srcIndex = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.ok(!/<link[^>]+rel=["']preload["'][^>]+as=["']font["']/i.test(srcIndex), 'index.html must not contain fatal-prone rel=preload as=font tags');

    if (fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
      const distIndex = fs.readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8');
      const dist404 = fs.readFileSync(path.join(ROOT, 'dist/404.html'), 'utf8');
      assert.equal(dist404, distIndex, 'dist/404.html must match dist/index.html byte-for-byte');
      assert.ok(!dist404.includes('src/main.tsx'), 'dist/404.html must not reference src/main.tsx');
      const stampedBuildId = distIndex.match(/<meta\s+name="minadental-build-id"\s+content="([^"]+)"/i)?.[1];
      assert.ok(stampedBuildId && stampedBuildId !== 'dev-local', `dist/index.html must stamp real buildId, got ${stampedBuildId}`);
    }
  });

  await run('V9-06: CI monotonic sequence fails CLOSED on network failure even with bootstrap authorization; only confirmed initial migration may bootstrap', async () => {
    const unreachableUrl = 'http://127.0.0.1:1/non-existent-release-pointer.json';

    for (const bootstrapFirstRelease of [false, true]) {
      for (const allowLegacyRootMigration of [false, true]) {
        await assert.rejects(
          () => computeMonotonicSequence({
            baseSequence: 65,
            runNumber: 2,
            remotePointerUrl: unreachableUrl,
            requireRemotePointer: true,
            bootstrapFirstRelease,
            allowLegacyRootMigration,
          }),
          /Fail-closed monotonic sequence guard/,
          'Unreachable pointer must never authorize a first release'
        );
      }
    }

    // The positive bootstrap cases (confirmed 404 + raw entry or explicitly
    // authorized empty root), and negative 503/invalid JSON/compiled-root cases
    // are exercised by V8-11 with actual local HTTP responses.
  });

  await run('V9-07: Fail-closed signature verification rejects unsigned manifest whenever pinnedKeys are configured (without explicit requireSignature)', async () => {
    const unsignedPointer: ReleasePointer = {
      schemaVersion: 2,
      channel: 'stable',
      platform: 'web',
      currentReleaseId: 'v5.1.0-1122334455',
      releaseSequence: 101,
      manifestUrl: './releases/v5.1.0-1122334455/release-manifest.json',
      updatedAt: new Date().toISOString(),
      revokedReleaseIds: [],
    };
    const unsignedManifest: AuthoritativeReleaseManifest = {
      schemaVersion: 2,
      releaseId: 'v5.1.0-1122334455',
      releaseSequence: 101,
      semver: '5.1.0',
      gitCommit: 'abcdef1234567890',
      channel: 'stable',
      platform: 'web',
      publishedAt: new Date().toISOString(),
      origin: 'ci_pipeline',
      minSchemaVersion: 1,
      minNativeVersion: '1.0.0',
      contentDigest: '1122334455'.repeat(6) + '1122',
      entryScripts: ['./assets/index.js'],
      entryStyles: ['./assets/index.css'],
      assets: [{ path: './index.html', sha256: 'a'.repeat(64), size: 100, critical: true }],
      urgency: 'standard',
      revoked: false,
      releaseNotes: 'Test unsigned',
      rollbackPolicy: {
        strategy: 'forward_release',
        minRollbackSequence: 100,
        schemaBackwardCompatible: true,
        preserveUserData: true,
      },
    };

    const dummyAdapter: PlatformUpdateAdapter = {
      getCapabilities: () => ({
        platform: 'pwa',
        supportsWebSwUpdates: true,
        supportsNativeStoreRedirect: false,
        isBundledWebView: false,
      }),
      getCurrentRuntimeIdentity: () => ({
        releaseId: 'v5.0.0-0000000000',
        releaseSequence: 100,
        semver: '5.0.0',
        channel: 'stable',
        platform: 'pwa',
        contentDigest: '0'.repeat(64),
      }),
      stageAndVerify: async () => ({ ok: true, verifiedAssetsCount: 1, workerVerified: true }),
      activateTargetRelease: async () => ({ ok: true, triggeredReload: false }),
      verifyPostBootHandshake: async () => ({ verified: true, runtimeBuildId: 'v5.0.0-0000000000', workerBuildId: 'v5.0.0-0000000000' }),
      cleanupObsoleteCaches: async () => undefined,
    };

    const memStore = new Map<string, string>();
    const ledger = new UpdateLedger({
      getItem: (k) => memStore.get(k) ?? null,
      setItem: (k, v) => memStore.set(k, v),
      removeItem: (k) => memStore.delete(k),
    });

    const coordinator = new UpdateCoordinator({
      adapter: dummyAdapter,
      ledger,
      pinnedKeys: [
        {
          keyId: 'k1',
          algorithm: 'ECDSA-P256-SHA256',
          status: 'active',
          jwk: { kty: 'EC', crv: 'P-256', x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', y: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
        },
      ],
      // Deliberately OMIT requireSignature to test V9 fail-closed default!
      manifestClient: {
        pointerUrl: 'https://galaxy1364.github.io/Dendalcare/release-pointer.json',
        fetchFn: (async (url: string | URL) => {
          const s = String(url);
          if (s.includes('release-pointer.json')) {
            return new Response(JSON.stringify(unsignedPointer), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          return new Response(JSON.stringify(unsignedManifest), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }) as typeof fetch,
      },
      isOnlineFn: () => true,
    });

    const snap = await coordinator.checkForUpdates('manual');
    assert.equal(snap.state, 'CHECK_FAILED', 'Unsigned manifest must fail closed when pinnedKeys exist');
    assert.equal(snap.error?.code, 'SIGNATURE_INVALID');
  });

  return results;
}
