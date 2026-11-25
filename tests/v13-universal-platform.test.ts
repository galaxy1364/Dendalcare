import fs from 'node:fs';
import path from 'node:path';
import { PERMANENT_PROJECT_ROADMAP } from '../src/lib/memPalace';
import {
  buildPlatformCapabilityMatrix,
  detectPlatformCapabilities,
  getAdaptiveBreakpoint,
  isBridgeOriginAllowed,
  negotiatePlatformBridgeHandshake,
} from '../src/platform/capabilities';
import {
  beginRtlEdgeBackSwipe,
  cancelRtlEdgeBackSwipe,
  shouldCompleteRtlEdgeBackSwipe,
} from '../src/platform/gestures';
import {
  QBANK_DOCK_PRIMARY_IDS,
  getRoleAdaptedDockIds,
} from '../src/navigation/FloatingDock';
import { canAccessRoute } from '../src/services/permissions/accessControl';

export interface V13UniversalPlatformTestResult {
  name: string;
  passed: boolean;
  error?: string;
}

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

const ROOT = process.cwd();

export async function runAllV13UniversalPlatformTests(): Promise<V13UniversalPlatformTestResult[]> {
  const results: V13UniversalPlatformTestResult[] = [];
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

  await run('V13-01: V13 contract, ADR-003 wrapper inventory, and MemPalace milestone-15 are persisted and locked', () => {
    const contractPath = path.join(ROOT, 'docs', 'architecture', 'MINADENTAL-V13-UNIVERSAL-PLATFORM-CONTRACT.md');
    const adrPath = path.join(ROOT, 'docs', 'adr', 'ADR-003-universal-platform-capabilities-and-adaptive-shell.md');
    assert(fs.existsSync(contractPath), 'V13 architecture contract doc must exist');
    assert(fs.existsSync(adrPath), 'ADR-003 doc must exist');

    const adrText = fs.readFileSync(adrPath, 'utf8');
    assert(adrText.includes('DentalCareWebView.kt'), 'ADR-003 must inventory maintained Android host');
    assert(adrText.includes('unavailable / blocked'), 'ADR-003 must honestly report missing macOS/Xcode IPA host');

    const m15 = PERMANENT_PROJECT_ROADMAP.find((m) => m.id === 'milestone-15');
    assert(Boolean(m15), 'MemPalace must contain milestone-15');
    assert(m15?.traceId === 'TRC-MINA-V13-UNIV-PLAT-9015-O', 'milestone-15 traceId mismatch');
    assert(m15?.locked === true, 'milestone-15 must be locked');
  });

  await run('V13-02: Platform capability matrix and bridge handshake report honest availability and fail closed on untrusted origins/timeouts', async () => {
    const iosSafariMatrix = buildPlatformCapabilityMatrix({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      viewportWidth: 390,
      hasAndroidBridge: false,
      hasIosBridge: false,
      hasVibrate: false,
      hasNotification: false,
      hasServiceWorker: true,
      isStandalone: true,
    });
    assert(iosSafariMatrix.windowClass === 'compact', '390px must classify as compact');
    assert(iosSafariMatrix.haptics.availability === 'unavailable', 'iOS Safari PWA must NOT spoof Taptic Engine');
    assert(iosSafariMatrix.widgetsLiveActivities.availability === 'unavailable', 'WidgetKit must be reported unavailable in PWA');
    assert(iosSafariMatrix.packagingInstall.availability === 'restricted', 'iOS IPA must be reported restricted without Xcode host');

    const iosCaps = detectPlatformCapabilities({
      userAgent: 'iPhone',
      hasAndroidBridge: false,
      hasIosBridge: false,
    });
    assert(iosCaps.nativeLiquidGlassAvailable === false, 'nativeLiquidGlassAvailable must remain false on Web/PWA');
    assert(iosCaps.nativeCoreHapticsAvailable === false, 'nativeCoreHapticsAvailable must be false without WKWebView bridge');

    const androidMatrix = buildPlatformCapabilityMatrix({
      userAgent: 'Mozilla/5.0 (Linux; Android 15)',
      viewportWidth: 820,
      hasAndroidBridge: true,
      hasIosBridge: false,
      hasServiceWorker: true,
      notificationPermission: 'default',
      hasNotification: true,
    });
    assert(androidMatrix.windowClass === 'medium', '820px must classify as medium');
    assert(androidMatrix.haptics.availability === 'supported' && androidMatrix.haptics.source === 'android_bridge', 'Android bridge haptics must report android_bridge');
    assert(androidMatrix.notifications.availability === 'permission_required', 'Default permission must report permission_required');

    assert(isBridgeOriginAllowed('http://127.0.0.1:8765') === true, 'Local Android asset server origin must be allowed');
    assert(isBridgeOriginAllowed('https://evil.example.com') === false, 'Untrusted origin must be rejected');

    const untrustedHandshake = await negotiatePlatformBridgeHandshake({
      origin: 'https://evil.example.com',
      hasAndroidBridge: true,
      androidNativeAppInfo: () => '{"versionName":"4.9.6","versionCode":65}',
    });
    assert(untrustedHandshake.verifiedOrigin === false, 'Untrusted origin handshake must fail closed');
    assert(untrustedHandshake.hostVersion === 'web', 'Untrusted origin must not receive native hostVersion');

    const androidHandshake = await negotiatePlatformBridgeHandshake({
      origin: 'http://127.0.0.1:8765',
      userAgent: 'Mozilla/5.0 (Linux; Android 15)',
      hasAndroidBridge: true,
      androidNativeAppInfo: () => '{"versionName":"4.9.6","versionCode":65}',
    });
    assert(androidHandshake.verifiedOrigin === true, 'Trusted local bridge origin must pass');
    assert(androidHandshake.hostVersion === '4.9.6+65', `Expected hostVersion 4.9.6+65, got ${androidHandshake.hostVersion}`);
    assert(androidHandshake.capabilities.includes('android_haptics'), 'Android handshake must negotiate android_haptics');

    const timedOutHandshake = await negotiatePlatformBridgeHandshake({
      origin: 'http://127.0.0.1:8765',
      userAgent: 'Mozilla/5.0 (Linux; Android 15)',
      hasAndroidBridge: true,
      timeoutMs: 50,
      androidNativeAppInfo: () => new Promise((resolve) => setTimeout(() => resolve('{"versionName":"late"}'), 200)),
    });
    assert(timedOutHandshake.timedOut === true && timedOutHandshake.hostVersion === 'web', 'Bridge timeout must safely degrade without throwing');
  });

  await run('V13-03: Adaptive 4-band breakpoints, role-aware FloatingDock & NavigationRail, and draft-safe RTL edge swipe', () => {
    assert(getAdaptiveBreakpoint(320) === 'compact', '320px -> compact');
    assert(getAdaptiveBreakpoint(599) === 'compact', '599px -> compact');
    assert(getAdaptiveBreakpoint(600) === 'medium', '600px -> medium');
    assert(getAdaptiveBreakpoint(1023) === 'medium', '1023px -> medium');
    assert(getAdaptiveBreakpoint(1024) === 'expanded', '1024px -> expanded');
    assert(getAdaptiveBreakpoint(1439) === 'expanded', '1439px -> expanded');
    assert(getAdaptiveBreakpoint(1440) === 'wide', '1440px -> wide');

    // Canonical QBank 4-tab geometry preserved for finance-authorized roles
    assert(QBANK_DOCK_PRIMARY_IDS.length === 4, 'QBANK_DOCK_PRIMARY_IDS must remain 4');
    const managerDock = getRoleAdaptedDockIds('manager');
    assert(managerDock.join(',') === 'dashboard,appointments,patients,finance', 'Manager dock must preserve canonical QBank 4 tabs');
    const secretaryDock = getRoleAdaptedDockIds('secretary');
    assert(secretaryDock.includes('finance'), 'Secretary dock includes authorized finance tab');

    // Unauthorized roles must never see 'finance' in FloatingDock
    const dentistDock = getRoleAdaptedDockIds('dentist');
    const assistantDock = getRoleAdaptedDockIds('assistant');
    const unauthorizedDock = getRoleAdaptedDockIds('unauthorized');
    assert(!dentistDock.includes('finance') && dentistDock.length === 4 && dentistDock.includes('calendar'), 'Dentist dock must hide finance and replace safely');
    assert(!assistantDock.includes('finance') && assistantDock.length === 4 && assistantDock.includes('calendar'), 'Assistant dock must hide finance and replace safely');
    assert(unauthorizedDock.length === 0, 'Unauthorized role must receive zero dock routes');
    assert(dentistDock.every((r) => canAccessRoute('dentist', r)), 'Every dentist dock tab must pass RBAC');
    assert(assistantDock.every((r) => canAccessRoute('assistant', r)), 'Every assistant dock tab must pass RBAC');

    // NavigationRail must evaluate effectiveRole rather than raw currentUser.role
    const railSrc = fs.readFileSync(path.join(ROOT, 'src', 'navigation', 'NavigationRail.tsx'), 'utf8');
    const shellSrc = fs.readFileSync(path.join(ROOT, 'src', 'app', 'AppShell.tsx'), 'utf8');
    assert(railSrc.includes('const resolvedRole = effectiveRole ?? currentUser?.role;'), 'NavigationRail must prioritize effectiveRole');
    assert(shellSrc.includes('effectiveRole={effectiveRole}') && shellSrc.includes('userRole={effectiveRole}'), 'AppShell must wire effectiveRole to NavigationRail and FloatingDock');

    // RTL Edge swipe guard: protects unsaved draft, active modal, OS 0..10px edge zone, and cancelled touches
    const osZoneRejected = beginRtlEdgeBackSwipe(
      { touches: [{ clientX: 386, clientY: 200 } as unknown as Touch] as unknown as TouchList, target: null },
      true,
      { viewportWidth: 390 }
    );
    assert(osZoneRejected === null, 'Touch inside 0..10px OS edge strip must not hijack system gesture');

    const draftGuarded = beginRtlEdgeBackSwipe(
      { touches: [{ clientX: 365, clientY: 200 } as unknown as Touch] as unknown as TouchList, target: null },
      true,
      { viewportWidth: 390, hasUnsavedDraft: true }
    );
    assert(draftGuarded === null, 'Unsaved draft must block accidental RTL edge back swipe');

    const modalGuarded = beginRtlEdgeBackSwipe(
      { touches: [{ clientX: 365, clientY: 200 } as unknown as Touch] as unknown as TouchList, target: null },
      true,
      { viewportWidth: 390, isModalOpen: true }
    );
    assert(modalGuarded === null, 'Open modal dialog must block RTL edge back swipe');

    const tracker = beginRtlEdgeBackSwipe(
      { touches: [{ clientX: 365, clientY: 200 } as unknown as Touch] as unknown as TouchList, target: null },
      true,
      { viewportWidth: 390 }
    );
    assert(Boolean(tracker?.active), 'Valid 10..44px RTL edge swipe must initialize tracker');

    assert(
      shouldCompleteRtlEdgeBackSwipe(tracker, {
        changedTouches: [{ clientX: 280, clientY: 205 } as unknown as Touch] as unknown as TouchList,
      }),
      'Completed >64px horizontal RTL swipe must trigger back navigation'
    );

    cancelRtlEdgeBackSwipe(tracker);
    assert(
      !shouldCompleteRtlEdgeBackSwipe(tracker, {
        changedTouches: [{ clientX: 280, clientY: 205 } as unknown as Touch] as unknown as TouchList,
      }),
      'Cancelled edge swipe must never trigger back navigation'
    );
  });

  return results;
}
