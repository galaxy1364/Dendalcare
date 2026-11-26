# Test info

- Name: MinaDental V6 Release Gate E2E >> V7/V8 authoritative pointers, immutable manifest, boot milestones & independent #boot-error container verified
- Location: /app/applet/tests/e2e/release-gate.spec.ts:192:3

# Error details

```
Error: browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/chromium_headless_shell-1169/chrome-linux/headless_shell
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
  114 |
  115 |       expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.docClientWidth + 2);
  116 |       if (vp.checkNoScrollHome) {
  117 |         expect(metrics.bodyScrollHeight).toBeLessThanOrEqual(metrics.innerHeight + 8);
  118 |       }
  119 |
  120 |       if (vp.captureScreenshot) {
  121 |         await page.screenshot({
  122 |           path: testInfo.outputPath(`viewport-${vp.name}.png`),
  123 |           fullPage: false,
  124 |         });
  125 |       }
  126 |     });
  127 |   }
  128 |
  129 |   test('deep-link refresh, back/forward navigation, and RBAC shell remain responsive', async ({ page }) => {
  130 |     await page.setViewportSize({ width: 390, height: 844 });
  131 |     await page.goto('/#/services', { waitUntil: 'domcontentloaded' });
  132 |     await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
  133 |
  134 |     // Refresh on deep-link route
  135 |     await page.reload({ waitUntil: 'domcontentloaded' });
  136 |     await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
  137 |
  138 |     // Navigate back & forward safely
  139 |     await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  140 |     await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
  141 |     await page.goBack().catch(() => {});
  142 |     await page.goForward().catch(() => {});
  143 |
  144 |     const bodyText = await page.evaluate(() => document.body.innerText.trim());
  145 |     expect(bodyText.length).toBeGreaterThan(0);
  146 |   });
  147 |
  148 |   test('missing lazy chunk 404 is contained without blank crash screen', async ({ page }) => {
  149 |     await page.setViewportSize({ width: 390, height: 844 });
  150 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
  151 |     await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
  152 |
  153 |     await page.route('**/assets/*Section*.js', (route) =>
  154 |       route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' })
  155 |     );
  156 |
  157 |     const servicesTrigger = page.getByTestId('dock_all_services_button').or(page.getByTestId('topbar_global_search_button'));
  158 |     if (await servicesTrigger.first().isVisible()) {
  159 |       await servicesTrigger.first().click();
  160 |     }
  161 |
  162 |     const bodyText = await page.evaluate(() => document.body.innerText.trim());
  163 |     expect(bodyText.length).toBeGreaterThan(0);
  164 |   });
  165 |
  166 |   test('hanging Supabase requests terminate cleanly instead of freezing shell loading', async ({ page }) => {
  167 |     await page.route('**/rest/v1/**', async (route) => {
  168 |       await new Promise((r) => setTimeout(r, 15_000));
  169 |       await route.abort('timedout');
  170 |     });
  171 |
  172 |     await page.setViewportSize({ width: 390, height: 844 });
  173 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
  174 |     await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
  175 |     const bodyText = await page.evaluate(() => document.body.innerText.trim());
  176 |     expect(bodyText.length).toBeGreaterThan(0);
  177 |   });
  178 |
  179 |   test('offline toggle and reconnect keep shell responsive without crashing', async ({ page, context }) => {
  180 |     await page.setViewportSize({ width: 390, height: 844 });
  181 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
  182 |     await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
  183 |
  184 |     await context.setOffline(true);
  185 |     await page.waitForTimeout(500);
  186 |     await context.setOffline(false);
  187 |
  188 |     const bodyText = await page.evaluate(() => document.body.innerText.trim());
  189 |     expect(bodyText.length).toBeGreaterThan(0);
  190 |   });
  191 |
> 192 |   test('V7/V8 authoritative pointers, immutable manifest, boot milestones & independent #boot-error container verified', async ({ page }) => {
      |   ^ Error: browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/chromium_headless_shell-1169/chrome-linux/headless_shell
  193 |     await page.setViewportSize({ width: 390, height: 844 });
  194 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
  195 |     await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
  196 |
  197 |     const v8Check = await page.evaluate(async () => {
  198 |       const pointerRes = await fetch('./release-pointer.json', { cache: 'no-store' });
  199 |       const pointer = await pointerRes.json();
  200 |       const androidPtrRes = await fetch('./android-release-pointer.json', { cache: 'no-store' });
  201 |       const iosPtrRes = await fetch('./ios-release-pointer.json', { cache: 'no-store' });
  202 |       const manifestRes = await fetch(pointer.manifestUrl || './release-manifest.json', { cache: 'no-store' });
  203 |       const manifest = await manifestRes.json();
  204 |       const bootErrEl = document.getElementById('boot-error');
  205 |       const insideSplash = Boolean(bootErrEl && bootErrEl.closest('#app-splash'));
  206 |       return {
  207 |         pointerStatus: pointerRes.status,
  208 |         androidPtrStatus: androidPtrRes.status,
  209 |         iosPtrStatus: iosPtrRes.status,
  210 |         manifestStatus: manifestRes.status,
  211 |         runtimeBuildId: window.__minaBuildId,
  212 |         runtimeDigest: window.__minaContentDigest,
  213 |         pointerReleaseId: pointer.currentReleaseId,
  214 |         manifestReleaseId: manifest.releaseId,
  215 |         manifestDigest: manifest.contentDigest,
  216 |         manifestSchema: manifest.schemaVersion,
  217 |         assetCount: Array.isArray(manifest.assets) ? manifest.assets.length : 0,
  218 |         watchdogCleared: window.__minaBootWatchdogTimer == null,
  219 |         milestones: window.__minaBootMilestones || {},
  220 |         bootErrorExists: Boolean(bootErrEl),
  221 |         bootErrorInsideSplash: insideSplash,
  222 |       };
  223 |     });
  224 |
  225 |     expect(v8Check.pointerStatus).toBe(200);
  226 |     expect(v8Check.androidPtrStatus).toBe(200);
  227 |     expect(v8Check.iosPtrStatus).toBe(200);
  228 |     expect(v8Check.manifestStatus).toBe(200);
  229 |     expect(v8Check.manifestSchema).toBe(2);
  230 |     expect(v8Check.pointerReleaseId).toBe(v8Check.runtimeBuildId);
  231 |     expect(v8Check.manifestReleaseId).toBe(v8Check.runtimeBuildId);
  232 |     expect(v8Check.manifestDigest).toBe(v8Check.runtimeDigest);
  233 |     expect(v8Check.assetCount).toBeGreaterThan(0);
  234 |     expect(v8Check.watchdogCleared).toBe(true);
  235 |     expect(v8Check.bootErrorExists).toBe(true);
  236 |     expect(v8Check.bootErrorInsideSplash).toBe(false);
  237 |     expect(Boolean(v8Check.milestones.moduleEvaluatedAt)).toBe(true);
  238 |     expect(Boolean(v8Check.milestones.shellCommittedAt)).toBe(true);
  239 |   });
  240 |
  241 |   test('V9 fault-injection: font, icon, and manifest 404 NEVER trigger #boot-error and app boots in Persian', async ({ page }) => {
  242 |     await page.route('**/fonts/*.woff2', (route) =>
  243 |       route.fulfill({ status: 404, contentType: 'text/plain', body: 'Font Missing' })
  244 |     );
  245 |     await page.route('**/manifest.json', (route) =>
  246 |       route.fulfill({ status: 404, contentType: 'text/plain', body: 'Manifest Missing' })
  247 |     );
  248 |     await page.route('**/icon-192.png', (route) =>
  249 |       route.fulfill({ status: 404, contentType: 'text/plain', body: 'Icon Missing' })
  250 |     );
  251 |
  252 |     await page.setViewportSize({ width: 390, height: 844 });
  253 |     await page.goto('/', { waitUntil: 'domcontentloaded' });
  254 |     await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
  255 |     await expect(page.locator('#app-splash')).toHaveCount(0);
  256 |     await expect(page.locator('#boot-error')).toBeHidden();
  257 |
  258 |     const bodyText = await page.evaluate(() => document.body.innerText.trim());
  259 |     expect(bodyText.length).toBeGreaterThan(0);
  260 |   });
  261 |
  262 |   test('V12 membership-only auth fails closed when app_metadata exists without active clinic_membership', async ({ browser }) => {
  263 |     const context = await browser.newContext({
  264 |       serviceWorkers: 'block',
  265 |       viewport: { width: 390, height: 844 },
  266 |     });
  267 |     const page = await context.newPage();
  268 |     try {
  269 |       const corsHeaders = {
  270 |         'access-control-allow-origin': '*',
  271 |         'access-control-allow-headers': 'apikey,authorization,content-type,x-client-info,prefer',
  272 |         'access-control-allow-methods': 'GET,POST,OPTIONS',
  273 |       };
  274 |       await page.route(/\/auth\/v1\/token/, async (route) => {
  275 |         if (route.request().method() === 'OPTIONS') {
  276 |           await route.fulfill({ status: 204, headers: corsHeaders });
  277 |           return;
  278 |         }
  279 |         await route.fulfill({
  280 |           status: 200,
  281 |           headers: corsHeaders,
  282 |           contentType: 'application/json',
  283 |           body: JSON.stringify({
  284 |             access_token: 'test.jwt.token',
  285 |             token_type: 'bearer',
  286 |             expires_in: 3600,
  287 |             refresh_token: 'test-refresh',
  288 |             user: {
  289 |               id: '00000000-0000-0000-0000-000000000999',
  290 |               email: 'revoked@minadental.ir',
  291 |               app_metadata: { clinic_role: 'manager', tenant_id: 'minadental_clinic' },
  292 |             },
```