import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {
  UpdateCoordinator,
  UpdateLedger,
  WebPwaUpdateAdapter,
  type AuthoritativeReleaseManifest,
  type ReleasePointer,
  type RuntimeReleaseIdentity,
  type StorageLike,
} from '../src/services/updates';
import {
  ACTIVE_BRANCH_KEY,
  getVerifiedSupabaseSession,
  resolveMembershipSession,
  setRuntimeAuthSnapshot,
} from '../src/services/authentication/authService';
import {
  createGuardedSupabaseClient,
  evaluateMutationGuard,
} from '../src/lib/supabaseGuardian';

export interface Ge0002TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

class MemoryStorage implements StorageLike {
  private readonly store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

class MemoryCache {
  private readonly entries = new Map<string, Response>();
  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const key = typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url;
    this.entries.set(key, response.clone());
  }
  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const key = typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url;
    const hit = this.entries.get(key);
    return hit ? hit.clone() : undefined;
  }
  async keys(): Promise<Array<{ url: string }>> {
    return Array.from(this.entries.keys()).map((url) => ({ url }));
  }
  getEntryKeys(): string[] {
    return Array.from(this.entries.keys());
  }
}

class MemoryCacheStorage {
  private readonly cachesMap = new Map<string, MemoryCache>();
  async open(cacheName: string): Promise<Cache> {
    let cache = this.cachesMap.get(cacheName);
    if (!cache) {
      cache = new MemoryCache();
      this.cachesMap.set(cacheName, cache);
    }
    return cache as unknown as Cache;
  }
  async has(cacheName: string): Promise<boolean> {
    return this.cachesMap.has(cacheName);
  }
  async delete(cacheName: string): Promise<boolean> {
    return this.cachesMap.delete(cacheName);
  }
  async keys(): Promise<string[]> {
    return Array.from(this.cachesMap.keys());
  }
  async match(): Promise<Response | undefined> {
    return undefined;
  }
  getCache(cacheName: string): MemoryCache | undefined {
    return this.cachesMap.get(cacheName);
  }
}

