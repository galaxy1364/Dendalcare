# MinaDental V7 — Verified Release & Update Engineering Runbook

## 1. Architecture Decision Record (ADR-V7)

- **Context**: Prior versions mixed client-side release broadcasting (`clinic_settings`), unverified `installedAt` stamping on checks, `Date.now()` fallback build IDs, raw `controllerchange` reload loops, and premature `INSTALLED` reporting before post-boot verification.
- **Decision**:
  1. **Single Authoritative Release Pipeline**: Only CI/CD publishes Schema v2 `release-pointer.json` and `release-manifest.json` with immutable content-derived `releaseId` (`v<semver>-<10hex>`) and strict monotonic `releaseSequence`. Clients NEVER possess publish authority.
  2. **Single `UpdateCoordinator` (`src/services/updates/`)**: Enforces a strictly typed 17-state machine, single-flight mutex + Web Locks / cross-tab lease, multi-tab safe-point consensus (`BroadcastChannel` + dirty-form guards + offline payment queue checks), real SHA-256 & byte-based progress, and post-boot runtime+worker handshake verification.
  3. **Honest Platform Adapters**:
     - **Web / PWA (`WebPwaUpdateAdapter`)**: Controlled SW `reg.update()` + `SKIP_WAITING` + single reload ONLY at a safe point; obsolete `minadental-shell-*` caches pruned ONLY after verified boot.
     - **Android WebView / Play Store & iOS App Store (`NativePlatformUpdateAdapter`)**: Reports `NATIVE_STORE_REQUIRED` and opens official store listing. Zero `REQUEST_INSTALL_PACKAGES`, zero DCL, compliant with Google Play Creator Program & Apple Guideline 2.5.2.
- **Consequences**: `INSTALLED` is unreachable without a real post-boot runtime + worker identity match; offline/5xx/timeout/tamper states always fail closed without corrupting active clinical workflows or offline queues.

---

## 2. Authoritative Release Manifest & Pointer Schema (v2)

### `release-pointer.json`
| Field | Type | Description |
| :--- | :--- | :--- |
| `schemaVersion` | `2` | Fixed contract version |
| `channel` | `'stable' \| 'staging' \| 'canary'` | Release channel |
| `platform` | `'web' \| 'pwa' \| 'android' \| 'ios' \| 'windows'` | Target platform |
| `currentReleaseId` | `string` (`v<semver>-<10hex>`) | Immutable content digest identity |
| `releaseSequence` | `integer >= 1` | Strict CI monotonic sequence |
| `manifestUrl` | `string` (HTTPS-allowlisted or `./...`) | Pointer to immutable manifest |
| `updatedAt` | `ISO-8601 string` | Publication timestamp |
| `revokedReleaseIds` | `string[]` | Revoked release IDs rejected immediately |

### `release-manifest.json`
| Field | Type | Description |
| :--- | :--- | :--- |
| `schemaVersion` | `2` | Fixed contract version |
| `releaseId` | `string` | Must match `pointer.currentReleaseId` |
| `releaseSequence` | `integer` | Must match `pointer.releaseSequence`; same seq + different digest => `SEQUENCE_CONFLICT` |
| `semver` | `string` | Unified across `package.json`, `version.json`, `cloudSyncEngine.ts`, and `app/build.gradle.kts` |
| `gitCommit` | `string` | Source commit SHA |
| `minNativeVersion` | `string` | Minimum compatible native wrapper version |
| `minSchemaVersion` | `integer` | Minimum compatible DB schema version |
| `assets[]` | `{ path, sha256, size, critical, contentType }[]` | Every production asset with real SHA-256 + byte size |
| `signature` / `keyId` | `string` (optional on same-origin Web, required for non-Play custom packages) | Base64 ECDSA P-256 SHA-256 signature over canonical JSON payload |
| `rollbackPolicy` | `{ strategy: 'forward_release', minRollbackSequence, schemaBackwardCompatible, preserveUserData: true }` | Forward-release rollback rules |

---

## 3. State Machine Transition Table (`ALLOWED_UPDATE_TRANSITIONS`)

