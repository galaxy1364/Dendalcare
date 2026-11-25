# MinaDental V10 — Architecture & Safety Contract

Baseline: 326bd19082ca623473acd0e0afced52508cbd41a. The production version is reported working after cache cleanup. All changes must be incremental and reversible. This document defines target requirements, not a claim of compliance.

## 1. Architecture
Keep React/TypeScript/Vite, Supabase, QBank tiles, Aurora and existing routes. Use a modular monolith, not unnecessary microservices.
- app: composition root, minimal boot shell, session lifecycle, router, global error boundaries.
- core/domain: pure entities, invariants, value objects, clinical state machines; no React or browser dependencies.
- features: patients, appointments, clinical-records, odontogram, treatment-plans, lab, implants, finance, inventory, staff, reminders, reports. Each has domain, application/use-cases, infrastructure adapters and presentation.
- services: typed Supabase repositories, session and authorization, realtime, scoped encrypted offline vault, idempotent mutation queue, update coordinator.
- platform/design-system: capabilities, haptics, gestures, safe area, tokens, accessible primitives and existing QBank geometry.
- Enforce dependency direction: presentation -> application -> domain; infrastructure implements ports. No feature imports another feature's private UI or writes to another feature's tables directly.
- Split AppProviders (1145 lines) by responsibility: boot/auth, navigation, notifications, preferences and update lifecycle. Keep compatibility facade during migration; remove it only after all consumers migrate and tests pass.
- Global shell currently subscribes to eleven tables including patient identifiers and treatment diagnosis. Replace with authorized minimal alert read model/aggregate, then load sensitive records only in the authorized feature. Do not silently remove alert capabilities.

## 2. Clinical and financial invariants
Versioned medical history, allergies, consent, examination, periodontal and FDI tooth/surface data, proposed/accepted/performed/completed/cancelled treatment separated. Clinical amendments retain original author/date, reason and history; never silently overwrite signed records. Track implant lot/serial and lab case chain. Use scheduling timezone Asia/Tehran and store canonical timestamps. Prevent double bookings server-side; concurrency constraints and explicit overrides with audit.
Use integer money in one canonical unit, explicit currency/display conversion, append-only journal with reversals, idempotency keys, reconciliation, separate accrual revenue/cash/receivables/guarantees. No fabricated KPI or silent truncation. Server authoritative transactions and validation; database migrations expand-contract, backups and restore rehearsals. Interoperability: versioned FHIR mapping where justified; validate against selected specification and local dental coding conventions, do not claim certification.

## 3. Security / privacy
Target OWASP ASVS 5.0 Level 2, selected Level 3 controls for high-risk functions; NIST SSDF SP 800-218. Threat model and traceable test evidence. Tenant/branch membership and permission checks enforced server-side for reads/writes/RPC/storage/realtime, deny by default. Local roles never grant access beyond independently verified authorization. Separate offline authorized-session policy with expiry, revocation, device lock and explicit sync conflicts. No PHI in logs, URLs, service worker cache, analytics or public repository. Minimize collection and retention; encrypted scoped offline vault, session isolation and key lifecycle; prevent cross-account late responses. Audit access and changes, no secrets in client. Determine local health/privacy obligations with qualified counsel; HIPAA/GDPR/medical-device rules depend on applicability.

## 4. UI and platform
Preserve QBank notched tiles, four-destination floating dock, independent service launcher, pastel light/dark palette and Gemini-inspired Aurora. No ads. Root dashboard fits typical screen when feasible; do not clip at small screens or enlarged fonts. Full-screen routes, RTL, accessible focus/keyboard/screen reader, WCAG 2.2 AA, reduced motion, contrast, touch targets and safe areas. Test 360x740, 390x844, 430x932, 768x1024 and desktop. Native Swift/UIKit or Android adapters only where actually implemented/tested; no false native iOS claims.

## 5. Release & observability
Protect main, require review and mandatory checks. Build once and promote same immutable artifacts; validate SHA-256/signatures with pinned keys, exact release identity, monotonic sequence, dependency audit, SBOM and health checks. Keep valid prior release artifacts; rollback via verified safe release or forward rollback, never erase offline data. Separate staging from production; real Chromium/WebKit boot with old SW/caches and upgrade A->B before publishing; live smoke after deploy. Legacy bootstrap only after confirmed pointer 404 and verified raw root or authorized empty site. Never weaken checks to get green CI.
V10 first patch: service worker validates navigation build marker and actual script entry, rejects raw TSX/missing IDs/wrong MIME/invalid HTTP; valid newer shell is served without mixing old cache; fallback only current matching release. This is structural validation, not signature proof. Regression tests in tests/v10-sw-navigation.test.mjs. Further work: bounded cache operations, end-to-end real upgrade with old worker and data preservation, immutable artifact retention and recovery.
Set measurable SLOs from baseline (boot p95, route latency, sync success, error rates); use synthetic checks without patient data. Monitor failed deployment and alert operators. Never promise zero errors.

## 6. AI and acceptance
AI explains verified metrics, prioritizes workflow and cites authorized sources with confidence/uncertainty; clinician reviews clinical suggestions. No autonomous diagnosis, prescribing or irreversible changes. No sensitive data sent without lawful authorization, minimization and vendor safeguards.
Each PR includes issue, affected files, migration risk, tests, before/after screenshots where UI changes, rollback plan and known gaps. Run typecheck, build, verify:assets, npm test, E2E Chromium/WebKit, RLS negative matrix in staging, offline/reconnect and migration/restore tests. No PASS, certification, or production-ready claims without evidence. Do not touch live patient data for tests.

## References
- https://owasp.org/projects/asvs/
- https://www.w3.org/TR/WCAG22/
- https://csrc.nist.gov/pubs/sp/800/218/final