function sha256Hex(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function createReleaseBundle(opts: {
  semver: string;
  releaseSequence: number;
  seed: string;
  staleRootAsset?: boolean;
  tamperSizeOnVersionedAsset?: boolean;
}): {
  releaseId: string;
  pointer: ReleasePointer;
  manifest: AuthoritativeReleaseManifest;
  files: Record<string, { body: Buffer; contentType: string }>;
} {
  const entryJs = Buffer.from(`console.log("minadental-${opts.seed}-${opts.releaseSequence}");\n`, 'utf8');
  const entryCss = Buffer.from(`:root{--seed:"${opts.seed}";}\n`, 'utf8');
  const indexHtml = Buffer.from(
    `<!doctype html><html lang="fa" dir="rtl"><head><meta name="minadental-build-id" content="v${opts.semver}-0000000000"></head><body>MinaDental ${opts.releaseSequence}</body></html>`,
    'utf8'
  );
  const shortHash = sha256Hex(`${opts.semver}:${opts.seed}:${opts.releaseSequence}`).slice(0, 10);
  const releaseId = `v${opts.semver}-${shortHash}`;
  const jsRel = `./assets/app-${shortHash}.js`;
  const cssRel = `./assets/app-${shortHash}.css`;
  const contentDigest = sha256Hex(Buffer.concat([entryJs, entryCss, indexHtml]));

  const assets = [
    {
      path: './index.html',
      sha256: sha256Hex(indexHtml),
      size: indexHtml.byteLength,
      critical: true,
      contentType: 'text/html; charset=utf-8',
    },
    {
      path: jsRel,
      sha256: sha256Hex(entryJs),
      size: entryJs.byteLength,
      critical: true,
      contentType: 'application/javascript; charset=utf-8',
    },
    {
      path: cssRel,
      sha256: sha256Hex(entryCss),
      size: entryCss.byteLength,
      critical: true,
      contentType: 'text/css; charset=utf-8',
    },
  ];

  const manifest: AuthoritativeReleaseManifest = {
    schemaVersion: 2,
    releaseId,
    releaseSequence: opts.releaseSequence,
    semver: opts.semver,
    gitCommit: sha256Hex(opts.seed).slice(0, 40),
    channel: 'stable',
    platform: 'web',
    minNativeVersion: '4.9.0',
    minSchemaVersion: 4,
    publishedAt: new Date().toISOString(),
    contentDigest,
    releaseNotes: `نسخه ${opts.semver} (#${opts.releaseSequence})`,
    entryScripts: [jsRel],
    entryStyles: [cssRel],
    assets,
    urgency: 'standard',
    revoked: false,
    origin: 'ci_pipeline',
    rollbackPolicy: {
      strategy: 'forward_release',
      minRollbackSequence: opts.releaseSequence,
      schemaBackwardCompatible: true,
      preserveUserData: true,
    },
  };

  const pointer: ReleasePointer = {
    schemaVersion: 2,
    channel: 'stable',
    platform: 'web',
    currentReleaseId: releaseId,
    releaseSequence: opts.releaseSequence,
    manifestUrl: `./releases/${releaseId}/release-manifest.json`,
    updatedAt: manifest.publishedAt,
    revokedReleaseIds: [],
    minSupportedSequence: 1,
  };

  const versionedJsBody = opts.tamperSizeOnVersionedAsset
    ? Buffer.concat([entryJs, Buffer.from('\n/* extra-bytes-size-tamper */', 'utf8')])
    : entryJs;

  const files: Record<string, { body: Buffer; contentType: string }> = {
    '/release-pointer.json': {
      body: Buffer.from(JSON.stringify(pointer, null, 2), 'utf8'),
      contentType: 'application/json; charset=utf-8',
    },
    [`/releases/${releaseId}/release-manifest.json`]: {
      body: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
      contentType: 'application/json; charset=utf-8',
    },
    [`/releases/${releaseId}/index.html`]: {
      body: indexHtml,
      contentType: 'text/html; charset=utf-8',
    },
    [`/releases/${releaseId}/assets/app-${shortHash}.js`]: {
      body: versionedJsBody,
      contentType: 'application/javascript; charset=utf-8',
    },
    [`/releases/${releaseId}/assets/app-${shortHash}.css`]: {
      body: entryCss,
      contentType: 'text/css; charset=utf-8',
    },
    // Simulate stale root HTML/index if CDN serves old root while immutable /releases/<id>/ is fresh!
    '/index.html': {
      body: opts.staleRootAsset
        ? Buffer.from('<!doctype html><html><body>STALE_CDN_ROOT_HTML</body></html>', 'utf8')
        : indexHtml,
      contentType: 'text/html; charset=utf-8',
    },
  };

  return { releaseId, pointer, manifest, files };
}

async function startHttpFixtureServer(initialFiles: Record<string, { body: Buffer; contentType: string }>) {
  let activeFiles = initialFiles;
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    const hit = activeFiles[pathname];
    if (!hit) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': hit.contentType,
      'Content-Length': String(hit.body.byteLength),
      'Cache-Control': 'no-cache',
    });
    res.end(hit.body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}/`,
    setFiles(nextFiles: Record<string, { body: Buffer; contentType: string }>) {
      activeFiles = nextFiles;
    },
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function readWorkspaceFile(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

export async function runAllGe0002P0RecoveryTests(): Promise<Ge0002TestResult[]> {
  const results: Ge0002TestResult[] = [];
  const runTest = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      results.push({ name, passed: true });
    } catch (err) {
      results.push({
        name,
        passed: false,
        error: err instanceof Error ? err.stack || err.message : String(err),
      });
    }
  };

  // P0 #1 Tests: Manager auth / RBAC / branch auto-recovery / fail-closed strictness
  await runTest('GE-0002 P0-1a: getVerifiedSupabaseSession recovers manager from stale localStorage branch and verifies via RPC', async () => {
    const originalWindow = (globalThis as Record<string, unknown>).window;
    const originalLocalStorage = (globalThis as Record<string, unknown>).localStorage;
    const mem = new MemoryStorage();
    mem.setItem(ACTIVE_BRANCH_KEY, 'north');
    const dispatchedEvents: string[] = [];

    const mockWindow = {
      localStorage: mem,
      dispatchEvent: (evt: { type: string }) => {
        dispatchedEvents.push(evt.type);
        return true;
      },
    };
    (globalThis as Record<string, unknown>).window = mockWindow;
    (globalThis as Record<string, unknown>).localStorage = mem;

    try {
      let rpcArgs: Record<string, unknown> | null = null;
      const mockClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: 'mgr-user-1', email: 'mahdi@minadental.ir' } } },
            error: null,
          }),
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: async () => ({
                data: [
                  {
                    tenant_id: 'minadental_clinic',
                    branch_id: 'main',
                    role: 'manager',
                    active: true,
                    all_branches: false,
                  },
                ],
                error: null,
              }),
            }),
          }),
        }),
        rpc: async (fnName: string, args: Record<string, unknown>) => {
          assert.equal(fnName, 'app_resolve_verified_role');
          rpcArgs = args;
          return { data: 'manager', error: null };
        },
      } as unknown as Parameters<typeof getVerifiedSupabaseSession>[1];

      const session = await getVerifiedSupabaseSession(undefined, mockClient);
      assert.equal(session.status, 'authenticated');
      assert.equal(session.serverVerifiedRole, 'manager');
      assert.equal(session.tenantId, 'minadental_clinic');
      assert.equal(session.branchId, 'main');
      assert.deepEqual(session.accessibleBranches, ['main']);
      assert.deepEqual(rpcArgs, { target_tenant: 'minadental_clinic', target_branch: 'main' });
      assert.equal(mem.getItem(ACTIVE_BRANCH_KEY), 'main');
      assert.ok(dispatchedEvents.includes('minadental-auth-changed'));

      // Strictness preserved when caller explicitly requests an unauthorized branch
      const explicitDenied = resolveMembershipSession({
        userId: 'mgr-user-1',
        email: 'mahdi@minadental.ir',
        requestedBranchId: 'north',
        memberships: [
          {
            tenant_id: 'minadental_clinic',
            branch_id: 'main',
            role: 'manager',
            active: true,
            all_branches: false,
          },
        ],
      });
      assert.equal(explicitDenied.status, 'unauthorized');
      assert.equal(explicitDenied.serverVerifiedRole, null);
    } finally {
      setRuntimeAuthSnapshot({ status: 'unauthenticated', serverVerifiedRole: null, tenantId: null });
      (globalThis as Record<string, unknown>).window = originalWindow;
      (globalThis as Record<string, unknown>).localStorage = originalLocalStorage;
    }
  });

  await runTest('GE-0002 P0-1b: verified manager retains price-edit & delete privileges despite stale local flags while unauthorized/non-manager fail closed', async () => {
    const originalWindow = (globalThis as Record<string, unknown>).window;
    const originalLocalStorage = (globalThis as Record<string, unknown>).localStorage;
    const mem = new MemoryStorage();
    mem.setItem('minadental_active_user_id_v4', 'u1');
    mem.setItem(
      'minadental_clinic_users_v4',
      JSON.stringify([
        {
          id: 'u1',
          role: 'secretary',
          fullName: 'دکتر مهدی امیری',
          permissions: { canEditPricesAfterSave: false, canDeleteCriticalRecords: false },
        },
      ])
    );

    const mockWindow = {
      localStorage: mem,
      dispatchEvent: () => true,
    };
    (globalThis as Record<string, unknown>).window = mockWindow;
    (globalThis as Record<string, unknown>).localStorage = mem;

    try {
      let forwardedUpdate = false;
      let forwardedDelete = false;
      const makeThenable = (exec: () => Promise<unknown>) => ({
        then: (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
          exec().then(onFulfilled, onRejected),
      });

      const fakeRawClient = {
        from: () => ({
          update: () => ({
            eq: () => ({
              select: () =>
                makeThenable(async () => {
                  forwardedUpdate = true;
                  return { data: [{ id: 't1', total_cost: 900000 }], error: null, status: 200 };
                }),
            }),
          }),
          delete: () => ({
            eq: () => ({
              select: () =>
                makeThenable(async () => {
                  forwardedDelete = true;
                  return { data: [{ id: 'p1' }], error: null, status: 200 };
                }),
            }),
          }),
        }),
      } as unknown as Parameters<typeof createGuardedSupabaseClient>[0];

      const guarded = createGuardedSupabaseClient(fakeRawClient);

      // 1) Authenticated verified manager overrides stale localStorage flags and passes mutation guard
      setRuntimeAuthSnapshot({
        status: 'authenticated',
        serverVerifiedRole: 'manager',
        tenantId: 'minadental_clinic',
      });

      const mgrUpd = await guarded.from('treatments').update({ total_cost: 900000 }).eq('id', 't1').select();
      assert.equal(forwardedUpdate, true);
      assert.equal((mgrUpd as { error: unknown }).error, null);

      const mgrDel = await guarded.from('patients').delete().eq('id', 'p1').select();
      assert.equal(forwardedDelete, true);
      assert.equal((mgrDel as { error: unknown }).error, null);

      // 2) Unauthorized session fails closed with MINA_RBAC_LOCK
      forwardedUpdate = false;
      setRuntimeAuthSnapshot({
        status: 'unauthorized',
        serverVerifiedRole: null,
        tenantId: null,
      });
      const deniedRes = await guarded.from('treatments').update({ total_cost: 900000 }).eq('id', 't1').select();
      assert.equal(forwardedUpdate, false);
      assert.equal((deniedRes as { status: number }).status, 403);
      assert.equal((deniedRes as { error: { code?: string } }).error?.code, 'MINA_RBAC_LOCK');

      // 3) Verified secretary stays price-locked on update
      const secCheck = evaluateMutationGuard({
        table: 'payments',
        operation: 'UPDATE',
        payload: { amount: 120000 },
        actor: {
          role: 'secretary',
          fullName: 'منشی کلینیک',
          canEditPricesAfterSave: false,
          canDeleteCriticalRecords: false,
          sessionStatus: 'authenticated',
        },
      });
      assert.equal(secCheck.allowed, false);
    } finally {
      setRuntimeAuthSnapshot({ status: 'unauthenticated', serverVerifiedRole: null, tenantId: null });
      (globalThis as Record<string, unknown>).window = originalWindow;
      (globalThis as Record<string, unknown>).localStorage = originalLocalStorage;
    }
  });

  await runTest('GE-0002 P0-1c: supabaseCore enables persistSession and useRealtimeTable subscribes to minadental-auth-changed', () => {
    const coreSrc = readWorkspaceFile('src/lib/supabaseCore.ts');
    assert.ok(coreSrc.includes('persistSession: true'), 'supabaseCore must persist authenticated session');
    assert.ok(coreSrc.includes('autoRefreshToken: true'), 'supabaseCore must auto-refresh auth tokens');
    assert.ok(coreSrc.includes('storageKey: SUPABASE_AUTH_STORAGE_KEY'), 'supabaseCore must bind namespace storageKey');

    const rtSrc = readWorkspaceFile('src/lib/useRealtimeTable.ts');
    assert.ok(rtSrc.includes('getActiveTenantId()'), 'useRealtimeTable must read authoritative active tenantId');
    assert.ok(rtSrc.includes('minadental-auth-changed'), 'useRealtimeTable must react to verified auth state transitions');

    const roleFiles = [
      'src/features/patients/PatientClinicalTabs.tsx',
      'src/components/sections/Patients.tsx',
      'src/components/sections/TreatmentForm.tsx',
      'src/components/ui/ConsentModal.tsx',
      'src/components/PalmerChart.tsx',
    ];
    for (const file of roleFiles) {
      const src = readWorkspaceFile(file);
      assert.ok(src.includes('resolveEffectiveRole('), `${file} must resolve role via resolveEffectiveRole`);
      assert.ok(!src.includes("|| 'manager'"), `${file} must not hardcode || 'manager' fallback`);
      assert.ok(!src.includes("|| 'dentist'"), `${file} must not hardcode || 'dentist' fallback`);
    }
  });

  // P0 #2 Tests: SIZE_MISMATCH root fix + real A -> B HTTP staging/activation + SW bypass
  await runTest('GE-0002 P0-2a: real HTTP A -> B release install resolves assets from immutable /releases/<id>/ even when root HTML is stale CDN', async () => {
    const bundleA = createReleaseBundle({ semver: '4.9.6', releaseSequence: 109, seed: 'release-a' });
    const bundleB = createReleaseBundle({
      semver: '4.9.6',
      releaseSequence: 110,
      seed: 'release-b',
      staleRootAsset: true, // stale root /index.html must NOT cause SIZE_MISMATCH when manifestUrl points to /releases/<id>/!
    });

    const server = await startHttpFixtureServer(bundleB.files);
    try {
      const storage = new MemoryStorage();
      const cacheStorage = new MemoryCacheStorage();
      let currentRuntime: RuntimeReleaseIdentity = {
        releaseId: bundleA.releaseId,
        contentDigest: bundleA.manifest.contentDigest ?? null,
        releaseSequence: 109,
        semver: '4.9.6',
        embeddedSemver: '4.9.6',
        embeddedSequence: 109,
        channel: 'stable',
        platform: 'web',
        schemaVersion: 4,
        origin: 'ci_pipeline',
      };

      const adapter = new WebPwaUpdateAdapter({
        fetchFn: globalThis.fetch.bind(globalThis),
        cacheStorage: cacheStorage as unknown as CacheStorage,
        getRuntimeIdentityFn: () => currentRuntime,
        reloadFn: () => {
          currentRuntime = {
            ...currentRuntime,
            releaseId: bundleB.releaseId,
            contentDigest: bundleB.manifest.contentDigest ?? null,
            releaseSequence: 110,
            embeddedSequence: 110,
          };
        },
      });

      const ledger = new UpdateLedger(storage);
      const coordinator = new UpdateCoordinator({
        adapter,
        ledger,
        baseUrl: server.baseUrl,
        requireSignature: false,
        manifestClient: {
          pointerUrl: `${server.baseUrl}release-pointer.json`,
          currentOrigin: new URL(server.baseUrl).origin,
          maxRetries: 0,
        },
      });

      const checkSnap = await coordinator.checkForUpdates('manual');
      assert.equal(checkSnap.state, 'AVAILABLE');

      const stageSnap = await coordinator.downloadAndVerifyCandidate();
      assert.equal(
        stageSnap.state,
        'READY_TO_ACTIVATE',
        `Expected READY_TO_ACTIVATE, got ${stageSnap.state}: ${JSON.stringify(stageSnap.error)}`
      );

      const stagedCache = cacheStorage.getCache(`minadental-shell-${bundleB.releaseId}`);
      assert.ok(stagedCache, 'Candidate release cache must be populated with verified assets');
      const cachedIndex = await stagedCache.match('./index.html');
      assert.ok(cachedIndex);
      const cachedIndexText = await cachedIndex.text();
      assert.ok(!cachedIndexText.includes('STALE_CDN_ROOT_HTML'), 'Must cache immutable release index.html, not stale CDN root');

      const actSnap = await coordinator.activateVerifiedCandidate({ allowReload: true });
      assert.equal(actSnap.state, 'BOOT_VERIFYING');

      // Re-instantiate coordinator on post-reload boot (Build B now running)
      const coordinatorAfterReload = new UpdateCoordinator({
        adapter,
        ledger: new UpdateLedger(storage),
        baseUrl: server.baseUrl,
        requireSignature: false,
        manifestClient: {
          pointerUrl: `${server.baseUrl}release-pointer.json`,
          currentOrigin: new URL(server.baseUrl).origin,
        },
      });
      const bootSnap = await coordinatorAfterReload.verifyPostBoot();
      assert.equal(bootSnap.state, 'INSTALLED');
      assert.equal(bootSnap.installed.releaseId, bundleB.releaseId);
    } finally {
      await server.close();
    }
  });

  await runTest('GE-0002 P0-2b: byte-size tampering is still strictly rejected with SIZE_MISMATCH + diagnostics', async () => {
    const bundleA = createReleaseBundle({ semver: '4.9.6', releaseSequence: 109, seed: 'base-a' });
    const bundleTampered = createReleaseBundle({
      semver: '4.9.6',
      releaseSequence: 111,
      seed: 'tampered-b',
      tamperSizeOnVersionedAsset: true,
    });

    const server = await startHttpFixtureServer(bundleTampered.files);
    try {
      const storage = new MemoryStorage();
      const cacheStorage = new MemoryCacheStorage();
      const adapter = new WebPwaUpdateAdapter({
        fetchFn: globalThis.fetch.bind(globalThis),
        cacheStorage: cacheStorage as unknown as CacheStorage,
        getRuntimeIdentityFn: () => ({
          releaseId: bundleA.releaseId,
          contentDigest: bundleA.manifest.contentDigest ?? null,
          releaseSequence: 109,
          semver: '4.9.6',
          embeddedSemver: '4.9.6',
          embeddedSequence: 109,
          channel: 'stable',
          platform: 'web',
          schemaVersion: 4,
          origin: 'ci_pipeline',
        }),
      });

      const coordinator = new UpdateCoordinator({
        adapter,
        ledger: new UpdateLedger(storage),
        baseUrl: server.baseUrl,
        requireSignature: false,
        manifestClient: {
          pointerUrl: `${server.baseUrl}release-pointer.json`,
          currentOrigin: new URL(server.baseUrl).origin,
          maxRetries: 0,
        },
      });

      const checkSnap = await coordinator.checkForUpdates('manual');
      assert.equal(checkSnap.state, 'AVAILABLE');
      const stageSnap = await coordinator.downloadAndVerifyCandidate();
      assert.equal(stageSnap.state, 'FAILED');
      assert.equal(stageSnap.error?.code, 'SIZE_MISMATCH');
      assert.ok(
        stageSnap.error?.technicalDetail.includes('content-encoding='),
        'SIZE_MISMATCH must preserve rich network/cache diagnostics'
      );
      assert.equal(
        await cacheStorage.has(`minadental-shell-${bundleTampered.releaseId}`),
        false,
        'Tampered candidate cache must be discarded fail-closed'
      );
    } finally {
      await server.close();
    }
  });

  await runTest('GE-0002 P0-2c: public/sw.js bypasses cache on no-store / reload / immutable releases paths', () => {
    const swSrc = readWorkspaceFile('public/sw.js');
    assert.ok(swSrc.includes("request.cache === 'no-store'"), 'sw.js must bypass cache for cache: no-store requests');
    assert.ok(swSrc.includes("request.cache === 'reload'"), 'sw.js must bypass cache for cache: reload requests');
    assert.ok(swSrc.includes("url.pathname.includes('/releases/')"), 'sw.js must bypass stale shell cache for immutable /releases/ URLs');
  });

  // GE-0002 Shell, Visual Remediation & Dark-Mode Parity Source Checks
  await runTest('GE-0002 Adaptive Shell & Screenshot Remediation contracts present across Shell, Dock, Bell, Settings, Drawer & Forms', () => {
    const appShell = `${readWorkspaceFile('src/app/AppShell.tsx')}\n${readWorkspaceFile('src/app/shell/AdaptiveTopBar.tsx')}`;
    assert.ok(appShell.includes('px-2 sm:px-3'), 'AppShell main must use edge-to-edge balanced horizontal padding');
    assert.ok(appShell.includes('{canGoBack && ('), 'AppShell topbar_back_button must gate strictly on canGoBack');
    assert.ok(appShell.includes('onChange={(id) => navigate(id, undefined, { rootTab: true })}'), 'AppShell dock & rail must switch root tabs without creating fake back history');
    assert.ok(appShell.includes('data-testid="topbar_brand_logo_button"'), 'AppShell must keep MascotTooth prominent across all mobile routes');

    const navStack = readWorkspaceFile('src/navigation/NavigationStack.tsx');
    assert.ok(navStack.includes('SUB_FLOW_ROUTES'), 'NavigationStack must distinguish genuine sub-flow routes from primary dock tabs');
    assert.ok(
      navStack.includes('canGoBack: history.length > 0 || SUB_FLOW_ROUTES.has(activeRoute)'),
      'canGoBack must only activate on genuine sub-flows or pushed drill-down history'
    );

    const bell = readWorkspaceFile('src/components/ui/DraggableNotificationHandle.tsx');
    assert.ok(bell.includes("width: '30px'"), 'Bell ear SVG width must be slimmed to 30px to avoid covering controls');
    assert.ok(bell.includes('right-bell-ear-path'), 'Bell ear must expose dark-mode styling hook');

    const dock = readWorkspaceFile('src/navigation/FloatingDock.tsx');
    assert.ok(dock.includes('min-h-[58px]'), 'FloatingDock primary bar must align at 58px height');
    assert.ok(dock.includes('w-[58px] h-[58px]'), 'dock_more_button must match 58px circular geometry');
    assert.ok(dock.includes('env(safe-area-inset-bottom'), 'FloatingDock must respect bottom safe-area inset');

    const settings = readWorkspaceFile('src/components/sections/SettingsSection.tsx');
    assert.ok(settings.includes('useClinicShell()'), 'SettingsSection must use authoritative AppProviders branch/role context');
    assert.ok(settings.includes('rtl-bidi-isolate'), 'installed_build_badge must isolate LTR tokens inside RTL layout');
    assert.ok(settings.includes('settings-update-center-card'), 'Update Center card must use theme-aware CSS token class');

    const sheet = readWorkspaceFile('src/components/ui/Sheet.tsx');
    assert.ok(sheet.includes('--keyboard-inset-bottom'), 'Sheet scroll area must adjust bottom padding for virtual keyboard');
    assert.ok(sheet.includes('dark:bg-[#11202E]'), 'Sheet must provide dark mode parity');

    const drawer = readWorkspaceFile('src/components/ui/NotificationDrawer.tsx');
    assert.ok(drawer.includes('dark:bg-[#11202E]'), 'NotificationDrawer must provide dark mode parity');

    const form = readWorkspaceFile('src/components/ui/Form.tsx');
    assert.ok(form.includes('dark:bg-[#11202E]'), 'Form inputs must provide dark mode parity');

    const css = readWorkspaceFile('src/index.css');
    assert.ok(css.includes('.rtl-bidi-isolate'), 'index.css must define .rtl-bidi-isolate');
    assert.ok(css.includes(':focus-visible'), 'index.css must define WCAG 2.2 AA :focus-visible outline');
    assert.ok(css.includes('[data-keyboard-open="true"]'), 'index.css must adapt shell when software keyboard is open');
  });

  return results;
}
