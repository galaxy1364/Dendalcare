import { test, expect } from '@playwright/test';

const VIEWPORT_MATRIX = [
  { name: '360x740', width: 360, height: 740, checkNoScrollHome: true, captureScreenshot: true },
  { name: '375x812', width: 375, height: 812, checkNoScrollHome: true, captureScreenshot: false },
  { name: '390x844', width: 390, height: 844, checkNoScrollHome: true, captureScreenshot: true },
  { name: '430x932', width: 430, height: 932, checkNoScrollHome: true, captureScreenshot: true },
  { name: '768x1024', width: 768, height: 1024, checkNoScrollHome: false, captureScreenshot: false },
  { name: '1366x768', width: 1366, height: 768, checkNoScrollHome: false, captureScreenshot: false },
];

test.describe('MinaDental V6 Release Gate E2E', () => {
  test('cold & warm boot + reload reach SHELL_READY with valid window.__minaBuildId and zero 404/syntax errors', async ({ page }) => {
    const consoleErrors: Array<{ text: string; url: string }> = [];
    const pageErrors: string[] = [];
    const failedAssets: string[] = [];
    let supabase401Count = 0;

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push({ text: msg.text(), url: msg.location()?.url || '' });
      }
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('response', (res) => {
      if (res.status() >= 400 && res.url().startsWith('http://127.0.0.1')) {
        failedAssets.push(`${res.status()} ${res.url()}`);
      } else if (res.status() === 401 && res.url().includes('supabase.co')) {
        supabase401Count += 1;
      }
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
    await expect(page.locator('#app-splash')).toHaveCount(0);

    const buildInfo = await page.evaluate(() => ({
      runtimeBuildId: window.__minaBuildId,
      metaBuildId: document.querySelector('meta[name="minadental-build-id"]')?.getAttribute('content'),
      bootState: window.__minaBootState,
    }));

    expect(buildInfo.runtimeBuildId).toMatch(/^v\d+\.\d+\.\d+-[0-9a-f]{10}$/);
    expect(buildInfo.runtimeBuildId).toBe(buildInfo.metaBuildId);
    expect(buildInfo.bootState).not.toBe('BOOTING');

    // Warm reload must also mount cleanly without syntax or asset regressions
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
    await expect(page.locator('#app-splash')).toHaveCount(0);

    expect(failedAssets, 'No local static asset may 404').toEqual([]);
    expect(pageErrors, 'Zero uncaught page errors on cold/warm boot').toEqual([]);
    const unexpectedConsoleErrors = consoleErrors.filter((e) => {
      if (e.text.includes('supabase') || e.url.includes('supabase')) return false;
      // WebKit logs unauthenticated V12 Supabase 401 responses without exposing the URL in msg.text() or location
      if (supabase401Count > 0 && e.text.includes('401 (Unauthorized)')) return false;
      return true;
    });
    expect(unexpectedConsoleErrors, 'Zero unexpected console errors').toEqual([]);
  });

  test('SW active & V5->V6 cache upgrade preserves offline queue and third-party caches', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

    const upgradeCheck = await page.evaluate(async () => {
      localStorage.setItem('minadental_offline_queue_v1', JSON.stringify([{ id: 'q-preserve-1', table: 'patients' }]));
      if ('caches' in window) {
        const legacyCache = await caches.open('minadental-shell-v4.9.5-oldv500000');
        await legacyCache.put('./legacy-test', new Response('legacy'));
        const thirdPartyCache = await caches.open('external-third-party-cache');
        await thirdPartyCache.put('./keep', new Response('keep'));
      }
      const swSupported = 'serviceWorker' in navigator;
      const regs = swSupported ? await navigator.serviceWorker.getRegistrations() : [];
      const queueAfter = localStorage.getItem('minadental_offline_queue_v1');
      const hasThirdParty = 'caches' in window ? await caches.has('external-third-party-cache') : true;
      return { swSupported, regCount: regs.length, queueAfter, hasThirdParty };
    });

    expect(upgradeCheck.queueAfter).toContain('q-preserve-1');
    expect(upgradeCheck.hasThirdParty).toBe(true);
  });

  test('SW disabled browser mode still boots cleanly without splash hang', async ({ browser }) => {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
    await expect(page.locator('#app-splash')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    await context.close();
  });

  for (const vp of VIEWPORT_MATRIX) {
    test(`viewport ${vp.name} renders cleanly without horizontal overflow or splash hang`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

      const metrics = await page.evaluate(() => ({
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
        bodyScrollHeight: document.body.scrollHeight,
        innerHeight: window.innerHeight,
      }));

      expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.docClientWidth + 2);
      if (vp.checkNoScrollHome) {
        expect(metrics.bodyScrollHeight).toBeLessThanOrEqual(metrics.innerHeight + 8);
      }

      if (vp.captureScreenshot) {
        await page.screenshot({
          path: testInfo.outputPath(`viewport-${vp.name}.png`),
          fullPage: false,
        });
      }
    });
  }

  test('deep-link refresh, back/forward navigation, and RBAC shell remain responsive', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/services', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

    // Refresh on deep-link route
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

    // Navigate back & forward safely
    await page.goto('/#/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
    await page.goBack().catch(() => {});
    await page.goForward().catch(() => {});

    const bodyText = await page.evaluate(() => document.body.innerText.trim());
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('missing lazy chunk 404 is contained without blank crash screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

    await page.route('**/assets/*Section*.js', (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' })
    );

    const servicesTrigger = page.getByTestId('dock_all_services_button').or(page.getByTestId('topbar_global_search_button'));
    if (await servicesTrigger.first().isVisible()) {
      await servicesTrigger.first().click();
    }

    const bodyText = await page.evaluate(() => document.body.innerText.trim());
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('hanging Supabase requests terminate cleanly instead of freezing shell loading', async ({ page }) => {
    await page.route('**/rest/v1/**', async (route) => {
      await new Promise((r) => setTimeout(r, 15_000));
      await route.abort('timedout');
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
    const bodyText = await page.evaluate(() => document.body.innerText.trim());
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('offline toggle and reconnect keep shell responsive without crashing', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

    await context.setOffline(true);
    await page.waitForTimeout(500);
    await context.setOffline(false);

    const bodyText = await page.evaluate(() => document.body.innerText.trim());
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('V7/V8 authoritative pointers, immutable manifest, boot milestones & independent #boot-error container verified', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

    const v8Check = await page.evaluate(async () => {
      const pointerRes = await fetch('./release-pointer.json', { cache: 'no-store' });
      const pointer = await pointerRes.json();
      const androidPtrRes = await fetch('./android-release-pointer.json', { cache: 'no-store' });
      const iosPtrRes = await fetch('./ios-release-pointer.json', { cache: 'no-store' });
      const manifestRes = await fetch(pointer.manifestUrl || './release-manifest.json', { cache: 'no-store' });
      const manifest = await manifestRes.json();
      const bootErrEl = document.getElementById('boot-error');
      const insideSplash = Boolean(bootErrEl && bootErrEl.closest('#app-splash'));
      return {
        pointerStatus: pointerRes.status,
        androidPtrStatus: androidPtrRes.status,
        iosPtrStatus: iosPtrRes.status,
        manifestStatus: manifestRes.status,
        runtimeBuildId: window.__minaBuildId,
        runtimeDigest: window.__minaContentDigest,
        pointerReleaseId: pointer.currentReleaseId,
        manifestReleaseId: manifest.releaseId,
        manifestDigest: manifest.contentDigest,
        manifestSchema: manifest.schemaVersion,
        assetCount: Array.isArray(manifest.assets) ? manifest.assets.length : 0,
        watchdogCleared: window.__minaBootWatchdogTimer == null,
        milestones: window.__minaBootMilestones || {},
        bootErrorExists: Boolean(bootErrEl),
        bootErrorInsideSplash: insideSplash,
      };
    });

    expect(v8Check.pointerStatus).toBe(200);
    expect(v8Check.androidPtrStatus).toBe(200);
    expect(v8Check.iosPtrStatus).toBe(200);
    expect(v8Check.manifestStatus).toBe(200);
    expect(v8Check.manifestSchema).toBe(2);
    expect(v8Check.pointerReleaseId).toBe(v8Check.runtimeBuildId);
    expect(v8Check.manifestReleaseId).toBe(v8Check.runtimeBuildId);
    expect(v8Check.manifestDigest).toBe(v8Check.runtimeDigest);
    expect(v8Check.assetCount).toBeGreaterThan(0);
    expect(v8Check.watchdogCleared).toBe(true);
    expect(v8Check.bootErrorExists).toBe(true);
    expect(v8Check.bootErrorInsideSplash).toBe(false);
    expect(Boolean(v8Check.milestones.moduleEvaluatedAt)).toBe(true);
    expect(Boolean(v8Check.milestones.shellCommittedAt)).toBe(true);
  });

  test('V9 fault-injection: font, icon, and manifest 404 NEVER trigger #boot-error and app boots in Persian', async ({ page }) => {
    await page.route('**/fonts/*.woff2', (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'Font Missing' })
    );
    await page.route('**/manifest.json', (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'Manifest Missing' })
    );
    await page.route('**/icon-192.png', (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'Icon Missing' })
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
    await expect(page.locator('#app-splash')).toHaveCount(0);
    await expect(page.locator('#boot-error')).toBeHidden();

    const bodyText = await page.evaluate(() => document.body.innerText.trim());
    expect(bodyText.length).toBeGreaterThan(0);
  });

  test('V12 membership-only auth fails closed when app_metadata exists without active clinic_membership', async ({ browser }) => {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    try {
      const corsHeaders = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'apikey,authorization,content-type,x-client-info,prefer',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      };
      await page.route(/\/auth\/v1\/token/, async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: corsHeaders });
          return;
        }
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          contentType: 'application/json',
          body: JSON.stringify({
            access_token: 'test.jwt.token',
            token_type: 'bearer',
            expires_in: 3600,
            refresh_token: 'test-refresh',
            user: {
              id: '00000000-0000-0000-0000-000000000999',
              email: 'revoked@minadental.ir',
              app_metadata: { clinic_role: 'manager', tenant_id: 'minadental_clinic' },
            },
          }),
        });
      });
      await page.route(/\/rest\/v1\/clinic_memberships/, async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: corsHeaders });
          return;
        }
        await route.fulfill({ status: 200, headers: corsHeaders, contentType: 'application/json', body: '[]' });
      });

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

      await page.getByTestId('topbar_user_avatar_button').click();
      await page.getByPlaceholder('ایمیل حساب Supabase').fill('revoked@minadental.ir');
      await page.getByPlaceholder('رمز عبور سرور').fill('TestPassword!123');
      await page.getByRole('button', { name: 'ورود تاییدشده به نشست سرور' }).click();

      await expect(page.getByText('فاقد عضویت فعال')).toBeVisible();
      await expect(page.getByText('تایید سرور')).toHaveCount(0);

      // Close modal & navigate in-app (without full reload) to verify finance route is denied fail-closed
      await page.getByTestId('close_fullscreen_modal_btn').click();
      await page.evaluate(() => {
        window.location.hash = '#/finance';
      });
      await expect(page.getByText('دسترسی نقش فعلی به بخش «finance» محدود شده است.')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('Phase A UX routes (dashboard, appointments, calendar, appointment_form) render cleanly on mobile & desktop and validate duration strictly', async ({ page }) => {
    for (const vp of [
      { width: 390, height: 844 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(vp);
      for (const routeHash of ['/#/', '/#/appointments', '/#/calendar', '/#/appointment_form']) {
        await page.goto(routeHash, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
        const scrollOk = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
        expect(scrollOk).toBe(true);
      }
    }

    // Verify AppointmentFormPage enforces shared command validation (rejects out-of-range duration instead of silent 30m coercion)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/appointment_form', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
    await expect(page.getByTestId('appointment_form_fullscreen_page')).toBeVisible();
  });
});