| From State | Allowed Next States |
| :--- | :--- |
| `IDLE` | `CHECKING`, `BOOT_VERIFYING`, `OFFLINE`, `ROLLBACK_PENDING` |
| `CHECKING` | `UP_TO_DATE`, `AVAILABLE`, `CHECK_FAILED`, `OFFLINE`, `NATIVE_STORE_REQUIRED` |
| `UP_TO_DATE` | `CHECKING`, `OFFLINE`, `IDLE` |
| `AVAILABLE` | `DOWNLOADING`, `CHECKING`, `OFFLINE`, `NATIVE_STORE_REQUIRED`, `FAILED`, `IDLE` |
| `CHECK_FAILED` | `CHECKING`, `OFFLINE`, `IDLE` |
| `OFFLINE` | `CHECKING`, `IDLE` |
| `DOWNLOADING` | `VERIFYING`, `FAILED`, `OFFLINE`, `AVAILABLE` |
| `VERIFYING` | `READY_TO_ACTIVATE`, `WAITING_FOR_SAFE_POINT`, `FAILED`, `OFFLINE` |
| `READY_TO_ACTIVATE` | `ACTIVATING`, `WAITING_FOR_SAFE_POINT`, `CHECKING`, `FAILED`, `IDLE` |
| `WAITING_FOR_SAFE_POINT` | `READY_TO_ACTIVATE`, `ACTIVATING`, `CHECKING`, `FAILED`, `IDLE` |
| `ACTIVATING` | `BOOT_VERIFYING`, `FAILED`, `ROLLBACK_PENDING` |
| `BOOT_VERIFYING` | `INSTALLED`, `ROLLBACK_PENDING`, `FAILED` |
| `INSTALLED` | `CHECKING`, `UP_TO_DATE`, `OFFLINE`, `IDLE` |
| `FAILED` | `CHECKING`, `AVAILABLE`, `DOWNLOADING`, `ROLLBACK_PENDING`, `OFFLINE`, `IDLE` |
| `ROLLBACK_PENDING` | `ROLLED_BACK`, `FAILED`, `IDLE` |
| `ROLLED_BACK` | `CHECKING`, `IDLE`, `OFFLINE` |
| `NATIVE_STORE_REQUIRED` | `CHECKING`, `OFFLINE`, `IDLE` |

*Guarantee*: `INSTALLED` is **only** reachable from `BOOT_VERIFYING` after `verifyPostBootHandshake()` confirms both runtime `releaseId` and active Service Worker `buildId` match `pendingActivation.targetReleaseId`.

---

## 4. Key Rotation & Revocation Policy

1. **Key Storage**: Private ECDSA P-256 signing keys live strictly in CI/CD Secrets or KMS — never committed to git or bundled into client builds. Only public JWK entries (`PinnedPublicKey`) are embedded in `PINNED_RELEASE_PUBLIC_KEYS`.
2. **Rotation (Zero-Downtime 2-Step)**:
   - Step A: Ship a release with the new public key (`keyId: "minadental-ci-2027-v1"`, `status: "active"`) alongside the previous key (`status: "rotated"`).
   - Step B: Switch CI signing secret to the new private key once clients have updated.
3. **Emergency Revocation**:
   - Mark compromised key `status: "revoked"` and/or add affected `releaseId` to `release-pointer.json -> revokedReleaseIds[]`.
   - Clients fail closed with `SIGNATURE_INVALID` or `RELEASE_REVOKED` immediately.

---

## 5. Staging Promotion & Forward-Release Rollback Drill

### Staging -> Production Promotion
1. Trigger `.github/workflows/release.yml` with `channel: staging`.
2. Verify CI gates pass: Secret Scan, Typecheck, Deterministic Build, `verify:assets` (HTTP 200 + MIME + per-file SHA-256), Unit/V7 Suite, and Playwright E2E.
3. Confirm Staging Health Gate reports matching `releaseId` and `releaseSequence`.
4. Trigger `.github/workflows/release.yml` with `channel: stable` and approve the GitHub `production` Environment gate.

### Emergency Rollback Drill (Forward-Release Only)
Because clients strictly reject downgrades (`candidate.releaseSequence < current.releaseSequence => DOWNGRADE_REJECTED`), rollback NEVER re-publishes an older sequence number:
1. Checkout the last-known-good commit on a hotfix branch (`git revert <bad-commit>`).
2. Add the bad `releaseId` to `revokedReleaseIds` in `release-pointer.json`.
3. Trigger `.github/workflows/release.yml` so CI assigns a **strictly higher** `releaseSequence` (`N+1`) with a new content-derived `releaseId` (`rollbackPolicy.strategy = 'forward_release'`, `preserveUserData = true`).
4. Verify clients on the bad build upgrade forward cleanly to sequence `N+1` with zero IndexedDB/localStorage/offline-queue loss.
