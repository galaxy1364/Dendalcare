import fs from 'node:fs';
import path from 'node:path';
import { PERMANENT_PROJECT_ROADMAP } from '../src/lib/memPalace';
import {
  FORBIDDEN_SHELL_PHI_COLUMNS,
  NOTIFICATION_READ_MODEL_PROJECTIONS,
  buildUnifiedNotificationAlerts,
  computeMascotMood,
  computeNotificationCount,
} from '../src/app/providers/NotificationReadModel';
import type { LiveSmartAlert } from '../src/lib/smartReminderEngine';
import type { Reminder } from '../src/lib/supabase';

export interface V10ArchitectureTestResult {
  name: string;
  passed: boolean;
  error?: string;
}

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

const ROOT = process.cwd();

export async function runAllV10ArchitectureTests(): Promise<V10ArchitectureTestResult[]> {
  const results: V10ArchitectureTestResult[] = [];
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

  // V10-ARCH-01: Governance & Architecture Docs + ADR-001 + MemPalace Milestone 12
  await run('V10-ARCH-01: V10 architecture spec, ADR-001, and MemPalace milestone-12 are permanently locked', () => {
    const specPath = path.join(ROOT, 'docs', 'MINADENTAL-V10-ARCHITECTURE.md');
    const adrPath = path.join(ROOT, 'docs', 'adr', 'ADR-001-v10-resilient-foundation.md');
    assert(fs.existsSync(specPath), 'docs/MINADENTAL-V10-ARCHITECTURE.md must exist');
    assert(fs.existsSync(adrPath), 'docs/adr/ADR-001-v10-resilient-foundation.md must exist');

    const specText = fs.readFileSync(specPath, 'utf8');
    const adrText = fs.readFileSync(adrPath, 'utf8');
    assert(specText.includes('V10') && specText.includes('P0') && specText.includes('P5'), 'V10 spec must record P0-P5');
    assert(adrText.includes('ADR-001') && adrText.includes('validateNavigationHtml'), 'ADR-001 must document SW structural validation');

    const m12 = PERMANENT_PROJECT_ROADMAP.find((m) => m.id === 'milestone-12');
    assert(Boolean(m12), 'MemPalace PERMANENT_PROJECT_ROADMAP must contain milestone-12');
    assert(m12?.traceId === 'TRC-MINA-V10-ARCH-9012-L', 'milestone-12 traceId mismatch');
    assert(m12?.locked === true, 'milestone-12 must be locked');
  });

  // V10-ARCH-02: Shell PHI/PII Data Minimization
  await run('V10-ARCH-02: Global shell realtime projections exclude sensitive PHI/PII columns', () => {
    const entries = Object.entries(NOTIFICATION_READ_MODEL_PROJECTIONS);
    assert(entries.length === 11, `Expected 11 shell projections, got ${entries.length}`);

    for (const [table, projection] of entries) {
      const cols = projection.split(',').map((c) => c.trim());
      assert(!cols.includes('*'), `Shell projection for ${table} must not use select('*')`);
      for (const forbidden of FORBIDDEN_SHELL_PHI_COLUMNS) {
        assert(
          !cols.includes(forbidden),
          `Shell projection for ${table} must NOT include sensitive PHI/PII column "${forbidden}"`
        );
      }
    }

    // Verify AppProviders.tsx itself consumes NOTIFICATION_READ_MODEL_PROJECTIONS and does not inline forbidden PHI columns
    const providersSrc = fs.readFileSync(path.join(ROOT, 'src', 'app', 'AppProviders.tsx'), 'utf8');
    assert(
      providersSrc.includes('NOTIFICATION_READ_MODEL_PROJECTIONS'),
      'AppProviders.tsx must use NOTIFICATION_READ_MODEL_PROJECTIONS'
    );
    assert(
      !providersSrc.includes('national_id') && !providersSrc.includes('treatment_plan'),
      'AppProviders.tsx must not fetch national_id or treatment_plan in global shell queries'
    );
  });

  // V10-ARCH-03: Pure NotificationReadModel selector parity
  await run('V10-ARCH-03: buildUnifiedNotificationAlerts preserves exact deduplication and mapping parity', () => {
    const liveAlerts: LiveSmartAlert[] = [
      {
        id: 'live-1',
        domain: 'check',
        targetSection: 'finance',
        patientId: 'p1',
        patientName: 'سارا محمدی',
        patientPhone: '09121112233',
        title: 'سررسید چک صیادی',
        subtitle: 'چک بانک ملت',
        dueDate: '2026-11-26',
        daysRemaining: 1,
        urgency: 'today',
        amount: 5000000,
      },
    ];

    const pendingReminders: Reminder[] = [
      {
        id: 'r-dup',
        patient_id: 'p1',
        title: 'سررسید چک صیادی', // duplicate title — must be deduplicated
        description: 'تکراری',
        reminder_date: '2026-11-26',
        reminder_time: '10:00',
        category: 'payment',
        priority: 'high',
        status: 'pending',
        created_at: '2026-11-25T08:00:00Z',
      },
      {
        id: 'r-unique',
        patient_id: 'p2',
        title: 'پیگیری قالب‌گیری لابراتوار',
        description: '',
        reminder_date: '2026-11-27',
        reminder_time: '11:30',
        category: 'lab',
        priority: 'urgent',
        status: 'pending',
        created_at: '2026-11-25T08:00:00Z',
      },
    ];

    const unified = buildUnifiedNotificationAlerts({
      liveSmartAlerts: liveAlerts,
      pendingReminders,
      patients: [
        { id: 'p1', first_name: 'سارا', last_name: 'محمدی', phone: '09121112233' },
        { id: 'p2', first_name: 'علی', last_name: 'کریمی', phone: '09129998877' },
      ],
    });

    assert(unified.length === 2, `Expected 2 unified alerts after deduplication, got ${unified.length}`);
    assert(unified[0].id === 'live-1', 'Live alert must remain first');
    assert(unified[1].id === 'rem_r-unique', 'Stored unique reminder id mismatch');
    assert(unified[1].targetSection === 'lab', 'Lab reminder must route to lab section');
    assert(unified[1].patientName === 'علی کریمی', 'Patient name resolution mismatch');
    assert(unified[1].urgency === 'critical', 'Urgent priority must map to critical urgency');
    assert(computeNotificationCount(1, 2, 3) === 5, 'computeNotificationCount parity mismatch');
    assert(computeMascotMood(liveAlerts, 1) === 'neutral', 'Unknown authorization must not imply a verified task state');
    assert(computeMascotMood(liveAlerts, 1, { isAuthorized: true, isDataReady: true }) === (liveAlerts.some(a => a.urgency === 'critical') ? 'sad' : 'concerned'), 'Verified critical and pending signals must remain distinct');
    assert(computeMascotMood([], 0, { isAuthorized: true, isDataReady: true }) === 'happy', 'Mascot mood must be happy only when verified clear');
  });

  // V10-ARCH-04: Modular Provider Composition in AppProviders Facade
  await run('V10-ARCH-04: AppProviders composes independent AppearanceProvider and UpdateProvider while preserving facade', () => {
    const appearancePath = path.join(ROOT, 'src', 'app', 'providers', 'AppearanceProvider.tsx');
    const updatePath = path.join(ROOT, 'src', 'app', 'providers', 'UpdateProvider.tsx');
    assert(fs.existsSync(appearancePath), 'AppearanceProvider.tsx must exist');
    assert(fs.existsSync(updatePath), 'UpdateProvider.tsx must exist');

    const providersSrc = fs.readFileSync(path.join(ROOT, 'src', 'app', 'AppProviders.tsx'), 'utf8');
    assert(
      providersSrc.includes('AppearanceProvider') && providersSrc.includes('useAppearanceProvider'),
      'AppProviders.tsx must compose AppearanceProvider'
    );
    assert(
      providersSrc.includes('UpdateProvider') && providersSrc.includes('useUpdateProvider'),
      'AppProviders.tsx must compose UpdateProvider'
    );
    assert(
      providersSrc.includes('export function useClinicShell('),
      'AppProviders.tsx must preserve useClinicShell facade'
    );
  });

  return results;
}
