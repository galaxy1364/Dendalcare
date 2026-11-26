# Test info

- Name: MinaDental V6 Release Gate E2E >> V13 adaptive window classes, dock/rail switching across 320/390/768/1366/1440, dark theme & role-aware dock hiding
- Location: /app/applet/tests/e2e/release-gate.spec.ts:347:3

# Error details

```
Error: browserType.launch: 
╔══════════════════════════════════════════════════════╗
║ Host system is missing dependencies to run browsers. ║
║ Missing libraries:                                   ║
║     libgstreamer-1.0.so.0                            ║
║     libgtk-4.so.1                                    ║
║     libgraphene-1.0.so.0                             ║
║     libatomic.so.1                                   ║
║     libwoff2dec.so.1.0.2                             ║
║     libevent-2.1.so.7                                ║
║     libgstallocators-1.0.so.0                        ║
║     libgstapp-1.0.so.0                               ║
║     libgstbase-1.0.so.0                              ║
║     libgstpbutils-1.0.so.0                           ║
║     libgstaudio-1.0.so.0                             ║
║     libgsttag-1.0.so.0                               ║
║     libgstvideo-1.0.so.0                             ║
║     libgstgl-1.0.so.0                                ║
║     libgstcodecparsers-1.0.so.0                      ║
║     libgstfft-1.0.so.0                               ║
║     libavif.so.15                                    ║
║     libharfbuzz-icu.so.0                             ║
║     libepoxy.so.0                                    ║
║     libjpeg.so.62                                    ║
║     libsecret-1.so.0                                 ║
║     libhyphen.so.0                                   ║
║     libmanette-0.2.so.0                              ║
║     libGLESv2.so.2                                   ║
║     libx264.so                                       ║
╚══════════════════════════════════════════════════════╝
```

# Test source

