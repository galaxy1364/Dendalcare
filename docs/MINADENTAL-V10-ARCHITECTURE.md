# MinaDental V10 — Global Clinical Architecture & Safety Engineering

**Repository**: `galaxy1364/Dendalcare`  
**Verified Healthy Baseline**: `326bd19082ca623473acd0e0afced52508cbd41a`  
**Status**: Active Canonical Engineering Specification & Migration Blueprint (NOT a compliance certification)

> **Governance Rule**: Work incrementally and evidence-driven. Preserve all healthy capabilities, patient data, QBank visual geometry, curved-notch tiles, 4-tab floating Dock, 3-column Services launcher, and live Aurora background. Never perform risky full rewrites, never introduce parallel duplicate modules, never drop assertions to mask failures, and never claim unverified PASS or zero-error guarantees.

---

## P0 — Release Stabilization, Cache-Poisoning Immunity & Safe Recovery

1. **Service Worker Navigation Structural Integrity (`public/sw.js`)**:
   - Validate every navigation HTML response against HTTP 200, `text/html` MIME, stamped `minadental-build-id`, absence of raw `.tsx` (`src/main.tsx`), absence of `dev-local` / unresolved `__MINA_BUILD_ID`, presence of a valid compiled module entry script (`assets/*.js`), and exact build-ID coherence.
   - Structurally invalid HTML, raw TSX, `dev-local`, captive portals, or mismatched-release HTML MUST NEVER be stored in the active release cache.
   - Structural HTML verification prevents cache poisoning and broken deploys; it is **NOT** a substitute for cryptographic ECDSA manifest signature verification.
2. **Adversarial Verification (`tests/v10-sw-navigation.test.mjs` + Real Browser Upgrade A → B)**:
   - Execute `tests/v10-sw-navigation.test.mjs` alongside all V4–V9 suites on every run.
   - Validate A → B upgrade, cache poisoning, offline loss, HTTP 404/503, slow/stalled body reads, cache quota exhaustion (`QuotaExceededError`), multi-tab safe-point coordination, dirty unsaved forms, offline mutation queue preservation, unrelated cache preservation, and scoped recovery without wiping IndexedDB (using synthetic test fixtures only — never real patient records).
3. **Bounded Operations & Genuine Recovery**:
   - Enforce timeouts and cancellation on downloads, body reads, and cache operations; prevent reload loops.
   - Retain last-known-good & client-leased immutable assets until post-boot verification succeeds; forward rollback only when schema compatibility holds.
4. **Authoritative Single Release Pipeline**:
   - Single authoritative release path with shared concurrency lock (`build once / promote same artifact`), SHA-256 + ECDSA signature verification, pinned public keys + key rotation policy, SBOM, dependency audit, artifact provenance, and zero secrets in client bundles.
   - Fail-closed bootstrap: allowed ONLY on verified HTTP 404 + proven legacy unbuilt root (`src/main.tsx`) OR explicit operator bootstrap approval. Network errors, HTTP 503, malformed JSON, or valid live deployments without pointer NEVER authorize bootstrap.
   - Post-deploy verification: Chromium/WebKit E2E + live site smoke test (cold empty cache + warm old-SW cache). Green CI never replaces real post-deploy verification.

---

## P1 — Modular Monolith Architecture & Data Minimization

Preserve React / TypeScript / Vite / Supabase as a **modular monolith** with explicit boundaries:

```text
src/
  app/                 # composition root, boot, router, modular providers
    providers/         # AppearanceProvider, UpdateProvider, NotificationReadModel, etc.
  core/domain/         # pure value objects, clinical/financial rules, errors, events
  features/            # domain / application / infrastructure / presentation per bounded context
    patients/ appointments/ clinical-records/ odontogram/ treatment-plans/
    lab/ implants/ finance/ inventory/ staff/ reminders/ reports/ dashboard/
  services/            # auth, permissions, repositories, realtime, offline, updates
  navigation/          # typed routes, state restoration, deep links
  design-system/       # tokens, themes, accessible primitives, QBank geometry
  platform/            # capabilities, native haptics, safe area, gestures
```

- **Dependency Direction**: `presentation -> application -> domain`; `infrastructure` implements domain ports via dependency injection. Domain remains independent of React and browser globals. No cross-feature internal imports or direct writes to another feature's tables.
- **Incremental `AppProviders` Decomposition**: Split monolithic `AppProviders` into `AppearanceProvider`, `UpdateProvider`, `Auth/BootProvider`, `NotificationProvider`, and `NavigationProvider` while preserving a temporary backward-compatible `AppProviders` facade for safe incremental PR migration. Each provider owns its own lifecycle, cleanup, scoped state, selectors, and tests.
- **Shell-First Boot & Explicit States**: Shell must remain usable before network data resolves, with explicit `Loading`, `Empty`, `Error`, `Offline`, `Unauthorized`, and `Migration Required` states — never synthetic placeholder data.
- **Minimal Notification Read Model**: Strip sensitive clinical/identity PHI (`national_id`, `diagnosis`, `treatment_plan`, `medical_history`, `allergies`) from global shell notification queries; load sensitive PHI strictly inside authorized clinical modules while preserving exact alert behavior verified by before/after tests.
- **Typed Repositories & ADRs**: Boundary validation, honest pagination with truncation detection, authoritative server aggregation, cancellation, request coalescing, scoped realtime channels, and recorded ADRs (`docs/adr/`).

