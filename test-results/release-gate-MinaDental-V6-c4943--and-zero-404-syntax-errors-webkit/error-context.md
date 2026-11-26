# Test info

- Name: MinaDental V6 Release Gate E2E >> cold & warm boot + reload reach SHELL_READY with valid window.__minaBuildId and zero 404/syntax errors
- Location: /app/applet/tests/e2e/release-gate.spec.ts:13:3

# Error details

```
Error: browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/webkit-2158/pw_run.sh
╔═════════════════════════════════════════════════════════════════════════╗
║ Looks like Playwright Test or Playwright was just installed or updated. ║
║ Please run the following command to download new browsers:              ║
║                                                                         ║
║     npx playwright install                                              ║
║                                                                         ║
║ <3 Playwright Team                                                      ║
╚═════════════════════════════════════════════════════════════════════════╝
```

# Test source

```ts
   1 | import { test, expect } from '@playwright/test';
   2 |
   3 | const VIEWPORT_MATRIX = [
   4 |   { name: '360x740', width: 360, height: 740, checkNoScrollHome: true, captureScreenshot: true },
   5 |   { name: '375x812', width: 375, height: 812, checkNoScrollHome: true, captureScreenshot: false },
   6 |   { name: '390x844', width: 390, height: 844, checkNoScrollHome: true, captureScreenshot: true },
   7 |   { name: '430x932', width: 430, height: 932, checkNoScrollHome: true, captureScreenshot: true },
   8 |   { name: '768x1024', width: 768, height: 1024, checkNoScrollHome: false, captureScreenshot: false },
   9 |   { name: '1366x768', width: 1366, height: 768, checkNoScrollHome: false, captureScreenshot: false },
   10 | ];
   11 |
   12 | test.describe('MinaDental V6 Release Gate E2E', () => {
>  13 |   test('cold & warm boot + reload reach SHELL_READY with valid window.__minaBuildId and zero 404/syntax errors', async ({ page }) => {
      |   ^ Error: browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/webkit-2158/pw_run.sh
   14 |     const consoleErrors: Array<{ text: string; url: string }> = [];
   15 |     const pageErrors: string[] = [];
   16 |     const failedAssets: string[] = [];
   17 |     let supabase401Count = 0;
   18 |
   19 |     page.on('console', (msg) => {
   20 |       if (msg.type() === 'error') {
   21 |         consoleErrors.push({ text: msg.text(), url: msg.location()?.url || '' });
   22 |       }
   23 |     });
   24 |     page.on('pageerror', (err) => pageErrors.push(err.message));
   25 |     page.on('response', (res) => {
   26 |       if (res.status() >= 400 && res.url().startsWith('http://127.0.0.1')) {
   27 |         failedAssets.push(`${res.status()} ${res.url()}`);
   28 |       } else if (res.status() === 401 && res.url().includes('supabase.co')) {
   29 |         supabase401Count += 1;
   30 |       }
   31 |     });
   32 |
   33 |     await page.setViewportSize({ width: 390, height: 844 });
   34 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
   35 |
   36 |     await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
   37 |     await expect(page.locator('#app-splash')).toHaveCount(0);
   38 |
   39 |     const buildInfo = await page.evaluate(() => ({
   40 |       runtimeBuildId: window.__minaBuildId,
   41 |       metaBuildId: document.querySelector('meta[name="minadental-build-id"]')?.getAttribute('content'),
   42 |       bootState: window.__minaBootState,
   43 |     }));
   44 |
   45 |     expect(buildInfo.runtimeBuildId).toMatch(/^v\d+\.\d+\.\d+-[0-9a-f]{10}$/);
   46 |     expect(buildInfo.runtimeBuildId).toBe(buildInfo.metaBuildId);
   47 |     expect(buildInfo.bootState).not.toBe('BOOTING');
   48 |
   49 |     // Warm reload must also mount cleanly without syntax or asset regressions
   50 |     await page.reload({ waitUntil: 'domcontentloaded' });
   51 |     await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
   52 |     await expect(page.locator('#app-splash')).toHaveCount(0);
   53 |
   54 |     expect(failedAssets, 'No local static asset may 404').toEqual([]);
   55 |     expect(pageErrors, 'Zero uncaught page errors on cold/warm boot').toEqual([]);
   56 |     const unexpectedConsoleErrors = consoleErrors.filter((e) => {
   57 |       if (e.text.includes('supabase') || e.url.includes('supabase')) return false;
   58 |       // WebKit logs unauthenticated V12 Supabase 401 responses without exposing the URL in msg.text() or location
   59 |       if (supabase401Count > 0 && e.text.includes('401 (Unauthorized)')) return false;
   60 |       return true;
   61 |     });
   62 |     expect(unexpectedConsoleErrors, 'Zero unexpected console errors').toEqual([]);
   63 |   });
   64 |
   65 |   test('SW active & V5->V6 cache upgrade preserves offline queue and third-party caches', async ({ page }) => {
   66 |     await page.setViewportSize({ width: 390, height: 844 });
   67 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
   68 |     await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
   69 |
   70 |     const upgradeCheck = await page.evaluate(async () => {
   71 |       localStorage.setItem('minadental_offline_queue_v1', JSON.stringify([{ id: 'q-preserve-1', table: 'patients' }]));
   72 |       if ('caches' in window) {
   73 |         const legacyCache = await caches.open('minadental-shell-v4.9.5-oldv500000');
   74 |         await legacyCache.put('./legacy-test', new Response('legacy'));
   75 |         const thirdPartyCache = await caches.open('external-third-party-cache');
   76 |         await thirdPartyCache.put('./keep', new Response('keep'));
   77 |       }
   78 |       const swSupported = 'serviceWorker' in navigator;
   79 |       const regs = swSupported ? await navigator.serviceWorker.getRegistrations() : [];
   80 |       const queueAfter = localStorage.getItem('minadental_offline_queue_v1');
   81 |       const hasThirdParty = 'caches' in window ? await caches.has('external-third-party-cache') : true;
   82 |       return { swSupported, regCount: regs.length, queueAfter, hasThirdParty };
   83 |     });
   84 |
   85 |     expect(upgradeCheck.queueAfter).toContain('q-preserve-1');
   86 |     expect(upgradeCheck.hasThirdParty).toBe(true);
   87 |   });
   88 |
   89 |   test('SW disabled browser mode still boots cleanly without splash hang', async ({ browser }) => {
   90 |     const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
   91 |     const page = await context.newPage();
   92 |     const pageErrors: string[] = [];
   93 |     page.on('pageerror', (err) => pageErrors.push(err.message));
   94 |
   95 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
   96 |     await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
   97 |     await expect(page.locator('#app-splash')).toHaveCount(0);
   98 |     expect(pageErrors).toEqual([]);
   99 |     await context.close();
  100 |   });
  101 |
  102 |   for (const vp of VIEWPORT_MATRIX) {
  103 |     test(`viewport ${vp.name} renders cleanly without horizontal overflow or splash hang`, async ({ page }, testInfo) => {
  104 |       await page.setViewportSize({ width: vp.width, height: vp.height });
  105 |       await page.goto('/', { waitUntil: 'domcontentloaded' });
  106 |       await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
  107 |
  108 |       const metrics = await page.evaluate(() => ({
  109 |         docScrollWidth: document.documentElement.scrollWidth,
  110 |         docClientWidth: document.documentElement.clientWidth,
  111 |         bodyScrollHeight: document.body.scrollHeight,
  112 |         innerHeight: window.innerHeight,
  113 |       }));
```