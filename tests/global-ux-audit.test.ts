import fs from 'node:fs';
import path from 'node:path';
import { PERMANENT_PROJECT_ROADMAP } from '../src/lib/memPalace';
import {
  canAccessRoute,
  canPerformAction,
  getAuthorizedRoutesForRole,
  resolveStrictMembershipRole,
} from '../src/services/permissions/accessControl';
import {
  canTransitionAppointmentStatus,
  deleteAppointmentCommand,
  saveAppointmentCommand,
  transitionAppointmentStatusCommand,
  validateAppointmentDraft,
} from '../src/features/appointments/appointmentCommandService';
import type { Appointment } from '../src/lib/supabase';

export interface GlobalUxAuditTestResult {
  name: string;
  passed: boolean;
  error?: string;
}

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

const ROOT = process.cwd();

export async function runAllGlobalUxAuditTests(): Promise<GlobalUxAuditTestResult[]> {
  const results: GlobalUxAuditTestResult[] = [];
  const run = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      results.push({ name, passed: true });
    } catch (err) {
      results.push({
        name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  await run(
    'UX-V1-01: Permanent Global UX Master Specification, ADR-002, and MemPalace milestone-14 are stored & locked',
    () => {
      const specPath = path.join(ROOT, 'docs', 'architecture', 'MINADENTAL-GLOBAL-UX-ARCHITECTURE-AUDIT-V1.md');
      const adrPath = path.join(ROOT, 'docs', 'adr', 'ADR-002-global-ux-and-appointments-contract.md');
      assert(fs.existsSync(specPath), 'docs/architecture/MINADENTAL-GLOBAL-UX-ARCHITECTURE-AUDIT-V1.md must exist');
      assert(fs.existsSync(adrPath), 'docs/adr/ADR-002-global-ux-and-appointments-contract.md must exist');

      const specText = fs.readFileSync(specPath, 'utf8');
      const adrText = fs.readFileSync(adrPath, 'utf8');
      assert(specText.includes('Design audit 1.0') && specText.includes('Phase A'), 'Master spec missing audit version or Phase A');
      assert(adrText.includes('ADR-002') && adrText.includes('appointmentCommandService'), 'ADR-002 must document shared appointment command contract');

      const m14 = PERMANENT_PROJECT_ROADMAP.find((m) => m.id === 'milestone-14');
      assert(Boolean(m14), 'MemPalace PERMANENT_PROJECT_ROADMAP must contain milestone-14');
      assert(m14?.traceId === 'TRC-MINA-UX-AUDIT-V1-9014-N', 'milestone-14 traceId mismatch');
      assert(m14?.locked === true, 'milestone-14 must be locked');
    }
  );

  await run(
    'UX-V1-02: accessControl fails closed on missing, empty, or unauthorized roles with zero secretary fallback',
    () => {
      assert(canAccessRoute(undefined, 'dashboard') === false, 'undefined role must be denied');
      assert(canAccessRoute('', 'appointments') === false, 'empty role must be denied');
      assert(canAccessRoute('unauthorized', 'finance') === false, 'unauthorized role must be denied finance');
      assert(canAccessRoute('unauthorized', 'patients') === false, 'unauthorized role must be denied patients');
      assert(canAccessRoute('revoked_role', 'settings') === false, 'unknown role must be denied');
      assert(canPerformAction(undefined, 'book_appointment') === false, 'undefined role cannot book appointments');
      assert(canPerformAction('unauthorized', 'create_patient') === false, 'unauthorized role cannot create patients');
      assert(getAuthorizedRoutesForRole('unauthorized').length === 0, 'unauthorized role must receive 0 authorized routes');

      assert(
        resolveStrictMembershipRole({
          serverVerifiedRole: null,
          localRole: 'manager',
          sessionStatus: 'unauthorized',
        }) === 'unauthorized',
        'unauthorized session must resolve strictly to unauthorized'
      );
      assert(
        resolveStrictMembershipRole({
          serverVerifiedRole: null,
          localRole: 'manager',
          sessionStatus: 'authenticated',
        }) === 'unauthorized',
        'authenticated session lacking server role must resolve strictly to unauthorized'
      );
    }
  );

  await run(
    'UX-V1-03: Shared appointmentCommandService rejects invalid duration, conflicts, illegal transitions, and bypasses across write entry points',
    async () => {
      const existing: Appointment[] = [
        {
          id: 'apt-existing-1',
          patient_id: 'pat-1',
          staff_id: null,
          title: 'نوبت موجود',
          appointment_date: '2026-11-26',
          appointment_time: '10:00',
          duration_min: 30,
          type: 'checkup',
          status: 'confirmed',
          room: 'یونیت ۱ (عمومی)',
          notes: null,
          created_at: '2026-11-25T10:00:00Z',
        },
      ];

      // Invalid / fractional / out-of-range durations must fail without silent 30m coercion
      const nanDur = validateAppointmentDraft(
        {
          patient_id: 'pat-2',
          appointment_date: '2026-11-26',
          appointment_time: '11:00',
          duration_min: 'abc',
          type: 'checkup',
          room: 'یونیت ۱ (عمومی)',
        },
        existing
      );
      assert(!nanDur.valid, 'Non-numeric duration must be rejected');

      const fracDur = validateAppointmentDraft(
        {
          patient_id: 'pat-2',
          appointment_date: '2026-11-26',
          appointment_time: '11:00',
          duration_min: 22.5,
          type: 'checkup',
          room: 'یونیت ۱ (عمومی)',
        },
        existing
      );
      assert(!fracDur.valid, 'Fractional duration must be rejected');

      const tooShortDur = validateAppointmentDraft(
        {
          patient_id: 'pat-2',
          appointment_date: '2026-11-26',
          appointment_time: '11:00',
          duration_min: 3,
          type: 'checkup',
          room: 'یونیت ۱ (عمومی)',
        },
        existing
      );
      assert(!tooShortDur.valid, 'Sub-5m duration must be rejected');

      // Missing patient fails when allowMissingPatient is not explicitly set
      const missingPat = validateAppointmentDraft(
        {
          patient_id: '',
          appointment_date: '2026-11-26',
          appointment_time: '11:00',
          duration_min: 30,
          type: 'checkup',
          room: 'یونیت ۱ (عمومی)',
        },
        existing
      );
      assert(!missingPat.valid, 'Missing patient must fail validation');

      // Conflict detection rejects double booking in same room & interval
      const conflicting = validateAppointmentDraft(
        {
          patient_id: 'pat-2',
          appointment_date: '2026-11-26',
          appointment_time: '10:15',
          duration_min: 30,
          type: 'checkup',
          room: 'یونیت ۱ (عمومی)',
        },
        existing
      );
      assert(!conflicting.valid, 'Overlapping appointment on same unit must be rejected');

      // Valid non-conflicting draft passes with explicit tenant/branch & Tehran window
      const valid = validateAppointmentDraft(
        {
          patient_id: 'pat-2',
          appointment_date: '2026-11-26',
          appointment_time: '10:30',
          duration_min: 30,
          type: 'checkup',
          status: 'confirmed',
          room: 'یونیت ۱ (عمومی)',
        },
        existing
      );
      assert(valid.valid && valid.computedWindow?.endTime === '11:00', 'Back-to-back clean slot [10:30, 11:00) must succeed');

      // Role enforcement on command layer
      const assistantBook = await saveAppointmentCommand({
        actorRole: 'assistant',
        draft: {
          patient_id: 'pat-2',
          appointment_date: '2026-11-26',
          appointment_time: '12:00',
          duration_min: 30,
          type: 'checkup',
          room: 'یونیت ۱ (عمومی)',
        },
      });
      assert(!assistantBook.ok, 'assistant role must be denied booking appointments');

      const secretaryDelete = await deleteAppointmentCommand({
        actorRole: 'secretary',
        appointmentId: 'apt-existing-1',
      });
      assert(!secretaryDelete.ok, 'secretary role must be denied deleting appointments');

      // Legal status transitions
      assert(canTransitionAppointmentStatus('scheduled', 'confirmed') === true);
      assert(canTransitionAppointmentStatus('confirmed', 'arrived') === true);
      assert(canTransitionAppointmentStatus('arrived', 'waiting') === true);
      assert(canTransitionAppointmentStatus('waiting', 'in_progress') === true);
      assert(canTransitionAppointmentStatus('in_progress', 'completed') === true);
      assert(canTransitionAppointmentStatus('scheduled', 'completed') === false, 'scheduled -> completed shortcut must be rejected');
      assert(canTransitionAppointmentStatus('cancelled', 'completed') === false, 'cancelled -> completed shortcut must be rejected');

      const illegalTransition = await transitionAppointmentStatusCommand({
        actorRole: 'manager',
        appointmentId: 'apt-existing-1',
        currentStatus: 'cancelled',
        nextStatus: 'completed',
      });
      assert(!illegalTransition.ok, 'Illegal status transition must be rejected cleanly before DB call');

      // Source audit: all 4 entry points route writes via saveAppointmentCommand (zero raw direct appointments inserts)
      for (const relPath of [
        'src/features/forms/OperationalFormRoutes.tsx',
        'src/components/sections/Appointments.tsx',
        'src/components/sections/CalendarSection.tsx',
        'src/app/OverlayManager.tsx',
      ]) {
        const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
        assert(src.includes('saveAppointmentCommand'), `${relPath} must use saveAppointmentCommand`);
        assert(!src.includes("supabase.from('appointments').insert"), `${relPath} must not bypass shared command with raw appointments.insert`);
      }
    }
  );

  return results;
}