---

## P2 — Real Clinical Dentistry & Accounting Integrity

- **Stable Clinical Identity**: Immutable patient, branch, provider, and encounter identifiers; versioned medical history, allergies, medications, consents, exams, treatment plans, and attachments. Separate consent records from operational authorization.
- **Odontogram & Clinical Records**: Validated FDI contract (with Palmer mapping), surfaces, primary/permanent dentition, longitudinal history, periodontal charting, and record-linked imaging metadata (no public unauthenticated image URLs).
- **Clinical Lifecycle & Traceability**: Distinct validated states (`proposed -> accepted -> in_progress -> completed | cancelled | amended`); clinical sign-off with amendment reason, timestamp, and author — never destructive deletion. Track implant lot/serial numbers and lab chain of custody.
- **Time & Scheduling**: Jalali calendar for Persian display, canonical ISO/UTC timestamps stored in PostgreSQL, explicit `Asia/Tehran` timezone handling, server-side concurrency control for doctor/chair double-booking with audited overrides.
- **Accounting Integrity**: Canonical integer currency units (zero floating point), explicit Rial/Toman conversion, auditable ledger/reconciliation, reversing entries instead of deletion, idempotent writes, strict separation of accrued work, collected cash, profit, receivables, clearing checks, and guarantee checks. Tested for refunds, voids, duplicate payments, discounts, and accounting periods. Zero fabricated KPIs.
- **Schema Governance**: Expand/contract migrations, dry-runs, backups, restore drills, schema drift checks, and versioned FHIR mapping when interoperability is required. Never claim compliance certification without formal audit.

---

## P3 — Security & Privacy

- **Targets**: OWASP ASVS 5.0 Level 2 baseline with Level 3 controls on high-risk clinical/financial operations; NIST SSDF SP 800-218; maintained threat model and control/evidence matrix.
- **Server-Side Authorization**: Supabase Auth, verified tenant/branch membership, RBAC/ABAC, server-enforced RLS across `SELECT`/`INSERT`/`UPDATE`/`DELETE`/`RPC`/`storage`/`realtime` with default deny and cross-user/cross-role/cross-branch tests. `localStorage` roles are never authoritative; offline behavior defines explicit TTL, device lock, and revocation policy.
- **Client Vault & Isolation**: Scoped AES-GCM vault encryption with key lifecycle and AAD binding; zero stale data leak on user/branch switch or late responses; protected idempotent offline mutation queue with explicit conflict handling.
- **PHI Protection**: Patient data MUST NEVER enter public Service Worker caches, URLs, logs, telemetry, public repositories, or unauthorized AI services. Enforce data minimization, retention, encrypted backups, and audit trails. Never auto-claim GDPR/HIPAA or medical-device regulatory clearance.

---

## P4 — Design, Accessibility & Interaction Fidelity

- Preserve QBank geometry, Filled Duotone icons, calm pastel tokens, controllable Aurora background, 4-tab Dock, and 3-column Services launcher with zero advertising.
- **WCAG 2.2 AA**: Contrast, keyboard navigation, focus visibility, screen-reader semantics, RTL precision, zoom/large-text safe scrolling without clipping, reduced motion, >=48dp touch targets, accessible form errors and live announcements across `360x740`, `390x844`, `430x932`, `768x1024`, and desktop (measuring real containers, not only `document.body`).
- Full-screen routes, preserved form drafts, Back/Forward & deep links. Native iOS/Android capabilities only via real tested adapters — never misrepresent web CSS/vibration as native.

---

## P5 — Safe Intelligence & Operational Reliability

- AI features operate only on authorized data with explicit provenance and uncertainty; deterministic clinical/financial calculations live in domain/RPC layers. High-risk actions require explicit human confirmation and permissions — no autonomous diagnosis, prescribing, or treatment alteration.
- Measurable baseline SLOs (p95 boot/route latency, error rate, sync lag, update success rate, recovery time), performance budgets, PHI-free alerting, and fault containment. Never promise "zero errors forever".

---

## Definition of Done (Every PR / Release)

Required per change: scope, changed files, relevant tests, migration risk, rollback path, execution evidence, and open gaps.  
Mandatory checks: `npm run typecheck`, `npm run build`, `npm run verify:assets`, `npm test`, `npm run test:e2e`, staging RLS tests, restore/offline drills, and post-deploy smoke checks.  
Reporting honesty rule: report only genuine `PASS` (with evidence), `FAIL` (with logs), or `NOT VERIFIED / BLOCKED`.

## References
- OWASP ASVS: https://owasp.org/projects/asvs/
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- NIST SSDF: https://csrc.nist.gov/pubs/sp/800/218/final
