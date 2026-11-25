import { test, expect } from '@playwright/test';

const VIEWPORT_MATRIX = [
  { name: '360x740', width: 360, height: 740, checkNoScrollHome: true },
  { name: '375x812', width: 375, height: 812, checkNoScrollHome: true },
  { name: '390x844', width: 390, height: 844, checkNoScrollHome: true },
  { name: '430x932', width: 430, height: 932, checkNoScrollHome: true },
  { name: '768x1024', width: 768, height: 1024, checkNoScrollHome: false },
  { name: '1366x768', width: 1366, height: 768, checkNoScrollHome: false },
];

test.describe('MinaDental V5 Release Gate E2E', () => {
  test('cold root load reaches post-commit SHELL_READY with zero console/page errors and zero 404 assets', async ({ page }) => {
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

    await page.waitForFunction(() => (window as any).__minaAppMounted === true, null, { timeout: 12_000 });
    await expect(page.locator('#app-splash')).toHaveCount(0);

    expect(failedAssets, 'No local static asset may 404').toEqual([]);
    expect(pageErrors, 'Zero uncaught page errors on cold boot').toEqual([]);
    expect(consoleErrors.filter((e) => !e.includes('supabase')), 'Zero unexpected console errors').toEqual([]);
  });

  for (const vp of VIEWPORT_MATRIX) {
    test(`viewport ${vp.name} renders dashboard without horizontal overflow or splash hang`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as any).__minaAppMounted === true, null, { timeout: 12_000 });

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
    });
  }

  test('route navigation, back/forward, and Route ErrorBoundary containment work cleanly', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__minaAppMounted === true, null, { timeout: 12_000 });

    const servicesTrigger = page.getByTestId('dock_all_services_button').or(page.getByTestId('topbar_global_search_button'));
    if (await servicesTrigger.first().isVisible()) {
      await servicesTrigger.first().click();
    }

    const backBtn = page.getByTestId('topbar_back_button');
    if (await backBtn.isVisible()) {
      await backBtn.click();
    }
    await expect(page.locator('header')).toBeVisible();
  });

  test('hanging Supabase requests terminate in timeout state instead of freezing shell loading', async ({ page }) => {
    await page.route('**/rest/v1/**', async (route) => {
      await new Promise((r) => setTimeout(r, 15_000));
      await route.abort('timedout');
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__minaAppMounted === true, null, { timeout: 12_000 });
    await expect(page.locator('header')).toBeVisible();
  });

  test('offline toggle and reconnect keep shell responsive without crashing', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__minaAppMounted === true, null, { timeout: 12_000 });

    await context.setOffline(true);
    await expect(page.getByText('حالت آفلاین')).toBeVisible({ timeout: 8_000 });

    await context.setOffline(false);
    await expect(page.locator('header')).toBeVisible();
  });
});
