# MinaDental — protected engineering baseline

## Mandatory owner gate — Architecture First (2026-11-27)
- Before any new module feature or detail work, complete and obtain explicit owner approval of the shared UI/UX architecture: coherent design tokens, reusable primitives, adaptive phone/tablet/desktop shell, RTL navigation, layout, typography, spacing, color/contrast, accessibility, interactions, motion and living-tooth states.
- Preserve existing clinical and financial improvements. Until this gate is signed off, only architecture foundation work and necessary safety/security/regression repairs are permitted. Do not resume module-by-module feature expansion merely because CI is green.
- Acceptance requires documented visual and functional evidence across the target viewport/device matrix, light/dark, RTL, keyboard, reduced motion, safe areas, text scaling and error/loading/empty/offline states, plus passing relevant CI. Clearly separate real device evidence from browser simulation; no unsupported native-platform claims.
- Record the owner-approved acceptance in Issue #4 and the roadmap before lifting this gate. This instruction applies across sessions and to every engineering agent. It is a documented engineering rule, not an automatically enforced branch protection.


Canonical repository: galaxy1364/Dendalcare. Coordination: https://github.com/galaxy1364/Dendalcare/issues/4.

## Non-negotiable rules
- Before any write, read AGENTS.md, GEMINI.md, this protocol, current main and the latest coordination record. Verify actual SHA, PR state, CI and release evidence; do not treat an AI Studio preview as canonical.
- One writer at a time. Current owner-authorized assignment: Gemini is the sole implementation writer for the Architecture First scope on `feat/ge0019-adaptive-shell` (PR #17), after verifying branch/local sync and the latest Issue #4 handoff. ChatGPT is research/architecture and independent reviewer, not concurrent code writer. Follow [GE-0024 execution handoff](GE-0024-architecture-first-execution-handoff.md). At each phase boundary release writer role for review; no main, merge, deploy, DB or signing changes. Latest Issue #4 governs writer ownership. Preserve/export unsynced AI Studio work before switching. Never push main, force-push or merge stale branches blindly.
- Changes use isolated branches, reviewed PRs and passing required CI. Never remove or weaken tests/security to obtain a green check. Record exact head/base and live evidence. Repository rulesets/branch protection must be configured and independently verified by an administrator; these documents do not enforce a lock.
- Preserve release fixes GE-0010 through GE-0014 (PRs #6–#9): monotonic sequence, version parity, pinned Gradle 9.3.1 compatible with AGP, real APK assembly, fail-closed apksigner verification, SHA-256 and version-specific release archives. Never replace the existing Android upload key or expose secrets. Stable APKs must not use debug signing. Never overwrite historical archives.
- Shared source identity for Web/PWA, APK/AAB, future iOS/iPadOS and Windows. Apple signing/provisioning and AAB/IPA/MSIX are not yet verified production capabilities. Do not label web launchers or profiles as native binaries. Web update ECDSA signing is still pending independent verification; HTTPS/SHA-256 alone is not a signed manifest.
- Clinical UI: preserve Persian RTL, Aurora/QBank identity, native adaptive shell and responsive design. Use meaningful whitespace, semantic statuses, accessible names, keyboard support, touch targets and WCAG 2.2 AA as a verification target, not an unproven certification. Validate small/mobile, tablet and desktop layouts. Prefer shared components over duplicate UI.
- Clinical stage review/confirmation must not mutate or falsely complete a record. Genuine completion needs authorized server-confirmed operations and audit evidence scoped to the active encounter. Never imply a local click is server confirmation or independent second-person authorization.
- Protect clinical/financial data. No uninstall, clear-storage, offline queue deletion or destructive migrations before verified recovery. Reconcile actual Supabase ledger and authorization, no unverified schema replay. No patient data or signing keys in public repository or logs.

## Verified baseline (2026-11-27)
- main: a4643e24495f841b709b211714166e579a327a99 (GE-0014).
- Unified deployment 45985649628 and main CI 45985649672 succeeded. Live web v4.18.0-5b59380970 (#307), 63 SHA-256 verified assets. APK signed with production key, apksigner v2 verified. Versioned public archives android-v4.18.0-306 and android-v4.18.0-307, latest alias #307.
- APK #307 SHA-256 f7d07c88db10e04b3e716a006615c184b80eefcde8abd91905faac9b3ae1072f.
- Physical installation, actual authenticated clinical/financial workflows, migration ledger reconciliation, old debug-to-production recovery and web manifest signing remain unverified. Do not delete existing installations.
- GE-0015 PR #10 is pending review/CI; shared RTL clinical stepper uses two-step review before navigation only. CI run 45986925928 failed due to ambiguous chart button selector on both browsers and a separate WebKit cold/warm release-pointer transient failure. Preserve strict cold/warm test. Verify fresh CI before merge.

Update this baseline or append a dated evidence record after each accepted release. The latest verified main/CI and Issue #4 supersede historical snapshot claims.