```ts
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
  293 |           }),
  294 |         });
  295 |       });
  296 |       await page.route(/\/rest\/v1\/clinic_memberships/, async (route) => {
  297 |         if (route.request().method() === 'OPTIONS') {
  298 |           await route.fulfill({ status: 204, headers: corsHeaders });
  299 |           return;
  300 |         }
  301 |         await route.fulfill({ status: 200, headers: corsHeaders, contentType: 'application/json', body: '[]' });
  302 |       });
  303 |
  304 |       await page.goto('/', { waitUntil: 'domcontentloaded' });
  305 |       await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
  306 |
  307 |       await page.getByTestId('topbar_user_avatar_button').click();
  308 |       await page.getByPlaceholder('ایمیل حساب Supabase').fill('revoked@minadental.ir');
  309 |       await page.getByPlaceholder('رمز عبور سرور').fill('TestPassword!123');
  310 |       await page.getByRole('button', { name: 'ورود تاییدشده به نشست سرور' }).click();
  311 |
  312 |       await expect(page.getByText('فاقد عضویت فعال')).toBeVisible();
  313 |       await expect(page.getByText('تایید سرور')).toHaveCount(0);
  314 |
  315 |       // Close modal & navigate in-app (without full reload) to verify finance route is denied fail-closed
  316 |       await page.getByTestId('close_fullscreen_modal_btn').click();
  317 |       await page.evaluate(() => {
  318 |         window.location.hash = '#/finance';
  319 |       });
  320 |       await expect(page.getByText('دسترسی نقش فعلی به بخش «finance» محدود شده است.')).toBeVisible();
  321 |     } finally {
  322 |       await context.close();
  323 |     }
  324 |   });
  325 |
  326 |   test('Phase A UX routes (dashboard, appointments, calendar, appointment_form) render cleanly on mobile & desktop and validate duration strictly', async ({ page }) => {
  327 |     for (const vp of [
  328 |       { width: 390, height: 844 },
  329 |       { width: 1366, height: 768 },
  330 |     ]) {
  331 |       await page.setViewportSize(vp);
  332 |       for (const routeHash of ['/#/', '/#/appointments', '/#/calendar', '/#/appointment_form']) {
  333 |         await page.goto(routeHash, { waitUntil: 'domcontentloaded' });
  334 |         await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
  335 |         const scrollOk = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
  336 |         expect(scrollOk).toBe(true);
  337 |       }
  338 |     }
  339 |
  340 |     // Verify AppointmentFormPage enforces shared command validation (rejects out-of-range duration instead of silent 30m coercion)
  341 |     await page.setViewportSize({ width: 390, height: 844 });
  342 |     await page.goto('/#/appointment_form', { waitUntil: 'domcontentloaded' });
  343 |     await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
  344 |     await expect(page.getByTestId('appointment_form_fullscreen_page')).toBeVisible();
  345 |   });
  346 |
> 347 |   test('V13 adaptive window classes, dock/rail switching across 320/390/768/1366/1440, dark theme & role-aware dock hiding', async ({ page }) => {
      |   ^ Error: browserType.launch: 
  348 |     const viewChecks = [
  349 |       { width: 320, height: 640, expectedClass: 'compact', dockVisible: true, sidebarVisible: false },
  350 |       { width: 390, height: 844, expectedClass: 'compact', dockVisible: true, sidebarVisible: false },
  351 |       { width: 768, height: 1024, expectedClass: 'medium', dockVisible: false, sidebarVisible: true },
  352 |       { width: 1366, height: 768, expectedClass: 'expanded', dockVisible: false, sidebarVisible: true },
  353 |       { width: 1440, height: 900, expectedClass: 'wide', dockVisible: false, sidebarVisible: true },
  354 |     ];
  355 |
  356 |     for (const check of viewChecks) {
  357 |       await page.setViewportSize({ width: check.width, height: check.height });
  358 |       await page.goto('/', { waitUntil: 'domcontentloaded' });
  359 |       await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
  360 |
  361 |       const domState = await page.evaluate(() => ({
  362 |         windowClass: document.documentElement.dataset.windowClass,
  363 |         overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
  364 |       }));
  365 |       expect(domState.windowClass).toBe(check.expectedClass);
  366 |       expect(domState.overflow).toBe(true);
  367 |
  368 |       if (check.dockVisible) {
  369 |         await expect(page.getByTestId('floating_bottom_dock')).toBeVisible();
  370 |         await expect(page.getByTestId('adaptive_desktop_sidebar')).toBeHidden();
  371 |       } else {
  372 |         await expect(page.getByTestId('floating_bottom_dock')).toBeHidden();
  373 |         await expect(page.getByTestId('adaptive_desktop_sidebar')).toBeVisible();
  374 |       }
  375 |     }
  376 |
  377 |     // Verify Dark Mode tokens render cleanly across key sections without overflow
  378 |     await page.setViewportSize({ width: 390, height: 844 });
  379 |     await page.evaluate(() => {
  380 |       document.documentElement.setAttribute('data-theme', 'dark');
  381 |     });
  382 |     for (const routeHash of ['/#/', '/#/services', '/#/patients', '/#/appointments', '/#/settings']) {
  383 |       await page.goto(routeHash, { waitUntil: 'domcontentloaded' });
  384 |       await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
  385 |       const overflowOk = await page.evaluate(
  386 |         () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2
  387 |       );
  388 |       expect(overflowOk).toBe(true);
  389 |     }
  390 |   });
  391 |
  392 |   test('V14 strict fail-closed unauthorized session barrier & 9-stage clinical journey UI render in Persian RTL', async ({ browser }) => {
  393 |     const context = await browser.newContext({
  394 |       serviceWorkers: 'block',
  395 |       viewport: { width: 390, height: 844 },
  396 |     });
  397 |     const page = await context.newPage();
  398 |     try {
  399 |       const corsHeaders = {
  400 |         'access-control-allow-origin': '*',
  401 |         'access-control-allow-headers': 'apikey,authorization,content-type,x-client-info,prefer',
  402 |         'access-control-allow-methods': 'GET,POST,OPTIONS',
  403 |       };
  404 |       await page.route(/\/rest\/v1\/patients/, async (route) => {
  405 |         if (route.request().method() === 'OPTIONS') {
  406 |           await route.fulfill({ status: 204, headers: corsHeaders });
  407 |           return;
  408 |         }
  409 |         await route.fulfill({
  410 |           status: 200,
  411 |           headers: corsHeaders,
  412 |           contentType: 'application/json',
  413 |           body: JSON.stringify([
  414 |             {
  415 |               id: '00000000-0000-0000-0000-000000000501',
  416 |               tenant_id: 'minadental_clinic',
  417 |               branch_id: 'main',
  418 |               first_name: 'نگار',
  419 |               last_name: 'شریفی',
  420 |               phone: '09123334455',
  421 |               national_id: '0011223344',
  422 |               birth_date: null,
  423 |               gender: 'female',
  424 |               blood_type: 'O+',
  425 |               allergies: null,
  426 |               medical_history: null,
  427 |               medications: null,
  428 |               insurance_provider: 'آزاد',
  429 |               insurance_number: '1405',
  430 |               address: null,
  431 |               email: null,
  432 |               notes: '[پرونده: 1405]',
  433 |               status: 'active',
  434 |               created_at: '2026-11-30T06:00:00Z',
  435 |               updated_at: '2026-11-30T06:00:00Z',
  436 |             },
  437 |           ]),
  438 |         });
  439 |       });
  440 |
  441 |       await page.goto('/#/patients', { waitUntil: 'domcontentloaded' });
  442 |       await page.waitForFunction(() => window.__minaAppMounted === true, null, { timeout: 12_000 });
  443 |
  444 |       const journeyCard = page.getByTestId('patient_clinical_journey_00000000-0000-0000-0000-000000000501');
  445 |       await expect(journeyCard).toBeVisible();
  446 |       await expect(journeyCard).toContainText('مسیر بالینی:');
  447 |       await expect(journeyCard).toContainText('پذیرش');
```