# MinaDental — Global UX & Architecture Master Specification

**Version:** Design audit 1.0 | **Date:** 2026-11-26 | **Reviewed source:** `galaxy1364/Dendalcare`, commit `7925767ce462b2d61cf983e5bd4b80e1bf5ddf99`.  
**Storage Status:** Locked in Permanent Project Memory (`MemPalace` `milestone-14` / `TRC-MINA-UX-AUDIT-V1-9014-N`).

## 0. Authority and scope — instructions for Google AI Studio
Gemini is the sole implementation writer. ChatGPT is chief architecture engineer and independent reviewer. Read [coordination issue #4](https://github.com/galaxy1364/Dendalcare/issues/4) and `AGENTS.md`/`GEMINI.md` in the current checkout. Preserve unsynced edits; reconcile open PRs before merging. Never blindly overwrite, replay migrations, change Supabase project, or publish with failed tests. This is a design and source-code review, not a live visual/usability audit or a compliance certification. No source or database changes were made by this review. Re-read HEAD before acting; line references below refer only to the reviewed commit. Do not implement every module in one uncontrolled change. Begin with dashboard + appointments and their shared security/data contracts. Keep existing workflows working. Confirm proposed visual hierarchy with clinic staff before major redesign.

## 1. Evidence-based reference model
Use these as sources of workflow patterns, not as templates to clone or as a claim of worldwide rank. Vendor documentation establishes documented capability, not independently measured superiority.

| Reference | Relevant pattern | MinaDental application |
|---|---|---|
| Open Dental appointments, chart, treatment plan | Procedure-linked scheduling, recall, clinical chart, plan priorities | One connected patient timeline and treatment plan; traceable clinical edits |
| Dentally visit management, smart booking, calendar | Daily visit flow, suggestions that fill diary gaps, resource availability | Role-specific work queue, explainable slot suggestions |
| Dentrix Ascend routing, schedule customization | Arrived/chair workflow, variable time scale, missed visit history | Operational board and resource-aware schedule |
| Curve analytics, feature overview | Production, collections, AR, recare, treatment plan value; clinical AI features | Separate financial facts from operational tasks and AI drafts |
| NHS design system, accessibility | Consistency, understandable errors and accessibility | Accessible Persian-first interaction patterns |
| Apple HIG layout, buttons, tabs | Stable navigation, safe areas, touch targets | Keep QBank capsule geometry without squeezing content |

### Design and engineering standards
- **WCAG 2.2**: target AA; 4.5:1 normal text, 3:1 large text and applicable non-text contrast; focus visible/not obscured; alternatives to drag; reflow and zoom. WCAG does not impose a universal minimum font size. Our proposed mobile targets are stricter than its 24 CSS-px minimum (subject to exceptions).
- **OWASP ASVS 5.0**: map requirements to verified controls, not badges. Target a risk-assessed Level 2 baseline and review additional high-risk controls for clinical/financial data.
- **HL7 FHIR R4 Appointment / Dental Data Exchange STU1**: model interoperability through explicit adapters and terminology; the dental IG is US-realm and is not a universal regulatory mandate. Verify local coding/licensing before adoption. Use ISO 3950/FDI-style two-digit tooth identification as a proposed clinical convention after clinician validation; store explicit dentition, tooth, surface and code-system version.
- **NHS clinical risk management / DCB0129**: maintain hazards, mitigations, evidence, ownership and residual risks. England-specific standards serve as reference outside their jurisdiction.
- **NIST AI RMF / Generative AI Profile**: evaluate AI limitations, privacy, monitoring, human control. Use AI as assistive drafts, never autonomous clinical decisions.
- **Legal review**: actual operating jurisdiction, patient consent, retention, access rights, cross-border data, breach response, payment/accounting and medical-device scope must be confirmed separately. Do not assert HIPAA/GDPR/ISO certification merely from architectural intent.

## 2. Source audit — preserve and improve
| Priority | Evidence at reviewed SHA | Risk / acceptance requirement |
|---|---|---|
| P0 | `src/features/forms/OperationalFormRoutes.tsx` 220–292; `AppointmentFormPage` direct insert; duration fallback `Math.max(10, Number(duration) || 30)` | Unify validation with full appointment workflow; no silent coercion of invalid duration; choose actual patient, provider and resource where required. |
| P0 | `src/components/sections/Appointments.tsx` 169–172, 225–245; `CalendarSection.tsx` 308–310 | Multiple direct write paths. A shared domain command and server transaction must enforce the same rules regardless of route, client or offline replay. |
| P0 | `src/services/permissions/accessControl.ts` 67–110; missing verified role falls back to secretary | Introduce explicit unauthorized state. UI access must derive from active membership, not local fallback. Server/RLS is the authority. Test revoked role and branch switches. |
| P1 | `AppointmentForm.tsx` 70–133 checks duration and local conflicts, proposes slots; room can be free text | Useful UX but client checks do not prove atomic conflict prevention. Verify database-level constraint/locking with simultaneous clients; use resource IDs, not labels. |
| P1 | `Appointments.tsx` 26–38, 225–226, 700–706 | Centralize legal status transitions and role permissions; distinguish arriving, waiting, chair, completed, cancelled/no-show; prevent invalid transition from any shortcut. |
| P1 | `DashboardPage.tsx` 9–19, 48–74, 130–169 | Existing compact brief, 5 quick actions, 4 favorites and one priority alert are a solid shell. Do not hide safety actions or force tiny type to maintain no-scroll on every viewport. Retain urgent fallback and verify scroll/focus. |
| P1 | `SmartBrief.tsx` 161–192, `useDashboard.ts` 67–91 | Existing KPI completeness input and server summary are strengths. Require role-specific cards, period and scope, metric provenance, explicit missing/stale state, and drilldown preserving filters. Confirm actual financial query semantics. |
| P2 | `Appointments.tsx` 881 lines; `CalendarSection.tsx` 995 lines; `AppShell.tsx` inline styles and mixed overlays | Split views, commands, selectors, resources, status, and tokens incrementally. Size alone is not a defect; split only when responsibilities and tests support it. |
| P2 | `FloatingDock.tsx` 61–165; active capsule and separate services circle | Preserve QBank geometry; test destination semantics, text resizing, screen reader labels, keyboard access and stable selection across nested routes. |

## 3. Design system — human, not generic AI dashboard
- Calm, precise clinical workspace with distinctive Persian identity. Every component serves a real task. Avoid oversized generic hero, meaningless graph, excessive pill badges, artificial success metrics, repeated card-within-card, gratuitous gradients, excessive icon colors, decorative AI sparkles, and redundant navigation.
- Restrained Aurora behind shell only; opaque/near-opaque working surfaces, stable contrast, no distracting animation during charting or payment. Maintain reduced-motion setting.
- Keep recognizable QBank bottom dock (4 destinations + separate services circle) and 3-column services grid; use rail/sidebar and split view on wide screens. Never allow branding to override clinical warning clarity.
- Tokens (to be tested per combination): Light canvas `#F4F7F9`, surface `#FFFFFF`, text `#14283B`, muted `#526779`, brand `#087C76`, deep brand `#075C57`, border `#D8E2EA`. Dark canvas `#0A141E`, surface `#11202E`, primary text `#F1F5F9`, muted `#B4C6D8`.
- Semantic red=critical/unsafe, amber=needs attention, green=confirmed successful, blue=information. Pair color with icon and explicit label. Color must never be sole status channel.
- Persian typography: retain locally bundled Vazirmatn typeface; Body 14–16 CSS px, secondary 12–14, heading 18–24, KPI 22–28; allow browser zoom and OS text scaling.
- RTL logical CSS properties, logical focus order, direction-safe dates/phone/national ID, bidi isolation, correct back/forward and temporal axis behavior. Never mirror clinical tooth identity/anatomical left/right. Jalali display/selection, Gregorian/UTC storage with branch timezone and explicit conversion. Saturday-first calendar default for Persian locale.
- Test 320, 360, 390, 430, 768, 1024, 1440 px and text zoom 200%; safe area, keyboard, landscape, reduced motion and dark theme.

## 4. Dashboard — clinical command center, not decorative statistics
- Purpose: answer in seconds: What is happening? What needs attention? What do I do next? Home is an operational snapshot; analytics is a distinct reports destination. Default to current authorized clinic/branch and local date; display freshness timestamp and explicit offline/partial state. Personalize by verified role, not self-selected role.
- Role emphasis: Reception (arrivals, waiting, recalls), Dentist (next patient, safety prerequisites, pending notes), Assistant (chair readiness, sterilization, lab delivery), Manager (capacity, no-shows, collections, production, AR, exceptions).
- Metric contract: every KPI has owner, definition, time window, branch, numerator/denominator, source, missingness behavior. Confirmed appointments exclude cancelled/no-show; occupancy uses eligible resource minutes; waiting time uses chair-start minus arrival (median/p90); production counts authorized completed treatment at performed/completed date; collections count settled cash events with refund reversals; receivables exclude guarantee instruments; preserve exact Toman/Rial integer conversion; distinguish unavailable/unauthorized from true zero.

## 5. Appointments — one scheduling engine, multiple views
- User jobs: reserve safely, see daily work, manage arrival/wait/seat, finish or reschedule, recover canceled gaps. Patient calendar and global clinic calendar are projections of the same authoritative schedule.
- Mobile: date strip + agenda; filters for provider/resource/status; visible 'ثبت نوبت'; non-drag reschedule button; full-screen form reuses same domain command & preserves draft on validation error.
- Booking invariants: versioned appointment command/RPC (`create`/`reschedule`/`cancel`/`transition`) with server authorization, idempotency key, optimistic version, immutable history, audit event. Store canonical UTC instants + timezone alongside legacy date/time compatibility. Enforce `start < end`, integer duration bounds, non-overlap `[start, end)` + sterilization buffer, and branch-scoped resources.
- Status model: `scheduled` → `confirmed` → `arrived` → `waiting` → `in_progress` → `completed` (+ `cancelled` / `no_show` via permitted transitions with actor/timestamp/reason). Keep reschedule history and separate payment state.
- Intelligence: deterministic slot ranking (skills, resource availability, duration, continuity, emergency reserve); AI cannot override schedule constraints; idempotent reminders without PHI leakage.

## 6. Full product information architecture and module contracts
Covers Patient registry, Clinical workspace, Odontogram/perio (ISO 3950/FDI + Palmer mapping, never mirrored under RTL), Treatment plan, Imaging/files (private signed access), Implant traceability, Lab chain-of-custody, Finance (integer currency, append-only ledger/reversals), Inventory (atomic ledger, lots/expiry), Staff (membership-first auth), Reminders/communications, Reports, and Settings.

## 7. AI system boundary
Separate assistive contracts (operational, scheduling ranking, documentation drafts, financial explanation, inventory forecast). Ground in authorized source IDs/timestamps, abstain on missing data, no arbitrary SQL/tool execution, server-side calls with PHI redaction/prompt-injection guards, mandatory clinician/human confirmation for writes, and no autonomous diagnosis/prescribing.

## 8. Safety, reliability and quality gates
- Treat missing role, membership lookup failure, and unauthorized as **denied** (never fall back to `'secretary'` or lower role). Backend RLS and command authorization are mandatory.
- Scope caches/realtime by project, tenant, branch, user, role; purge on logout/revocation; zero PHI in public SW cache.
- Maintain clinical hazard register (wrong patient, wrong tooth/side, double booking, hidden allergy, false completion, lost note, unauthorized disclosure, incorrect payment, wrong branch, stale metrics, reminder leak, update failure).
- Per-PR required gates: typecheck, deterministic build, unit/contract tests, schema integration, negative RLS matrix, concurrent booking, Chromium + WebKit E2E, axe + keyboard/screen-reader checks, RTL/dark/mobile/zoom, offline/reconnect, role switching.

## 9. Implementation order and acceptance report
- **Phase A (Current Incremental Scope)**: capture baseline state/contracts across dashboard, quick booking, appointment list, and calendar; resolve **P0 authorization** (no `'secretary'`/`'unauthorized'` fallback) and **shared appointment domain command** (`appointmentCommandService`) across all booking entry points with real unit + E2E tests while preserving QBank, Aurora, and existing workflows.
- **Phase B**: role-specific dashboard and operational board.
- **Phase C**: clinical patient workspace and plan.
- **Phase D**: finance/inventory/lab/staff.
- **Phase E**: intelligence and interoperability, after deterministic workflows and privacy validation.
