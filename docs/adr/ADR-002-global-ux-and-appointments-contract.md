# ADR-002: Global UX Specification Phase A — Fail-Closed RBAC Denial & Unified Appointment Domain Command

- **Date**: 2026-11-26
- **Status**: Accepted & Active (Phase A)
- **Reference Specification**: `docs/architecture/MINADENTAL-GLOBAL-UX-ARCHITECTURE-AUDIT-V1.md` (Design audit 1.0)
- **Scope**: Dashboard + Appointments security and domain command contracts

## Context
The MinaDental Global UX & Architecture Master Specification (`Design audit 1.0`) identified two P0 integrity gaps at commit `7925767ce462b2d61cf983e5bd4b80e1bf5ddf99`:
1. **`src/services/permissions/accessControl.ts`**: `canAccessRoute` and `canPerformAction` defaulted invalid/missing roles (`undefined`, `''`, `'unauthorized'`) to `'secretary'`, unintentionally exposing financial/patient/appointment routes or actions when authorization state was invalid.
2. **Fragmented Appointment Write Paths**: `OperationalFormRoutes.tsx` (`AppointmentFormPage`), `Appointments.tsx`, `CalendarSection.tsx` (`handleSaveQuickAppt`), and `OverlayManager.tsx` (Caller-ID quick book) executed independent `supabase.from('appointments').insert/update` calls, bypassed unified conflict/duration validation (`Math.max(10, Number(duration) || 30)` silent coercion), and exposed unrestricted status shortcuts (`confirm_apt`, `complete_apt`) in the context menu.

## Decisions
1. **Strict Fail-Closed RBAC Denial (`accessControl.ts`)**:
   - `canAccessRoute(role, route)` and `canPerformAction(role, action)` reject missing, empty, `'unauthorized'`, or unrecognized roles immediately with `false` (no `'secretary'` fallback).
   - Introduce `EffectiveClinicRole = ClinicUserRole | 'unauthorized'` and `resolveStrictMembershipRole(...)` while keeping `resolveEffectiveRole` compatible with existing V4/V12 session contracts (`authenticated` -> verified membership role; `unauthorized` -> never inherits local `'manager'`).
2. **Single Authoritative Appointment Domain Command (`src/features/appointments/appointmentCommandService.ts`)**:
   - All appointment entry points (`AppointmentFormPage`, `Appointments`, `CalendarSection`, `OverlayManager` Caller-ID quick book) delegate validation, conflict detection, status transitions, and writes to `appointmentCommandService`.
   - Reject invalid/fractional/out-of-range durations (`5 <= duration <= 480` integers only; zero silent coercion), require valid patient/date/time, check `findSmartConflicts` + short-window idempotency (`clientRequestId`), stamp explicit `tenant_id` / `branch_id`, and compute canonical timezone-aware timestamps without breaking backward-compatible PostgreSQL columns.
   - Enforce centralized `APPOINTMENT_LEGAL_TRANSITIONS` (`scheduled`, `confirmed`, `arrived`, `waiting`, `in_progress`, `completed`, `cancelled`, `no_show`) across both action buttons and context menus.
3. **Preservation & Non-Destructive Rollout**:
   - Keep QBank tile geometry, 4-tab FloatingDock + detached Services circle, 3-column Services launcher, Gemini Aurora backdrop, and all V10–V12 safeguards intact.
   - Do NOT replay applied V12 SQL migrations (`v12_empty_clinic_foundation`, `v12_advisor_hardening`, `v12_rpc_grants`).

## Rollback Plan
- Additive service extraction in `src/features/appointments/appointmentCommandService.ts` and focused call-site wiring; reverting `appointmentCommandService` consumers or `accessControl.ts` preserves database schema, IndexedDB vault, and offline queue intact.
