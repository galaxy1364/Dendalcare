import fs from 'node:fs';
import path from 'node:path';
import {
  resolvePlatformDesign,
  type DensityMode,
  type PlatformDesignLanguage,
} from '@/design-system/themes/appearance';
import { normalizePersianDigits } from '@/design-system/primitives/FormEngine';
import { readViewportMetrics } from '@/platform/safeArea';
import { HOME_SERVICES_LIMIT, HOME_SERVICES_PAGE_SIZE, normalizeSelectedHomeServices, reorderSelectedHomeServices, loadSelectedHomeServices, saveSelectedHomeServices } from '@/lib/navigationStack';
import { canAccessRoute } from '@/services/permissions/accessControl';
import { getRecordedPatientFileNo, matchesPatientDirectoryQuery, preparePatientFileNotes, findVisiblePatientIdentityConflict } from '@/features/patients/patientDirectorySearch';

export interface Ge0003TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

async function runCase(name: string, fn: () => Promise<void> | void): Promise<Ge0003TestResult> {
  try {
    await fn();
    return { name, passed: true };
  } catch (err) {
    return {
      name,
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const ROOT = process.cwd();

export async function runAllGe0003IntelligentShellTests(): Promise<Ge0003TestResult[]> {
  return [
    await runCase('GE-0022A: reminder financial shortcuts never bypass ledger and sync requires server confirmation', () => {
      const page = fs.readFileSync(path.join(ROOT, 'src/components/sections/Reminders.tsx'), 'utf8');
      const engine = fs.readFileSync(path.join(ROOT, 'src/lib/smartReminderEngine.ts'), 'utf8');
      assert(!page.includes("supabase.from('checks').update") && !page.includes("supabase.from('installments').update"), 'Reminder cards must not modify financial state directly');
      assert(page.includes("canAccessRoute(effectiveRole, 'finance')") && page.includes("emitGlobalFocus({ section: 'finance', subTab })"), 'Financial shortcuts navigate only with permission');
      assert(page.includes('if (scanLock.current) return;') && page.includes('scanLock.current = false'), 'Prevent simultaneous scans in one view');
      assert(engine.includes('attempted.has(refTag)') && engine.includes('attempted.add(refTag)'), 'Same-run duplicate alerts must be skipped');
      assert(engine.includes("getMutationOutcome(result) === 'confirmed' && 'serverConfirmed' in result && result.serverConfirmed === true") && engine.includes('REMINDER_SYNC_UNCONFIRMED'), 'Queued or failed insert must never count as confirmed');
    }),
    await runCase('GE-0021D: receivables dashboard withholds incomplete totals and prevents new actions', () => {
      const root = fs.readFileSync(path.join(ROOT, 'src/components/sections/Finance.tsx'), 'utf8');
      const tab = fs.readFileSync(path.join(ROOT, 'src/features/finance/FinanceDebtorsTab.tsx'), 'utf8');
      const overview = fs.readFileSync(path.join(ROOT, 'src/features/finance/FinanceDebtorsSummaryCard.tsx'), 'utf8');
      assert(root.includes('!read.isStale && !read.truncated') && root.includes('transactionsRead].every(completeRead)'), 'Fresh complete inputs required');
      assert(tab.includes('{receivablesReady && <>') && tab.includes('finance_incomplete_reads'), 'No provisional zero totals');
      assert(tab.includes('if (!remindersReady || syncingReminders) return;') && tab.includes('if (!receivablesReady) { setQuickPayError'), 'No new financial actions on incomplete inputs');
      assert(tab.includes('saving={savingQuickPay || !receivablesReady}') && tab.includes('finance: transactions'), 'Quick pay disabled without fresh data and anomalies use treasury records');
      assert(overview.includes('summary.aging.unscheduledDueDateAmount') && overview.includes('summary.aging.over_90'), 'Aging must show unscheduled and oldest balances');
      assert(overview.includes('disabled={syncingReminders || !remindersReady}'), 'Reminder action requires ready inputs');
    }),
    await runCase('GE-0021B: both installment collection surfaces require confirmed receipt before advancing schedule', () => {
      for (const [file, action] of [
        ['src/features/finance/FinanceInstallmentsTab.tsx', 'recordPayment'],
        ['src/features/patients/PatientFinanceAndSpecialtyTabs.tsx', 'payInstallment'],
      ]) {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const start = source.indexOf('const ' + action + ' = async');
        const end = source.indexOf('const del =', start);
        assert(start >= 0 && end > start, 'Installment action must exist');
        const body = source.slice(start, end);
        const lock = body.indexOf('collectionLock.current = true');
        const rpc = body.indexOf('await postPatientPaymentCommand');
        const guard = body.indexOf("if (!payRes.ok || payRes.resolution !== 'confirmed')");
        const write = body.indexOf("await supabase.from('installments').update");
        assert(lock >= 0 && lock < rpc && rpc < guard && guard < write, 'Lock and confirmed receipt gate must precede schedule write');
        assert(body.slice(guard, write).includes('return;'), 'Unconfirmed receipt must exit before schedule write');
        assert(body.includes(".eq('paid_months', inst.paid_months)"), 'Follow-up write must compare prior schedule version');
        assert(body.includes("getMutationOutcome(updated) !== 'confirmed'") && body.includes('وجه را دوباره ثبت نکنید'), 'Partial result requires reconciliation rather than success');
        assert(body.includes('finally') && body.includes('collectionLock.current = false'), 'Lock must be released even on failure');
      }
    }),
    await runCase('GE-0021A: financial directory and record summaries use shared ledger and reject incomplete reads', () => {
      const list = fs.readFileSync(path.join(ROOT, 'src/components/sections/Patients.tsx'), 'utf8');
      const detail = fs.readFileSync(path.join(ROOT, 'src/features/patients/PatientDetailHub.tsx'), 'utf8');
      assert(list.includes('computePatientFinancialLedger({ patient, treatments, payments, installments, checks, safteh })'), 'Directory must reuse ledger');
      assert(!list.includes('balance = totalCost - totalPaid'), 'No competing raw balance arithmetic');
      assert(list.includes("canAccessRoute(effectiveRole, 'finance')") && list.includes('!read.isStale && !read.truncated'), 'Role and freshness gates');
      assert(list.includes('if (!financialReady) return;') && list.includes('مانده حساب نامشخص'), 'Partial or unauthorized financial export and false zero must be prevented');
      assert(detail.includes('canViewFinance || !financialTabs.includes(t.id)') && detail.includes('!canViewFinance && financialTabs.includes(requestedTab)'), 'Denied financial tabs must not render, including selected tab after role change');
      assert(detail.includes('canViewFinance && (financialReady ?') && detail.includes('اطلاعات مالی کامل و به‌روز در دسترس نیست.'), 'Unknown financial summary must not render as zero');
    }),
    await runCase('GE-0020C: explicit file references and visible duplicate identity checks', () => {
      const record = { id: 'synthetic-1', first_name: 'آزمایشی', last_name: 'الف', phone: null, national_id: '۰۰۱۲۳۴۵۶۷۸', notes: '[پرونده: ۴۲۱۷]', insurance_number: '999' };
      const prepared = preparePatientFileNotes('4217', 'یادداشت');
      assert(prepared.ok && prepared.notes === '[پرونده: 4217] یادداشت', 'Explicit reference encoded separately');
      const blank = preparePatientFileNotes('', 'یادداشت');
      assert(blank.ok && blank.notes === 'یادداشت', 'Blank reference does not invent identity');
      assert(!preparePatientFileNotes('12]', '').ok && !preparePatientFileNotes('12', '[پرونده: 99]').ok, 'Reject ambiguous tags');
      assert(findVisiblePatientIdentityConflict([record], { fileNo: '4217' }) === 'file', 'Digit-normalized duplicate file reference');
      assert(findVisiblePatientIdentityConflict([record], { nationalId: '0012345678' }) === 'national_id', 'Digit-normalized duplicate national ID');
      assert(findVisiblePatientIdentityConflict([record], { fileNo: '4217' }, record.id) === null, 'Exclude own record during edit');
      assert(findVisiblePatientIdentityConflict([record], { fileNo: '999' }) === null, 'Insurance is not a file reference');
    }),
    await runCase('GE-0020B: patient workspace is adaptive and retains keyboard navigation and identity boundaries', () => {
      const detail = fs.readFileSync(path.join(ROOT, 'src/features/patients/PatientDetailHub.tsx'), 'utf8');
      const list = fs.readFileSync(path.join(ROOT, 'src/components/sections/Patients.tsx'), 'utf8');
      const sheet = fs.readFileSync(path.join(ROOT, 'src/components/ui/Sheet.tsx'), 'utf8');
      assert(sheet.includes("layout = 'form'") && sheet.includes("layout === 'workspace' ? 'max-w-7xl' : 'max-w-2xl'"), 'Wide workspace must be opt-in, ordinary forms unchanged');
      assert(list.includes('<Sheet layout="workspace" open={!!detailPatient}') && list.includes('key={detailPatient.id}'), 'Patient selection must remount workspace for the selected identity');
      assert(detail.includes('patient_record_adaptive_layout') && detail.includes('lg:flex-col') && detail.includes('minmax(0,1fr)'), 'Wide record must have navigation and flexible content panes');
      assert(detail.includes('aria-current={tab === t.id') && detail.includes('min-h-[48px]'), 'Record navigation must expose current section and touch targets');
      assert(list.includes('aria-expanded={isExpanded}') && list.includes("e.key === 'Enter'"), 'Patient cards must support keyboard and expansion semantics');
    }),
    await runCase('GE-0020A: patient search normalizes Persian/Arabic scripts without fabricating file IDs', () => {
      const patient = { first_name: 'علي', last_name: 'كريمي', phone: '۰۹۱۲-۱۲۳۴۵۶۷', national_id: '۰۰۱۲۳۴۵۶۷۸', notes: '[پرونده: ۴۲۱۷] synthetic', insurance_number: '555999' };
      assert(getRecordedPatientFileNo(patient) === '۴۲۱۷', 'Recorded file number remains unchanged');
      for (const query of ['علی کریمی', 'کریمی علی', '09121234567', '٠٩١٢١٢٣٤٥٦٧', '4217', '۰۰۱۲۳۴۵۶۷۸']) {
        assert(matchesPatientDirectoryQuery(patient, query), 'Normalized search must match: ' + query);
      }
      const unnumbered = { ...patient, notes: null };
      assert(getRecordedPatientFileNo(unnumbered) === null, 'Missing reference must remain missing');
      assert(!matchesPatientDirectoryQuery(unnumbered, '1001'), 'Never match fabricated list-position number');
      assert(!matchesPatientDirectoryQuery(unnumbered, '555999'), 'Insurance number is not a file number');
      assert(!matchesPatientDirectoryQuery(patient, 'نام نامرتبط'), 'Unrelated patient must not match');
    }),
    await runCase('GE-0019B: eight favorites preserve legacy order and cap, with role-aware visibility', () => {
      assert(HOME_SERVICES_LIMIT === 8 && HOME_SERVICES_PAGE_SIZE === 4, 'Eight favorites, four per page');
      const ids = normalizeSelectedHomeServices(['patients', 'finance', 'patients', 'invalid', 'appointments', 'lab', 'implants', 'inventory', 'reminders', 'messages', 'staff']);
      assert(ids.length === 8 && ids[0] === 'patients' && ids[1] === 'finance' && !ids.includes('staff'), 'Valid unique cap and order');
      assert(normalizeSelectedHomeServices(['patients']).length === 1, 'Intentional short list persists');
      assert(reorderSelectedHomeServices(ids, 7, 0)[0] === 'messages', 'Reordering must retain all eight positions');
      assert(ids.filter(id => canAccessRoute('assistant', id)).every(id => id !== 'finance'), 'Assistant must not see finance shortcuts');
      assert(ids.filter(id => canAccessRoute('unauthorized', id)).length === 0, 'Unauthorized role has no shortcuts');
      const entries = new Map([['minadental_home_selected_services_v2', JSON.stringify(['finance', 'patients', 'lab', 'appointments'])]]);
      const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
      const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
      try {
        Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: () => true } });
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) } });
        const migrated = loadSelectedHomeServices();
        assert(migrated.length === 8 && migrated.slice(0, 4).join(',') === 'finance,patients,lab,appointments', 'Legacy four selections retained at front');
        saveSelectedHomeServices(['patients']);
        assert(loadSelectedHomeServices().join(',') === 'patients', 'New preferences take precedence');
        assert(entries.get('minadental_home_selected_services_v2') === JSON.stringify(['finance', 'patients', 'lab', 'appointments']), 'Legacy preferences untouched');
      } finally {
        if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
        if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
      }
    }),
    await runCase('GE-0003 #1: Dead duplicate navigation files (BottomDock, DesktopSidebar) are removed', () => {
      assert(!fs.existsSync(path.join(ROOT, 'src/components/BottomDock.tsx')), 'BottomDock.tsx must be deleted');
      assert(!fs.existsSync(path.join(ROOT, 'src/components/DesktopSidebar.tsx')), 'DesktopSidebar.tsx must be deleted');
    }),

    await runCase('GE-0003 #2: Duolingo-style emotional iridescent tooth mascot is unified across app, notifications & launcher icons', () => {
      const mascotSrc = fs.readFileSync(path.join(ROOT, 'src/components/ui/MascotTooth.tsx'), 'utf8');
      assert(mascotSrc.includes('useId()'), 'MascotTooth must use unique SVG gradient IDs via useId()');
      assert(
        mascotSrc.includes("'happy'") &&
          mascotSrc.includes("'concerned'") &&
          mascotSrc.includes("'sad'") &&
          mascotSrc.includes("'celebrating'") &&
          mascotSrc.includes("'thinking'") &&
          mascotSrc.includes("'offline'") &&
          mascotSrc.includes("'neutral'") &&
          mascotSrc.includes("'celebrate'"),
        'MascotTooth must expose all 7 deterministic emotional moods plus legacy aliases'
      );
      assert(mascotSrc.includes('#1B0B47') && mascotSrc.includes('#C084FC') && mascotSrc.includes('#38BDF8'), 'MascotTooth must preserve iridescent crystal aurora palette');

      const consumers = [
        'src/app/shell/AdaptiveTopBar.tsx',
        'src/navigation/NavigationRail.tsx',
        'src/components/ui/IOSReminderPopup.tsx',
        'src/components/ui/NotificationDrawer.tsx',
        'src/app/QBankFoldersOverlay.tsx',
      ];
      for (const rel of consumers) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        assert(src.includes('<MascotTooth'), `${rel} must render emotional <MascotTooth />`);
      }

      const requiredIcons = [
        'public/icon-192.png',
        'public/icon-512.png',
        'public/apple-touch-icon.png',
        'public/favicon.svg',
        'app/src/main/res/drawable/img_minadental_logo.jpg',
        'app/src/main/res/mipmap-mdpi/ic_launcher.png',
        'app/src/main/res/mipmap-hdpi/ic_launcher.png',
        'app/src/main/res/mipmap-xhdpi/ic_launcher.png',
        'app/src/main/res/mipmap-xxhdpi/ic_launcher.png',
        'app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
        'app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png',
      ];
      for (const rel of requiredIcons) {
        const full = path.join(ROOT, rel);
        assert(fs.existsSync(full), `Missing icon asset: ${rel}`);
        assert(fs.statSync(full).size > 500, `Icon asset too small/corrupt: ${rel}`);
      }

      const androidBg = fs.readFileSync(
        path.join(ROOT, 'app/src/main/res/drawable/ic_launcher_background.xml'),
        'utf8'
      );
      assert(androidBg.includes('#1B0B47'), 'Android adaptive background must match #1B0B47 royal indigo');
    }),

    await runCase('GE-0003 #3: Unified Focus Engine & ARIA dialog contracts are wired across all primary overlays', () => {
      const focusSrc = fs.readFileSync(path.join(ROOT, 'src/platform/focusEngine.ts'), 'utf8');
      assert(focusSrc.includes('export function useFocusTrap'), 'focusEngine must export useFocusTrap');
      assert(focusSrc.includes('handleRovingToolbarKeyDown'), 'focusEngine must export RTL roving focus handler');

      const overlayFiles = [
        'src/components/ui/Sheet.tsx',
        'src/components/ui/NotificationDrawer.tsx',
        'src/components/ui/IOSReminderPopup.tsx',
        'src/app/QBankFoldersOverlay.tsx',
      ];
      for (const rel of overlayFiles) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        assert(src.includes('useFocusTrap('), `${rel} must use unified useFocusTrap`);
        assert(src.includes('aria-modal="true"'), `${rel} must declare aria-modal="true"`);
      }
    }),

    await runCase('GE-0003 #4: Platform Design Language resolution (Apple HIG / Material 3 / Fluent) & Intelligent Density tokens', () => {
      assert(
        resolvePlatformDesign('auto', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)') === 'apple',
        'iOS UA must resolve to Apple HIG'
      );
      assert(
        resolvePlatformDesign('auto', 'Mozilla/5.0 (Linux; Android 15; Pixel 9)') === 'material',
        'Android UA must resolve to Material 3'
      );
      assert(
        resolvePlatformDesign('auto', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)') === 'fluent',
        'Windows UA must resolve to Fluent Design'
      );
      const explicitModes: PlatformDesignLanguage[] = ['apple', 'material', 'fluent'];
      for (const m of explicitModes) {
        assert(resolvePlatformDesign(m) === m, `Explicit platform design mode ${m} must be respected`);
      }
      const densityModes: DensityMode[] = ['compact', 'comfortable', 'spacious'];
      assert(densityModes.length === 3, 'Three density modes must be supported');

      const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
      assert(css.includes('data-platform-design="apple"'), 'CSS must style Apple HIG tokens');
      assert(css.includes('data-platform-design="material"'), 'CSS must style Material 3 tokens');
      assert(css.includes('data-platform-design="fluent"'), 'CSS must style Fluent Design tokens');
      assert(css.includes('data-density="compact"') && css.includes('data-density="spacious"'), 'CSS must style density modes');
    }),

    await runCase('GE-0003 #5: Intelligent Form Engine normalizes Persian/Arabic digits and protects unsaved drafts', () => {
      assert(normalizePersianDigits('۰۹۱۲۸۴۴۶۱۵۸') === '09128446158', 'Persian digits must normalize to ASCII');
      assert(normalizePersianDigits('٠٩١٢٣٤٥٦٧٨٩') === '09123456789', 'Arabic-Indic digits must normalize to ASCII');
      assert(normalizePersianDigits('کد ۱۲۳-۴۵') === 'کد 123-45', 'Mixed Persian text + digits must normalize cleanly');

      const formSrc = fs.readFileSync(path.join(ROOT, 'src/design-system/primitives/FormEngine.tsx'), 'utf8');
      assert(formSrc.includes('useUpdateSafePointGuard'), 'FormEngine must register Safe-Point Auto-Update guard');
      assert(formSrc.includes('data-unsaved-draft'), 'FormEngine must mark data-unsaved-draft for gesture protection');

      const metrics = readViewportMetrics();
      assert(metrics.adaptiveClass === 'compact', 'SSR fallback viewport metrics must default cleanly to compact');
      const safeAreaSrc = fs.readFileSync(path.join(ROOT, 'src/platform/safeArea.ts'), 'utf8');
      assert(safeAreaSrc.includes('--keyboard-inset-bottom'), 'safeArea must sync --keyboard-inset-bottom');
      assert(safeAreaSrc.includes('data-keyboard-open'), 'safeArea must sync data-keyboard-open');
    }),

    await runCase('GE-0003 #6: Git tracking excludes Playwright reports/traces & deploy.yml enforces full CI release parity', () => {
      const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
      assert(gitignore.includes('playwright-report/'), '.gitignore must exclude playwright-report/');
      assert(gitignore.includes('test-results/'), '.gitignore must exclude test-results/');
      assert(gitignore.includes('blob-report/'), '.gitignore must exclude blob-report/');

      const deployYml = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
      assert(deployYml.includes('--compare dist-check-a dist'), 'deploy.yml must enforce double-build determinism');
      assert(deployYml.includes('npm audit --omit=dev --audit-level=high'), 'deploy.yml must run production dependency audit');
      assert(deployYml.includes('sbom.cdx.json'), 'deploy.yml must generate CycloneDX SBOM');
      assert(deployYml.includes('npm run test:e2e'), 'deploy.yml must execute real browser E2E tests before deploy');
      assert(deployYml.includes('--require-ci-origin'), 'deploy.yml must require CI release origin');
    }),
  ];
}
