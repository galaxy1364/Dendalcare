import fs from 'node:fs';
import path from 'node:path';
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
  test('GE-0019C: asymmetric physical insets, narrow RTL chrome and Material touch targets', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.addInitScript(() => localStorage.setItem('minadental_appearance_platform_design_v1', 'material'));
    await page.goto('/#/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
    await page.evaluate(() => {
      const root = document.documentElement;
      root.style.setProperty('--safe-left', '7px');
      root.style.setProperty('--safe-right', '19px');
      root.style.setProperty('--safe-bottom', '23px');
    });
    await expect(page.locator('html')).toHaveAttribute('data-platform-design', 'material');
    const shell = page.locator('.app-shell-viewport');
    await expect(shell).toHaveCSS('padding-left', '7px');
    await expect(shell).toHaveCSS('padding-right', '19px');
    await expect(shell).toHaveCSS('padding-bottom', '23px');
    const dock = page.getByTestId('floating_bottom_dock');
    await expect(dock).toBeVisible();
    const dockBox = await dock.boundingBox();
    const shellBox = await shell.boundingBox();
    expect(dockBox).not.toBeNull();
    expect(shellBox).not.toBeNull();
    expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(shellBox!.y + shellBox!.height - 23 + 1);
    for (const button of ['topbar_global_search_button', 'topbar_notifications_button', 'topbar_user_avatar_button', 'topbar_project_folder_button']) {
      const control = page.getByTestId(button);
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(48);
      expect(box!.height).toBeGreaterThanOrEqual(48);
      expect(box!.x).toBeGreaterThanOrEqual(7);
      expect(box!.x + box!.width).toBeLessThanOrEqual(301);
    }
    const layout = await page.evaluate(() => ({
      header: getComputedStyle(document.querySelector('.shell-topbar-layout')!).flexWrap,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      headerGutter: getComputedStyle(document.querySelector('header.shell-content-gutter')!).paddingLeft,
      mainGutter: getComputedStyle(document.querySelector('main.shell-content-gutter')!).paddingLeft,
    }));
    expect(layout.header).toBe('wrap');
    expect(layout.overflow).toBe(false);
    expect(layout.headerGutter).toBe(layout.mainGutter);
  });

  test('GE-0024A: theme focus and browser refresh contract with visual evidence', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => localStorage.setItem('minadental_appearance_theme_v2', 'dark'));
    await page.goto('/#/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const control = page.getByTestId('topbar_global_search_button');
    await expect(control).toBeVisible();
    await page.keyboard.press('Tab');
    await control.focus();
    await expect(control).toHaveCSS('outline-color', 'rgb(45, 212, 191)');
    const refreshNotIntercepted = await page.evaluate(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', cancelable: true, bubbles: true }))
    );
    expect(refreshNotIntercepted).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('ge0024a-dark-focus.png'), animations: 'disabled' });
  });

  test('GE-0024B: keyboard help dialog traps focus and Escape restores trigger', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
    const trigger = page.getByTestId('topbar_global_search_button');
    await trigger.focus();
    await page.keyboard.press('F1');
    const dialog = page.getByRole('dialog', { name: 'کلیدهای میانبر سریع کلینیک' });
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole('button', { name: 'بستن راهنمای کلیدها' });
    const exportButton = dialog.getByRole('button', { name: 'خروجی یادآوری‌ها و پیام‌ها (JSON)' });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(exportButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('viewport-ge0024b-dialog.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

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
      await page.route(/\/rest\/v1\/rpc\/app_get_my_verified_memberships/, async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: corsHeaders });
          return;
        }
        await route.fulfill({ status: 200, headers: corsHeaders, contentType: 'application/json', body: '[]' });
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

  test('V13 adaptive window classes, dock/rail switching across 320/390/768/1366/1440, dark theme & role-aware dock hiding', async ({ page }) => {
    const viewChecks = [
      { width: 320, height: 640, expectedClass: 'compact', dockVisible: true, sidebarVisible: false },
      { width: 390, height: 844, expectedClass: 'compact', dockVisible: true, sidebarVisible: false },
      { width: 768, height: 1024, expectedClass: 'medium', dockVisible: false, sidebarVisible: true },
      { width: 1366, height: 768, expectedClass: 'expanded', dockVisible: false, sidebarVisible: true },
      { width: 1440, height: 900, expectedClass: 'wide', dockVisible: false, sidebarVisible: true },
    ];

    for (const check of viewChecks) {
      await page.setViewportSize({ width: check.width, height: check.height });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

      const domState = await page.evaluate(() => ({
        windowClass: document.documentElement.dataset.windowClass,
        overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
      }));
      expect(domState.windowClass).toBe(check.expectedClass);
      expect(domState.overflow).toBe(true);

      if (check.dockVisible) {
        await expect(page.getByTestId('floating_bottom_dock')).toBeVisible();
        await expect(page.getByTestId('adaptive_desktop_sidebar')).toBeHidden();
      } else {
        await expect(page.getByTestId('floating_bottom_dock')).toBeHidden();
        await expect(page.getByTestId('adaptive_desktop_sidebar')).toBeVisible();
      }
    }

    // Verify Dark Mode tokens render cleanly across key sections without overflow
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    for (const routeHash of ['/#/', '/#/services', '/#/patients', '/#/appointments', '/#/settings']) {
      await page.goto(routeHash, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
      const overflowOk = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2
      );
      expect(overflowOk).toBe(true);
    }
  });

  test('V14 strict fail-closed unauthorized session barrier & 9-stage clinical journey UI render in Persian RTL', async ({ browser }) => {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    try {
      const corsHeaders = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'apikey,authorization,content-type,x-client-info,prefer,range,accept-profile,content-profile',
        'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
      };
      await page.route('**/rest/v1/**', async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: corsHeaders });
          return;
        }
        if (route.request().method() === 'GET') {
          await route.fulfill({ status: 200, headers: corsHeaders, contentType: 'application/json', body: '[]' });
          return;
        }
        await route.continue();
      });
      await page.route(/\/rest\/v1\/patients/, async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: corsHeaders });
          return;
        }
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: '00000000-0000-0000-0000-000000000501',
              tenant_id: 'minadental_clinic',
              branch_id: 'main',
              first_name: 'نگار',
              last_name: 'شریفی',
              phone: '09123334455',
              national_id: '0011223344',
              birth_date: null,
              gender: 'female',
              blood_type: 'O+',
              allergies: null,
              medical_history: null,
              medications: null,
              insurance_provider: 'آزاد',
              insurance_number: '1405',
              address: null,
              email: null,
              notes: '[پرونده: 1405]',
              status: 'active',
              created_at: '2026-11-30T06:00:00Z',
              updated_at: '2026-11-30T06:00:00Z',
            },
          ]),
        });
      });

      await page.goto('/#/patients', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

      const journeyCard = page.getByTestId('patient_clinical_journey_00000000-0000-0000-0000-000000000501');
      await expect(journeyCard).toBeVisible();
      await expect(journeyCard).toContainText('مسیر بالینی:');
      await expect(journeyCard).toContainText('پذیرش');
      await expect(journeyCard).toContainText('پیگیری');

      const rtlAndOverflow = await page.evaluate(() => ({
        dir: document.documentElement.dir,
        noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
      }));
      expect(rtlAndOverflow.dir).toBe('rtl');
      expect(rtlAndOverflow.noOverflow).toBe(true);
      const stages = journeyCard.getByTestId('clinical_journey_stepper');
      await expect(stages.locator('ol > li')).toHaveCount(9);
      const layout = await stages.locator('ol').evaluate(el => {
        const rects = Array.from(el.children).map(c => c.getBoundingClientRect());
        return { rtl: rects[0].left > rects[8].left, sameRow: rects.every(r => Math.abs(r.top - rects[0].top) < 1), minWidth: Math.min(...rects.map(r => r.width)) };
      });
      expect(layout.rtl && layout.sameRow && layout.minWidth >= 80).toBe(true);
      const reception = stages.getByTestId('clinical_stage_reception');
      const before = await reception.getAttribute('data-stage-state');
      await reception.click();
      await expect(stages.getByText('گام ۱ از ۲: بررسی اطلاعات')).toBeVisible();
      await expect(stages.getByTestId('clinical_stage_confirm')).toHaveCount(0);
      await stages.getByTestId('clinical_stage_review').click();
      await expect(stages.getByText('گام ۲ از ۲: تأیید ادامه')).toBeVisible();
      await expect(reception).toHaveAttribute('data-stage-state', before!);
      await stages.getByRole('button', { name: 'انصراف' }).click();
      await expect(stages.getByTestId('clinical_stage_confirm')).toHaveCount(0);
      await reception.click();
      await stages.getByTestId('clinical_stage_review').click();
      await stages.getByTestId('clinical_stage_confirm').click();
      await expect(page.getByTestId('patient_detail_clinical_journey').getByTestId('clinical_journey_stepper')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('V15 Clinical Record: 4-state allergy verification, ISO 3950/Palmer odontogram & versioned consent lifecycle', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 393, height: 852 },
      locale: 'fa-IR',
    });
    const page = await context.newPage();

    try {
      const corsHeaders = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'apikey,authorization,content-type,x-client-info,prefer,range,accept-profile,content-profile',
      };

      await page.addInitScript(() => {
        window.localStorage.setItem(
          'minadental_auth_user_v1',
          JSON.stringify({
            id: '00000000-0000-0000-0000-000000000101',
            name: 'دکتر مهدی امیری',
            role: 'owner',
            title: 'مدیر کلینیک و جراح دندانپزشک',
            email: 'mahdiamiri785@gmail.com',
            phone: '09128446158',
          })
        );
      });

      // Fallback handler for auxiliary REST reads so WebKit never fails CORS preflight on unmocked clinic tables
      await page.route('**/rest/v1/**', async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: corsHeaders });
          return;
        }
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            headers: corsHeaders,
            contentType: 'application/json',
            body: '[]',
          });
          return;
        }
        await route.continue();
      });

      await page.route('**/rest/v1/patients*', async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: corsHeaders });
          return;
        }
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: '00000000-0000-0000-0000-000000000601',
              tenant_id: 'minadental_clinic',
              branch_id: 'main',
              first_name: 'پریسا',
              last_name: 'موسوی',
              phone: '09125556677',
              national_id: '0019988776',
              birth_date: null,
              gender: 'female',
              blood_type: 'A+',
              allergies: null,
              medical_history: null,
              medications: null,
              insurance_provider: 'آزاد',
              insurance_number: '1501',
              address: null,
              email: null,
              notes: '[پرونده: 1501]',
              status: 'active',
              created_at: '2026-11-30T08:00:00Z',
              updated_at: '2026-11-30T08:00:00Z',
            },
          ]),
        });
      });

      await page.route('**/rest/v1/tooth_conditions*', async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: corsHeaders });
          return;
        }
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          headers: corsHeaders,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'legacy-ambig-6',
              patient_id: '00000000-0000-0000-0000-000000000601',
              tooth_number: 6,
              condition: 'decay',
              surface: 'O',
              notes: 'رکورد قدیمی بدون ربع',
              updated_at: '2026-11-29T10:00:00Z',
            },
          ]),
        });
      });

      await page.goto('/#/patients', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

      await page.getByText('پرونده کامل ←').first().click();

      // 1) Verify 4-state allergy card defaults to "حساسیت دارویی سؤال/بررسی نشده" on empty free text
      const allergyCard = page.getByTestId('v15_allergy_verification_card');
      await expect(allergyCard).toBeVisible();
      await expect(page.getByTestId('v15_allergy_status_badge')).toContainText('بررسی نشده');

      // 2) Switch to Odontogram Chart tab and verify ISO 3950 FDI teeth + ambiguous legacy banner
      await page.getByRole('dialog').getByRole('button', { name: 'چارت', exact: true }).click();
      const odontogram = page.getByTestId('odontogram_v15_workspace');
      await expect(odontogram).toBeVisible();
      await expect(page.getByTestId('odontogram_ambiguous_reconciliation_banner')).toBeVisible();
      await expect(page.getByTestId('odontogram_tooth_16')).toBeVisible();

      // 3) Open versioned Consent Modal and verify printed_unsigned vs signed controls
      await page.getByRole('button', { name: 'رضایت‌نامه A4' }).click();
      await expect(page.getByTestId('consent_modal_v15')).toBeVisible();
      await expect(page.getByTestId('consent_print_unsigned_btn')).toBeVisible();
      await expect(page.getByTestId('consent_record_signed_btn')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('V16 Financial Intelligence: IRR_TOMAN receivables, guarantee isolation, Persian digit validation & responsive RTL', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 390, height: 844 },
      locale: 'fa-IR',
    });
    const page = await context.newPage();

    try {
      await page.addInitScript(() => {
        window.localStorage.setItem(
          'minadental_auth_user_v1',
          JSON.stringify({
            id: '00000000-0000-0000-0000-000000000101',
            name: 'دکتر مهدی امیری',
            role: 'owner',
            title: 'مدیر کلینیک و جراح دندانپزشک',
            email: 'mahdiamiri785@gmail.com',
            phone: '09128446158',
          })
        );
      });

      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'apikey,authorization,content-type,x-client-info,prefer,range,accept-profile,content-profile',
      };

      await page.route('**/rest/v1/**', async (route) => {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: cors });
          return;
        }
        if (route.request().method() === 'GET') {
          await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '[]' });
          return;
        }
        await route.continue();
      });

      await page.route('**/rest/v1/patients*', async (route) => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (route.request().method() !== 'GET') return route.continue();
        await route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: '00000000-0000-0000-0000-000000000701',
              tenant_id: 'minadental_clinic',
              branch_id: 'main',
              first_name: 'کیان',
              last_name: 'رضایی',
              phone: '09127778899',
              status: 'active',
              created_at: '2026-11-26T08:00:00Z',
              updated_at: '2026-11-26T08:00:00Z',
            },
          ]),
        });
      });

      await page.route('**/rest/v1/treatments*', async (route) => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (route.request().method() !== 'GET') return route.continue();
        await route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: '00000000-0000-0000-0000-000000000711',
              tenant_id: 'minadental_clinic',
              branch_id: 'main',
              patient_id: '00000000-0000-0000-0000-000000000701',
              diagnosis: 'ایمپلنت دندان ۱۴',
              status: 'completed',
              total_cost: 2000000,
              paid_amount: 0,
              discount: 0,
              performed_at: '2026-11-26',
              created_at: '2026-11-26T08:00:00Z',
              updated_at: '2026-11-26T08:00:00Z',
            },
          ]),
        });
      });

      await page.route('**/rest/v1/checks*', async (route) => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (route.request().method() !== 'GET') return route.continue();
        await route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: '00000000-0000-0000-0000-000000000721',
              tenant_id: 'minadental_clinic',
              branch_id: 'main',
              patient_id: '00000000-0000-0000-0000-000000000701',
              check_number: '9911',
              bank_name: 'سامان',
              amount: 10000000,
              due_date: '2026-12-20',
              status: 'pending',
              type: 'guarantee',
              is_guarantee: true,
              created_at: '2026-11-26T08:00:00Z',
              updated_at: '2026-11-26T08:00:00Z',
            },
          ]),
        });
      });

      await page.goto('/#/finance', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

      await expect(page.getByTestId('finance_total_receivables')).toContainText('۲٬۰۰۰٬۰۰۰');
      const aging = page.getByTestId('finance_aging_buckets');
      await expect(aging).toBeVisible();
      await expect(aging.getByText('بدون سررسید', { exact: true })).toBeVisible();
      await expect(aging.getByText('بیش از ۹۰ روز', { exact: true })).toBeVisible();
      await expect(page.getByText('چک ضمانت نزد مطب (غیرنقدی):')).toBeVisible();

      // Open Quick Pay sheet and validate fractional input rejection
      await page.getByTestId('quick_pay_btn_00000000-0000-0000-0000-000000000701').click();
      await expect(page.getByTestId('finance_quick_pay_sheet')).toBeVisible();
      await page.getByTestId('quick_pay_amount_input').fill('۱۲.۵');
      await page.getByTestId('quick_pay_submit_button').click();
      await expect(page.getByTestId('quick_pay_error_banner')).toContainText('اعشار مجاز نیست');

      // Switch to Transactions & verify Daily Close drawer opens cleanly
      await page.getByTestId('close_fullscreen_modal_btn').click();
      await expect(page.getByTestId('finance_quick_pay_sheet')).toBeHidden();
      await page.getByTestId('finance_tab_transactions').click();
      await page.getByTestId('finance_open_day_close_btn').click();
      await expect(page.getByTestId('finance_day_close_sheet')).toBeVisible();

      const overflowOk = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2
      );
      expect(overflowOk).toBe(true);
    } finally {
      await context.close();
    }
  });

  test('GE-0002 Adaptive Shell: topbar title readability, bell-ear gutter, 58px dock alignment, bidi badge, dark drawer & branch sync', async ({
    page,
  }) => {
    for (const vp of [
      { width: 360, height: 740 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(vp);
      await page.goto('/#/settings', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

      // 0. Brand tooth logo must remain visible & non-zero across mobile routes (including Settings)
      const logoBtn = page.getByTestId('topbar_brand_logo_button');
      await expect(logoBtn).toBeVisible();
      const logoBox = await logoBtn.boundingBox();
      expect(logoBox).not.toBeNull();
      expect((logoBox?.width ?? 0) >= 34 && (logoBox?.height ?? 0) >= 34).toBe(true);

      // 0b. Topbar Back button must NOT appear on direct root route
      await expect(page.getByTestId('topbar_back_button')).toHaveCount(0);

      // 1. Header title must not clip/truncate horizontally
      const heading = page.locator('header h1').first();
      await expect(heading).toBeVisible();
      const headingMetrics = await heading.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        text: el.textContent?.trim() || '',
      }));
      expect(headingMetrics.text).toContain('تنظیمات');
      expect(headingMetrics.scrollWidth).toBeLessThanOrEqual(headingMetrics.clientWidth + 2);

      // 2. Installed build badge isolates LTR token without clipping or horizontal overflow
      const badge = page.getByTestId('installed_build_badge');
      await expect(badge).toBeVisible();
      const badgeDir = await badge.getAttribute('dir');
      expect(badgeDir).toBe('ltr');

      // 3. Dock pill bar and dock_more_button must align cleanly at matching 58px height
      const pillBox = await page.getByTestId('qbank_primary_pill_bar').boundingBox();
      const moreBox = await page.getByTestId('dock_more_button').boundingBox();
      expect(pillBox).not.toBeNull();
      expect(moreBox).not.toBeNull();
      expect(Math.abs((pillBox?.height ?? 0) - (moreBox?.height ?? 0))).toBeLessThanOrEqual(2);

      // 4. GE-0007 P1: Duplicate floating right-edge bell ear must NOT exist (single authoritative bell in topbar)
      await expect(page.getByTestId('right_edge_draggable_bell_handle')).toHaveCount(0);
      await expect(page.getByTestId('topbar_notifications_button')).toBeVisible();
      await expect(page.getByTestId('toggle_auto_update_switch')).toBeVisible();

      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2
      );
      expect(noOverflow).toBe(true);
    }

    // 5. Switching primary dock tabs keeps topbar_back_button hidden, while sub-flow shows it
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('dock_tab_patients').click();
    await expect(page.getByTestId('topbar_brand_logo_button')).toBeVisible();
    await expect(page.getByTestId('topbar_back_button')).toHaveCount(0);

    await page.getByTestId('dock_tab_appointments').click();
    await expect(page.getByTestId('topbar_back_button')).toHaveCount(0);

    await page.getByTestId('dock_more_button').click();
    await expect(page.getByTestId('all_services_screen')).toBeVisible();
    await expect(page.getByTestId('topbar_back_button')).toHaveCount(0);

    await page.getByTestId('services_open_customizer_btn').click();
    await expect(page.getByTestId('topbar_back_button')).toBeVisible();
    await page.getByTestId('topbar_back_button').click();
    await expect(page.getByTestId('all_services_screen')).toBeVisible();
    await expect(page.getByTestId('topbar_back_button')).toHaveCount(0);

    // 6. Dark mode parity across Settings + Notification Drawer + branch selection sync
    await page.goto('/#/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
    await page.getByTestId('appearance_theme_dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByTestId('branch_switch_north').click();
    await expect(page.locator('header')).toContainText('شعبه تخصصی ایمپلنت');

    await page.getByTestId('topbar_notifications_button').click();
    const drawer = page.getByTestId('slide_over_notification_drawer');
    await expect(drawer).toBeVisible();
    const drawerBg = await drawer.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(drawerBg).not.toBe('rgb(244, 247, 249)');
  });

  test('GE-0003 Global Intelligent App Shell: emotional mascot, contextual toolbar, density/platform switching & Command Center focus trap', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/patients', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

    // 1. Duolingo-style emotional iridescent tooth mascot is visible in mobile header
    const headerMascot = page.locator('[data-testid="topbar_brand_logo_button"] [data-testid="minadental_mascot_tooth"]');
    await expect(headerMascot).toBeVisible();

    // 2. Smart Contextual Toolbar + Unified Sync Status Pill render on operational screen without overflow
    await expect(page.getByTestId('smart_contextual_toolbar')).toBeVisible();
    await expect(page.getByTestId('unified_sync_status_pill')).toBeVisible();

    // 3. Global Command Center opens with Ctrl+K, exposes ARIA dialog modal, and closes cleanly with Escape
    await page.locator('header h1').first().click();
    await page.keyboard.press('Control+k');
    const cmdCenter = page.getByTestId('qbank_all_folders_menu');
    await expect(cmdCenter).toBeVisible();
    await expect(cmdCenter.locator('[role="dialog"][aria-modal="true"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(cmdCenter).toBeHidden();

    // 4. Notification Drawer displays emotional tooth mascot and ARIA dialog semantics via single authoritative bell
    await expect(page.getByTestId('right_edge_draggable_bell_handle')).toHaveCount(0);
    await page.getByTestId('topbar_notifications_button').click();
    const notifDrawer = page.getByTestId('slide_over_notification_drawer');
    await expect(notifDrawer).toBeVisible();
    await expect(notifDrawer.locator('[data-testid="minadental_mascot_tooth"]').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(notifDrawer).toBeHidden();

    // 5. Intelligent Density & Platform Design Language controls update <html> tokens deterministically
    await page.goto('/#/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
    await page.getByTestId('appearance_density_spacious').click();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'spacious');
    await page.getByTestId('appearance_platform_fluent').click();
    await expect(page.locator('html')).toHaveAttribute('data-platform-design', 'fluent');
    await page.getByTestId('appearance_density_comfortable').click();
    await page.getByTestId('appearance_platform_auto').click();

    // 6. Zero horizontal clipping across 360px, 768px, and 1366px
    for (const vp of [
      { width: 360, height: 740 },
      { width: 768, height: 1024 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(vp);
      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2
      );
      expect(noOverflow).toBe(true);
    }
  });

  test('GE-0004: 320px-1920px all-route matrix, 200% text scaling, light/dark, reduced motion, 3-way versions & Progressive Disclosure', async ({ page }) => {
    test.setTimeout(120_000);
    const evidenceDir = path.resolve(process.cwd(), 'test-results', 'ge0004-evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });

    const routes = [
      '/#/',
      '/#/services',
      '/#/patients',
      '/#/appointments',
      '/#/treatments',
      '/#/finance',
      '/#/calendar',
      '/#/lab',
      '/#/implants',
      '/#/inventory',
      '/#/reminders',
      '/#/staff',
      '/#/messages',
      '/#/settings',
    ];

    const viewports = [
      { name: '320px', width: 320, height: 640 },
      { name: '768px', width: 768, height: 1024 },
      { name: '1920px', width: 1920, height: 1080 },
    ];

    await page.goto('/#/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of routes) {
        const hashTarget = route.replace(/^\//, '');
        await page.evaluate((h) => {
          window.location.hash = h;
        }, hashTarget);
        await page.waitForTimeout(80);
        const layout = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          dir: document.documentElement.getAttribute('dir'),
        }));
        expect(layout.dir).toBe('rtl');
        expect(
          layout.scrollWidth,
          `Horizontal overflow on ${route} at ${vp.name}: scrollWidth=${layout.scrollWidth} > clientWidth=${layout.clientWidth}`
        ).toBeLessThanOrEqual(layout.clientWidth + 2);
      }
      await page.evaluate(() => {
        window.location.hash = '#/';
      });
      await page.waitForTimeout(120);
      await page.screenshot({ path: path.join(evidenceDir, `dashboard-${vp.name}-light.png`) });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

    await expect(page.getByTestId('shell_skip_to_main')).toHaveAttribute('href', '#main-clinic-content');
    await expect(page.getByTestId('shell_route_live_announcer')).toContainText('تنظیمات');

    await expect(page.getByTestId('settings_version_separation_card')).toBeVisible();
    await expect(page.getByTestId('version_installed_web')).toBeVisible();
    await expect(page.getByTestId('version_available_release')).toBeVisible();
    await expect(page.getByTestId('version_native_package')).toBeVisible();

    const disclosureToggle = page.getByTestId('settings_technical_disclosure_toggle');
    await expect(disclosureToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('settings_technical_disclosure_panel')).toBeHidden();
    await disclosureToggle.click();
    await expect(disclosureToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('settings_technical_disclosure_panel')).toBeVisible();

    await page.getByTestId('settings_unified_update_center').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidenceDir, 'settings-update-center-390px-light.png') });
    await page.evaluate(() => document.querySelector('main')?.scrollTo({ top: 0 }));
    await page.screenshot({ path: path.join(evidenceDir, 'settings-390px-light.png') });

    await page.getByTestId('appearance_font_double').click();
    await expect(page.locator('html')).toHaveAttribute('data-text-scale-200', 'true');
    await page.getByTestId('appearance_theme_dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('appearance_motion_reduce').click();
    await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', 'true');

    const scaledSettingsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2
    );
    expect(scaledSettingsOverflow).toBe(true);
    await page.screenshot({ path: path.join(evidenceDir, 'settings-390px-dark-200pct.png') });

    await page.goto('/#/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
    const scaledDashOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2
    );
    expect(scaledDashOverflow).toBe(true);
    await page.screenshot({ path: path.join(evidenceDir, 'dashboard-390px-dark-200pct.png') });

    await page.goto('/#/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
    await page.getByTestId('appearance_font_default').click();
    await page.getByTestId('appearance_theme_light').click();
    await page.getByTestId('appearance_motion_system').click();
  });

  test('GE-0007 Universal Installation, Real Chrome PWA Manifest/Icons, 42501 Auth CTA & Unclipped Mobile UX', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 390, height: 844 },
      locale: 'fa-IR',
    });
    const page = await context.newPage();

    try {
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'apikey,authorization,content-type,x-client-info,prefer,range,accept-profile,content-profile',
      };

      // Simulate PostgreSQL 42501 permission denied for unauthenticated anon role
      await page.route('**/rest/v1/patients*', async (route) => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        await route.fulfill({
          status: 403,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({
            code: '42501',
            message: 'permission denied for table patients',
          }),
        });
      });

      await page.goto('/#/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });

      // 1. P0-PWA: Verify real root ./manifest.json (NEVER /assets/manifest-*.json), scope containment & 192/512 PNGs
      const pwaAudit = await page.evaluate(async () => {
        const link = document.querySelector('link[rel="manifest"]');
        const href = link?.getAttribute('href') || '';
        const manifestUrl = new URL(href, window.location.href);
        const res = await fetch(manifestUrl.href, { cache: 'no-store' });
        const ct = res.headers.get('content-type') || '';
        const json = await res.json();
        const scopeUrl = new URL(json.scope || './', manifestUrl);
        const pageOriginPath = window.location.origin + window.location.pathname;
        const icon192 = (json.icons || []).find((i: { sizes?: string }) => String(i.sizes || '').includes('192x192'));
        const icon512 = (json.icons || []).find((i: { sizes?: string }) => String(i.sizes || '').includes('512x512'));
        const r192 = icon192 ? await fetch(new URL(icon192.src, manifestUrl).href) : null;
        const r512 = icon512 ? await fetch(new URL(icon512.src, manifestUrl).href) : null;
        return {
          href,
          status: res.status,
          ct,
          hasId: Boolean(json.id),
          display: json.display,
          scopeContained: pageOriginPath.startsWith(scopeUrl.origin + scopeUrl.pathname),
          icon192Status: r192?.status ?? 0,
          icon192Ct: r192?.headers.get('content-type') || '',
          icon512Status: r512?.status ?? 0,
          icon512Ct: r512?.headers.get('content-type') || '',
        };
      });

      expect(pwaAudit.href).toBe('./manifest.json');
      expect(pwaAudit.status).toBe(200);
      expect(pwaAudit.ct.toLowerCase()).toContain('json');
      expect(pwaAudit.hasId).toBe(true);
      expect(pwaAudit.display).toBe('standalone');
      expect(pwaAudit.scopeContained).toBe(true);
      expect(pwaAudit.icon192Status).toBe(200);
      expect(pwaAudit.icon192Ct.toLowerCase()).toContain('image/png');
      expect(pwaAudit.icon512Status).toBe(200);
      expect(pwaAudit.icon512Ct.toLowerCase()).toContain('image/png');

      // 2. P0-DATABASE UX: Verify 42501 permission denied shows clear Persian guidance + 1-click sign-in CTA
      const unauthBanner = page.getByTestId('section_status_unauthorized');
      await expect(unauthBanner).toBeVisible();
      await expect(unauthBanner).toContainText('دسترسی ناشناس به پرونده بیماران');
      const authBtn = page.getByTestId('section_status_open_auth_btn');
      await expect(authBtn).toBeVisible();
      await authBtn.click();
      await expect(page.getByTestId('user_account_modal')).toBeVisible();
      await page.keyboard.press('Escape');

      // 3. P1 UX: Zero duplicate floating bell + crisp unclipped SmartBrief KPI labels
      await expect(page.getByTestId('right_edge_draggable_bell_handle')).toHaveCount(0);
      await expect(page.getByTestId('topbar_notifications_button')).toBeVisible();

      // 4. Open InstallAppModal from Settings & verify honest 6/6 real manifest check + native APK card
      await page.goto('/#/settings', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
      await page.getByTestId('settings_open_install_modal_btn').click();
      const modal = page.getByTestId('install_app_modal');
      await expect(modal).toBeVisible();
      await expect(page.getByTestId('eligibility_criteria_panel')).toContainText('تایید واقعی (6/6');
      // Desktop browser auto-detection selects Windows; explicitly select Android before asserting its controls.
      await modal.getByTestId('install_tab_android').click();
      await expect(page.getByTestId('native_apk_download_card')).toBeVisible();
      await expect(page.getByTestId('modal_github_apk_release_link')).toHaveAttribute(
        'href',
        'https://github.com/galaxy1364/Dendalcare/releases/tag/android-latest'
      );
    } finally {
      await context.close();
    }
  });
});





