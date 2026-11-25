# ADR-001: V10 Resilient Foundation, SW HTML Integrity Guard & Incremental Provider Decomposition

- **Date**: 2026-11-25
- **Status**: Accepted & Active
- **Scope**: P0 Service Worker Navigation Hardening + P1 Incremental Modularization & Shell Data Minimization

## Context
1. Legacy GitHub Pages misconfiguration (`Deploy from a branch` serving raw `src/main.tsx` and `dev-local`) demonstrated that any Service Worker caching unvalidated HTTP 200 `text/html` navigation responses risks poisoning its own release cache with raw TSX, captive-portal HTML, or mismatched build HTML.
2. `src/app/AppProviders.tsx` had grown to 1,145 lines mixing Appearance/Haptics, Autonomous Update lifecycle, Auth/Session, Navigation, and 11-table notification subscriptions that included unnecessary sensitive fields (`national_id`, `diagnosis`, `treatment_plan`).

## Decisions
1. **Structural HTML Integrity Gate in `public/sw.js` (NOT a replacement for cryptographic signing)**:
   - `validateNavigationHtml()` enforces HTTP 200, `text/html`, valid `minadental-build-id`, absence of raw `.tsx` (`src/main.tsx`), absence of `dev-local` / unresolved placeholders in production builds, presence of a compiled module entry script (`assets/*.js`), and exact match against the worker's `RESOLVED_BUILD_ID`.
   - Structurally invalid navigation HTML is never cached; when a verified cached `./index.html` exists, SW serves the healthy cached shell instead of broken network HTML.
   - Cryptographic authenticity remains strictly governed by ECDSA P-256 verification inside `src/services/updates/` (`PINNED_RELEASE_PUBLIC_KEYS` + fail-closed `DEFAULT_REQUIRE_RELEASE_SIGNATURE`).
2. **Incremental Provider Extraction with Backward-Compatible Facade**:
   - Extract `AppearanceProvider` (`src/app/providers/AppearanceProvider.tsx`), `UpdateProvider` (`src/app/providers/UpdateProvider.tsx`), and `NotificationReadModel` (`src/app/providers/NotificationReadModel.ts`) first.
   - Retain `AppProviders.tsx` as the stable composition facade so all existing shell consumers (`AppShell`, `AppRouter`, `OverlayManager`, `QBankFoldersOverlay`) continue working with zero breaking changes while subsequent PRs complete Auth/Notification extraction.
3. **Shell Notification Read-Model Data Minimization**:
   - Remove `national_id`, `diagnosis`, and `treatment_plan` from global shell realtime projections in `AppProviders` via `NOTIFICATION_READ_MODEL_PROJECTIONS`.
   - Keep full clinical/identity PHI strictly scoped to authorized feature modules (`PatientsSection`, `TreatmentsSection`) backed by server-side RLS.

## Rollback Plan
- Every change is additive/modular and keeps the `useClinicShell()` contract intact. Reverting `public/sw.js` or provider extraction restores the V9 baseline without touching PostgreSQL schema, IndexedDB vault, or offline mutation queues.
