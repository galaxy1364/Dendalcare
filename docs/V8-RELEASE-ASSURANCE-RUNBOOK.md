# MinaDental V8.1 Incident & V8 Release Assurance Runbook

## 1. V8.1 Incident Root Cause Analysis — Stuck Boot on `galaxy1364.github.io`

### Observed Symptom (Samsung Internet Screenshot)
Users opening `https://galaxy1364.github.io/Dendalcare/` saw the `#app-splash` overlay stuck open with the Persian recovery panel (`بارگذاری رابط کاربری کامل نشد...`).

### Confirmed Root Causes & Remediations

1. **Primary Deployment Vector (GitHub Pages Source Misconfiguration)**:
   - Repository root `/index.html` is the Vite development entry pointing to `<script type="module" src="./src/main.tsx">`.
   - If GitHub Repository **Settings → Pages → Build and deployment → Source** is set to `Deploy from a branch (main / root)`, GitHub Pages serves raw `.tsx` source instead of the built `./dist` bundle. Browsers reject `.tsx` with a MIME/syntax failure, triggering `#boot-error`.
   - **Mandatory Operator Action**: Verify **Settings → Pages → Source = `GitHub Actions`** so `.github/workflows/deploy.yml` / `.github/workflows/release.yml` publishes `./dist` exclusively.
   - **Automated CI Guard**: Both workflows now run `node scripts/ci-release-gate.mjs --verify-remote "$DEPLOYED_URL"` immediately after `deploy-pages@v4`, failing the deployment if `index.html` contains `src/main.tsx`, unresolved `__MINA_*`, wrong MIME types, or SHA-256 mismatches.

2. **Client-Side Boot Resilience Defects Fixed in V8.1**:
   - `#boot-error` was previously nested inside `#app-splash`; it is now an independent sibling outside `#app-splash` and `#root` so removing the splash can never hide recovery.
   - Pre-React inline error listeners (`error`, `unhandledrejection`) were moved **before** `<script type="module" src="./src/main.tsx">` and now capture both asset load failures AND runtime `ErrorEvent`s with sanitized diagnostic code, correlation ID, build ID, and sequence number (zero patient PII).
   - The 12-second boot watchdog timer is stored on `window.__minaBootWatchdogTimer` and explicitly cancelled by `markShellCommitted()` / `window.__minaCancelBootWatchdog()`.
   - Distinct boot milestones (`moduleEvaluatedAt`, `shellCommittedAt`, `authResolvedAt`, `routeRenderedAt`, `readyAt`, `renderedRoute`) are tracked cleanly.
   - `getVerifiedSupabaseSession()` is now bounded by an independent `6000ms` timeout (`AUTH_SESSION_TIMEOUT_MS`), failing closed to `unauthenticated` rather than hanging startup.

---

## 2. V8 Architecture Decision Record (ADR)

### Release Identity & Integrity
- **Content Digest**: Full 64-hex SHA-256 computed over canonical `assets/*`, pre-stamp `index.html`, pre-stamp `public/sw.js`, `manifest.json`, and compatibility metadata (`semver`, `channel`, `minNativeVersion`, `minSchemaVersion`). Zero recursive self-reference.
- **Immutable Release Staging**: `vite.config.ts` stages complete versioned release files under `dist/releases/<releaseId>/` (`index.html`, `assets/*`, `manifest.json`, `sw.js`, `release-manifest.json`), and points `release-pointer.json`, `android-release-pointer.json`, and `ios-release-pointer.json` at `./releases/<releaseId>/release-manifest.json`.
- **Single-Pass Anti-TOCTOU Staging**: `manifestClient.ts` enforces unified fetch + body-read + SHA-256 deadlines, byte-size bounds, cross-origin redirect rejection, and passes verified `ArrayBuffer` bytes directly into `WebPwaUpdateAdapter`'s candidate `CacheStorage` via `onVerifiedAsset`.
- **Service Worker Strict Activation**: `public/sw.js` removed legacy `FORCE_UPDATE`; `SKIP_WAITING` requires exact `targetReleaseId`; `VERIFY_CACHE_INVENTORY` verifies cached critical entries; `CLIENT_RELEASE_LEASE` protects active and waiting client caches during pruning.

### Autonomous Safe-Point Coordinator
- **True End-to-End Auto-Update**: When `autoUpdateEnabled === true` and safe-point is clear, `UpdateCoordinator` automatically progresses `AVAILABLE -> DOWNLOADING -> VERIFYING -> READY_TO_ACTIVATE -> ACTIVATING -> BOOT_VERIFYING` with a single controlled reload and cross-tab fencing-token lock.
- **Clinical Safe-Point Guards**: `useUpdateSafePointGuard` is wired into `PatientFormPage`, `AppointmentFormPage`, `TreatmentFormPage`, and the shared `Sheet` modal component (covering Finance, Checks, Installments, Safteh, Lab, Implants, Inventory, and Reminders). When a guard or offline queue clears, activation automatically resumes.
- **Guarded Rollback Recovery**: `lastKnownGoodReleaseId` is stamped ONLY after `verifyPostBoot()` passes. `acknowledgeRollbackToLastKnownGood()` performs a live post-boot handshake against the verified LKG release and refuses fake `ROLLED_BACK` with `RECOVERY_VERIFICATION_FAILED` if unverified.

---

## 3. Signing & Native Store Prerequisites (Honest Status)

- **ECDSA P-256 Signing**: Supported in `vite.config.ts` and CI workflows via `secrets.MINA_SIGNING_PRIVATE_KEY_JWK`, `secrets.MINA_SIGNING_KEY_ID`, and `vars.VITE_PINNED_RELEASE_KEYS_JSON`. Until provisioned in GitHub Repository Secrets/Variables, Web/PWA operates honestly in `unsigned_web_origin_only` mode (HTTPS origin + per-file SHA-256 verification).
- **Android / iOS Store Deep-Links**: `NativePlatformUpdateAdapter` queries explicit remote HTTPS `android-release-pointer.json` / `ios-release-pointer.json` and reports `supportsStoreDeepLink: false` (`storeUrl: null`) until `VITE_ANDROID_PLAY_STORE_URL` / `VITE_IOS_APP_STORE_URL` are configured in GitHub Variables. Never invents fake store links or silent APK/IPA installs.

---

## 4. Rollback & Incident Playbook

1. **Emergency Forward Rollback (Recommended)**:
   - Publish a new CI build of the last known good commit with a strictly higher `MINA_RELEASE_SEQUENCE`.
   - Clients automatically validate the new monotonic sequence and upgrade cleanly without violating anti-downgrade rules.
2. **Revoking a Broken Release**:
   - Add the broken `releaseId` to `revokedReleaseIds` in `release-pointer.json` and publish a higher-sequence replacement release.
3. **Emergency Client Recovery**:
   - Users seeing `#boot-error` can click **"پاک‌سازی کش پوسته و بارگذاری مجدد"**, which clears only `minadental-*` shell caches and unregisters stale Service Workers without touching IndexedDB patient records or offline mutation queues.
