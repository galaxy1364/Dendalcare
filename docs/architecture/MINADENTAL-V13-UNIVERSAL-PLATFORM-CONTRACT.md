# MinaDental V13 — Universal Platform Design & Engineering Contract
Date: 2026-11-26 | Preserved in Permanent Architecture Memory
Reviewed GitHub HEAD: `7925767ce462b2d61cf983e5bd4b80e1bf5ddf99`
Authoritative Coordination Reference: https://github.com/galaxy1364/Dendalcare/issues/4#issuecomment-7175753238

## 0. Authority, Scope & Safety
- Gemini is sole implementation writer; ChatGPT is chief architecture engineer and independent auditor.
- Follow `AGENTS.md`, `GEMINI.md`, `docs/architecture/V12-development-coordination.md`, and `docs/architecture/MINADENTAL-GLOBAL-UX-ARCHITECTURE-AUDIT-V1.md`.
- Keep current Supabase project `npzcweiphmyhtzxxnlov` exclusively. Never replay the three already-applied V12 migrations or expose service-role keys in clients.
- No real patient data in development. Zero fabricated KPIs or synthetic compliance claims.
- Advance Android APK/AAB, iOS/iPadOS, browser/installable PWA, and Windows together through shared core logic and adaptive clients; report unsupported or blocked native targets honestly.
- Build and verify in increments; no big-bang rewrite and never skip failed checks.

## 1. Modular Monolith & Platform Boundary
- `domain` / `features`: pure types, rules, state machines, command validation, money/time/unit policies. No direct OS calls in feature components.
- `application` / command services: validated DTOs, authorization context, idempotency, conflict checks, audit events.
- `infrastructure` / `services`: Supabase repositories, RPCs, project-namespaced offline outbox (`npzcweiphmyhtzxxnlov`), encrypted IndexedDB mirrors.
- `design-system`: semantic tokens, typography (`Vazirmatn` self-hosted), duotone dental SVGs, `AuroraBackground` (`live` / `low_power` / `static` + reduce motion + visibility pause).
- `platform`: capability registry (`capabilities.ts`), web/native haptic adapters (`haptics.ts`), RTL gesture tracker (`gestures.ts`), safe-area/window-size hooks (`safeArea.ts`).
- `app`: route stack, role-aware adaptive shell (`FloatingDock`, `NavigationRail`, `AppShell`), overlay manager, boot/recovery boundaries.

## 2. Typed Platform Capability & Bridge Contract
- Every feature check returns `{ availability: 'supported' | 'permission_required' | 'unavailable' | 'disabled' | 'restricted', reason, source }`.
- Runtime bridge handshake negotiates `{ protocolVersion, platform, runtimeKind, hostVersion, verifiedOrigin, capabilities }` with strict origin allowlist, payload schema validation, timeouts, and safe fallback.
- Never let web scripts execute arbitrary native code, open arbitrary filesystem paths, or access raw credentials.
- Never spoof native Taptic Engine / CoreHaptics or native SwiftUI Liquid Glass when running in Web, PWA, or Android WebView.
- Never export PHI to OS widgets, Live Activities, Siri/App Intents, lockscreen notifications, or crash logs by default.

## 3. Adaptive Navigation & Visual System
- Adaptive web breakpoints based on actual window dimensions:
  - `compact`: `< 600 CSS px` (QBank 4-destination capsule + detached All Services button; role-safe replacement/hiding so unauthorized roles never see forbidden tabs such as `'finance'`).
  - `medium`: `600–1023 CSS px` (Navigation Rail + adaptive workspace, zero forced orientation).
  - `expanded`: `1024–1439 CSS px` (Sidebar + list/detail workspace, keyboard shortcuts, command palette).
  - `wide`: `>= 1440 CSS px` (Multi-pane desktop workspace bounded cleanly against stretch).
- CSS `backdrop-filter` is strictly a calibrated approximation with solid opaque surface fallback; clinical forms, odontogram, charts, and ledgers render on opaque high-contrast surfaces.
- Preserve focus visibility, RTL isolation (`tabular-nums`, LTR isolation for phone/code/time), `env(safe-area-inset-*)`, virtual keyboard adaptation, unsaved-draft edge-swipe protection, and reduce-motion/transparency overrides.

## 4. Phased Verification & Honest Evidence
- **Phase A/B**: Role-aware `FloatingDock` & `NavigationRail`, typed platform capability matrix + bridge handshake, adaptive 4-band breakpoints, RTL edge-back draft/modal/cancel guard, `ADR-003` honest wrapper inventory, multi-viewport + light/dark E2E & unit checks.
- **Phase C**: Dashboard + appointment command path, authenticated CRUD/RLS matrix (with isolated CI/owner test fixtures), concurrency/idempotency/timezone verification.
- **Phase D**: Remaining clinical/financial modules harmonized onto shared design system & domain commands.
- **Phase E**: Synchronized release manifest and signed platform artifacts where host toolchains and credentials exist; explicit `blocked` / `unavailable` status for absent hosts (such as macOS/Xcode IPA).
