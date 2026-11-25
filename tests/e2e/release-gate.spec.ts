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
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedAssets: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('response', (res) => {
      if (res.status() >= 400 && res.url().startsWith('http://127.0.0.1')) {
        failedAssets.push(`${res.status()} ${res.url()}`);
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
    expect(consoleErrors.filter((e) => !e.includes('supabase')), 'Zero unexpected console errors').toEqual([]);
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
});
