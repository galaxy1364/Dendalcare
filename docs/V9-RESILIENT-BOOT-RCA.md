# MINADENTAL V9 — Resilient Boot & Release Root-Cause Analysis (RCA)

## 1. Smoking-Gun Evidence (User Screenshot — Samsung Internet)

Observed diagnostic banner on live `https://galaxy1364.github.io/Dendalcare/`:

```text
CODE=ASSET_LOAD_ERROR | ID=boot_mww75h72_30f1 | BUILD=dev-local (#0) | https://galaxy1364.github.io/Dendalcare/fonts/vazirmatn-arabic.woff2
```

### Dual Root Cause Proven by Evidence

1. **P0 Deployment Misconfiguration (GitHub Pages Source = Legacy Branch Root instead of `GitHub Actions`)**:
   - `BUILD=dev-local (#0)` proves that `https://galaxy1364.github.io/Dendalcare/` was serving raw repository root `/index.html` (where `__MINA_BUILD_ID_VALUE__` was never stamped by Vite, `<script type="module" src="./src/main.tsx">` points to raw uncompiled TSX, and `/fonts/` does not exist at repo root because static fonts live under `/public/fonts/` and are copied into `dist/fonts/` during build).
   - **Mandatory Owner Action in GitHub UI** (cannot be executed from container without GitHub admin credentials):
     1. Open `https://github.com/galaxy1364/Dendalcare/settings/pages`
     2. Under **Build and deployment → Source**, select **`GitHub Actions`** (NOT `Deploy from a branch`).
     3. Open **Actions → Deploy MinaDental to GitHub Pages** (or **MinaDental V8 Verified Release Pipeline**), click **Run workflow**, and on this **first migration run only**, check **`bootstrap_first_release = true`** so the fail-closed sequence guard bootstraps the initial `release-pointer.json`. After this first live deploy succeeds, all future deployments automatically enforce strict monotonic sequence checks against live `release-pointer.json`.

2. **P0 Client Pre-React Error Classification Bug (Fixed in V9)**:
   - Previous `/index.html` contained `<link rel="preload" href="./fonts/vazirmatn-arabic.woff2" as="font">` AND classified **every** `<LINK>` error event before React mount as fatal `ASSET_LOAD_ERROR`, opening `#boot-error` and blocking startup on a non-critical font 404.

## 2. V9 Engineering Controls Implemented

- **Non-Fatal Asset Classification (`index.html`)**:
  - Removed early `<link rel="preload" as="font">` tags.
  - Added Persian-safe fallback stack (`'Vazirmatn', 'Tahoma', 'SF Pro Display', 'IRANSansX', system-ui, -apple-system, sans-serif`).
  - `classifyResourceError()` classifies fonts, icons, manifests, preloads, images, and stylesheets as non-fatal warnings (`window.__minaBootWarnings`) so they NEVER trigger `#boot-error`.
  - Only critical `<SCRIPT>` failures (`RAW_TSX_DEPLOY_ERROR` / `ENTRY_SCRIPT_LOAD_ERROR`) or uncaught synchronous runtime errors trigger fatal recovery.
  - `isNonFatalBootRejection()` keeps Supabase/network/AbortError/fonts/update-pointer rejections non-fatal.
- **Root-Cause Lock & Honest Recovery UX (`index.html`)**:
  - `window.__minaBootFatalRootCause` locks the first real root cause so the 12s watchdog NEVER overwrites it.
  - Fatal errors stop the infinite splash bar animation (`splash-stopped`) and display honest copy with 3 actions (`تلاش مجدد`, `بازیابی ایمن کش پوسته`, `کپی گزارش فنی`).
  - `runScopedSafeRecovery()` unregisters ONLY Service Workers matching `/Dendalcare/` (preserving sibling apps on `galaxy1364.github.io`), deletes only `minadental-shell-*` / `minadental-v*` caches, and NEVER deletes IndexedDB, localStorage, or offline queues.
- **Artifact & Font Binary Integrity (`vite.config.ts`, `verify-asset-graph.mjs`, `ci-release-gate.mjs`)**:
  - `dist/fonts/*` are hashed in `release-manifest.json` and mirrored into immutable `dist/releases/<releaseId>/fonts/`.
  - `dist/404.html` and `dist/releases/<releaseId>/404.html` are emitted directly from built `dist/index.html` and verified byte-for-byte.
  - Real WOFF2 (`774f4632` = `wOF2`) and TTF (`00010000`) magic bytes + MIME types are verified on disk, over local HTTP across all targets, and in post-deploy `--verify-remote`.
- **Fail-Closed CI & Update Security (`ci-release-gate.mjs`, `ci.yml`, `release.yml`, `deploy.yml`, `policy.ts`, `coordinator.ts`)**:
  - Dedicated `.github/workflows/ci.yml` verifies PRs and `main` without auto-publishing.
  - `--compute-sequence --require-remote-pointer` fails closed if remote pointer cannot be read (unless explicit `--bootstrap-first-release` is passed).
  - `UpdateCoordinator` defaults `requireSignature = true` whenever `PINNED_RELEASE_PUBLIC_KEYS` is non-empty (fail-closed unless explicit migration opt-out).

## 3. Honest Verification Matrix

| Check | Status | Notes |
| --- | --- | --- |
| TypeScript (`npm run typecheck`) | Executed locally | Verified in container |
| Deterministic Build + `dist/404.html` + `dist/fonts/*` | Executed locally | Verified via `ci-release-gate.mjs --verify-local dist` |
| Asset Graph + Inline V8 Parse + Font Magic Bytes (`npm run verify:assets`) | Executed locally | Verified across `dist`, `dist/Dendalcare/`, `gh-pages-dist`, `android-www` |
| Automated Production + Fault-Injection Tests (`npm test`: V4+V5+V7+V8+V9) | Executed locally | Real inline `<script>` executed in Node `vm` |
| Android APK Compilation (`compile_applet`) | Executed locally | Synced `dist/` -> `app/src/main/assets/www` |
| Git branch / commit / push (`fix/v9-resilient-boot`) | **BLOCKED (`NO_GIT`)** | Workspace container has no `.git` metadata or remote credentials |
| GitHub Pages Settings (`Source = GitHub Actions`) & Live Production Deploy | **BLOCKED (Owner Action Required)** | Must be changed by repo owner in GitHub UI |
| Local Playwright Chromium/WebKit E2E | **BLOCKED (Container OS Libs)** | Wired in `.github/workflows/ci.yml` and `.github/workflows/release.yml` |
| Real Samsung Internet / iOS Safari / Android WebView Device QA | **BLOCKED (No Device Attached)** | Run after owner deploys via GitHub Actions |
