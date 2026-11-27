import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { computeMascotMood } from '@/app/providers/NotificationReadModel';
import {
  isDebugCertificateDn,
  parseKeytoolPrintCertOutput,
} from '../scripts/verify-apk-artifact.mjs';

export interface Ge0008TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

async function runCase(name: string, fn: () => Promise<void> | void): Promise<Ge0008TestResult> {
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

export async function runAllGe0008EdgeMascotReleaseTests(): Promise<Ge0008TestResult[]> {
  return [
    await runCase('GE-0008 #1: scripts/sync-version.mjs verifies parity and repairs drifted Gradle/version.json without touching signingConfigs', () => {
      const scriptPath = path.join(ROOT, 'scripts/sync-version.mjs');
      assert(fs.existsSync(scriptPath), 'scripts/sync-version.mjs must exist');

      // 1) Current workspace must pass strict check mode
      const checkOut = execFileSync(process.execPath, [scriptPath, '--check'], {
        cwd: ROOT,
        encoding: 'utf8',
      });
      assert(checkOut.includes('CHECK PASS'), `Expected CHECK PASS, got: ${checkOut}`);

      // 2) Drift repair inside an isolated temp directory must preserve signingConfigs untouched
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minadental-sync-version-'));
      try {
        fs.mkdirSync(path.join(tmpDir, 'app'), { recursive: true });
        fs.mkdirSync(path.join(tmpDir, 'public'), { recursive: true });
        fs.writeFileSync(
          path.join(tmpDir, 'package.json'),
          JSON.stringify({ name: 'test-app', version: '4.19.2' }, null, 2),
          'utf8'
        );
        const gradleFixture = `android {
    defaultConfig {
        applicationId = "com.minadental.app"
        versionCode = 167
        versionName = "4.17.0"
    }
    signingConfigs {
        create("release") {
            storeFile = file("debug.keystore")
        }
    }
}
`;
        fs.writeFileSync(path.join(tmpDir, 'app/build.gradle.kts'), gradleFixture, 'utf8');
        fs.writeFileSync(
          path.join(tmpDir, 'public/version.json'),
          JSON.stringify({ version: '4.17.0', androidVersionName: '4.17.0', androidVersionCode: 167 }, null, 2),
          'utf8'
        );

        execFileSync(process.execPath, [scriptPath, '--root', tmpDir, '--sequence', '230'], {
          encoding: 'utf8',
        });

        const updatedGradle = fs.readFileSync(path.join(tmpDir, 'app/build.gradle.kts'), 'utf8');
        assert(updatedGradle.includes('versionName = "4.19.2"'), 'Gradle versionName must sync to 4.19.2');
        assert(updatedGradle.includes('versionCode = 230'), 'Gradle versionCode must sync to monotonic 230');
        assert(
          updatedGradle.includes('storeFile = file("debug.keystore")'),
          'sync-version.mjs must NEVER alter signingConfigs'
        );

        const updatedVersionJson = JSON.parse(
          fs.readFileSync(path.join(tmpDir, 'public/version.json'), 'utf8')
        );
        assert(updatedVersionJson.version === '4.19.2', 'public/version.json version must sync');
        assert(updatedVersionJson.androidVersionCode === 230, 'public/version.json androidVersionCode must sync');

        // Verify check mode now passes on repaired fixture
        execFileSync(process.execPath, [scriptPath, '--root', tmpDir, '--check'], {
          encoding: 'utf8',
        });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }),

    await runCase('GE-0008 #2: scripts/verify-apk-artifact.mjs parses keytool output, detects debug certs & supports CI build reports', () => {
      const verifierSrc = fs.readFileSync(path.join(ROOT, 'scripts/verify-apk-artifact.mjs'), 'utf8');
      assert(verifierSrc.includes('apksigner'), 'verify-apk-artifact.mjs must invoke apksigner');
      assert(verifierSrc.includes('keytool'), 'verify-apk-artifact.mjs must invoke keytool');
      assert(verifierSrc.includes('--forbid-debug-signing'), 'verify-apk-artifact.mjs must support --forbid-debug-signing');
      assert(verifierSrc.includes('--report'), 'verify-apk-artifact.mjs must support --report build report output');

      const sampleDebugCert = `Signer #1:
Signature:
Owner: C=US, O=Android, CN=Android Debug
Issuer: C=US, O=Android, CN=Android Debug
Certificate fingerprints:
         SHA1: AA:BB:CC
         SHA256: 11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF
`;
      const parsedDebug = parseKeytoolPrintCertOutput(sampleDebugCert);
      assert(parsedDebug.owner === 'C=US, O=Android, CN=Android Debug', 'keytool parser must extract Owner DN');
      assert(parsedDebug.certSha256?.startsWith('11223344'), 'keytool parser must extract normalized SHA256 fingerprint');
      assert(isDebugCertificateDn(parsedDebug.owner), 'Debug certificate DN must be detected');
      assert(
        !isDebugCertificateDn('CN=MinaDental Release, O=MinaDental Clinic, C=IR'),
        'Production release DN must not be flagged as debug'
      );
    }),

    await runCase('GE-0008 #3: Unified GitHub Actions release pipeline exports env vars BEFORE node, forbids debug signing & avoids stale APK metadata race', () => {
      const deployYml = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
      assert(deployYml.includes('allocate_and_build_web:'), 'deploy.yml must allocate authoritative sequence and build Web');
      assert(deployYml.includes('build_verify_and_publish_android:'), 'deploy.yml must build, sign & verify Android APK in unified workflow');
      assert(deployYml.includes('deploy_pages_and_verify_live:'), 'deploy.yml must deploy GitHub Pages after coherent Android metadata is ready');
      assert(deployYml.includes('--forbid-debug-signing'), 'Stable release in deploy.yml must forbid debug signing');
      assert(deployYml.includes('--require-apksigner'), 'deploy.yml must enforce apksigner verification');
      assert(deployYml.includes('--require-keytool'), 'deploy.yml must enforce keytool verification');
      assert(deployYml.includes('export APK_SHA256 APK_SIZE CERT_SHA256'), 'deploy.yml must export env vars BEFORE node execution');
      assert(!deployYml.includes("' APK_SHA256="), 'deploy.yml must never pass env vars after node script argument');

      const androidYml = fs.readFileSync(path.join(ROOT, '.github/workflows/android-apk.yml'), 'utf8');
      assert(androidYml.includes('export APK_SHA256 APK_SIZE CERT_SHA256'), 'android-apk.yml must export env vars BEFORE node execution');
      assert(androidYml.includes('--forbid-debug-signing'), 'android-apk.yml must forbid debug signing on stable channel');
    }),

    await runCase('GE-0008 #4: Emotional 3D Mascot is frameless everywhere in-app (44-56px), has 7 deterministic states & zero patient PHI', () => {
      const mascotSrc = fs.readFileSync(path.join(ROOT, 'src/components/ui/MascotTooth.tsx'), 'utf8');
      assert(mascotSrc.includes('data-mascot-frameless="true"'), 'MascotTooth must render frameless transparent 3D mascot');
      assert(mascotSrc.includes('role="img"'), 'MascotTooth must expose accessible role="img"');
      assert(mascotSrc.includes('aria-label='), 'MascotTooth must expose accessible Persian aria-label');
      assert(
        !mascotSrc.includes('patientName') && !mascotSrc.includes('nationalCode') && !mascotSrc.includes('phoneNumber'),
        'MascotTooth must never handle or expose patient PHI'
      );

      // Verify all 7 deterministic states from real clinic signals
      assert(computeMascotMood([], 0, { isOnline: false }) === 'offline', 'Offline signal -> offline');
      assert(computeMascotMood([], 0, { isOnline: true, isProcessing: true }) === 'thinking', 'Processing signal -> thinking');
      assert(computeMascotMood([], 0, { isOnline: true, isAuthorized: false }) === 'neutral', 'Unauthorized signal -> neutral');
      assert(
        computeMascotMood(
          [{ id: 'a1', domain: 'finance', targetSection: 'finance', patientName: 'بیمار', title: 'چک سررسید گذشته', subtitle: '', dueDate: '2026-11-20', urgency: 'critical' }],
          1,
          { isOnline: true, isAuthorized: true, isDataReady: true }
        ) === 'sad',
        'Overdue/critical alert -> sad'
      );
      assert(
        computeMascotMood(
          [{ id: 'a2', domain: 'appointment', targetSection: 'appointments', patientName: 'بیمار', title: 'یادآوری پیش‌رو', subtitle: '', dueDate: '2026-11-28', urgency: 'upcoming' }],
          1,
          { isOnline: true, isAuthorized: true, isDataReady: true }
        ) === 'concerned',
        'Pending upcoming alert -> concerned'
      );
      assert(
        computeMascotMood([], 0, { isOnline: true, isAuthorized: true, isDataReady: true, justCompleted: true }) === 'celebrating',
        'Completed task with zero overdue -> celebrating'
      );
      assert(computeMascotMood([], 0, { isOnline: true, isAuthorized: true, isDataReady: true }) === 'happy', 'Clear clinic state -> happy');

      assert(computeMascotMood([], 0) === 'neutral', 'Unknown authorization must not show success');
      assert(computeMascotMood([], 0, { isAuthorized: true }) === 'neutral', 'Unknown data readiness must not show success');
      assert(computeMascotMood([], 0, { isAuthorized: true, isDataReady: false, justCompleted: true }) === 'neutral', 'Incomplete data must not show celebration');
      assert(computeMascotMood([], 12, { isAuthorized: true, isDataReady: true }) === 'concerned', 'Pending count alone is not overdue');
      assert(computeMascotMood([], 1, { isAuthorized: true, isDataReady: true, overdueCount: 1 }) === 'sad', 'Explicit overdue evidence triggers attention');
      assert(computeMascotMood([{ id: 'today', domain: 'appointment', targetSection: 'appointments', patientName: 'آزمایشی', title: 'امروز', subtitle: '', dueDate: '2026-11-27', urgency: 'today' }], 1, { isAuthorized: true, isDataReady: true }) === 'concerned', 'Today alone is not overdue');

      // Ensure NO in-app consumer passes framed={true} or oversized/tiny dimensions
      const consumers = [
        'src/app/shell/AdaptiveTopBar.tsx',
        'src/navigation/NavigationRail.tsx',
        'src/components/ui/NotificationDrawer.tsx',
        'src/components/ui/IOSReminderPopup.tsx',
        'src/app/QBankFoldersOverlay.tsx',
        'src/design-system/primitives/AdaptiveLayout.tsx',
      ];
      for (const rel of consumers) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        assert(!src.includes('framed={true}') && !src.includes(' framed ') && !src.includes(' framed\n'), `${rel} must NOT wrap MascotTooth in a framed dark box`);
      }

      // Ensure mobile notification bell is always visible (not hidden sm:flex)
      const topBarSrc = fs.readFileSync(path.join(ROOT, 'src/app/shell/AdaptiveTopBar.tsx'), 'utf8');
      assert(
        !topBarSrc.includes('topbar-btn hidden sm:flex shrink-0'),
        'AdaptiveTopBar notification bell must stay visible on mobile viewports'
      );
    }),

    await runCase('GE-0008 #5: Edge-to-Edge CSS & progressive WebView fallbacks (Note8 -> S26 Ultra / iPhone / iPad / Windows)', () => {
      const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
      assert(css.includes('height: 100vh;') && css.includes('height: 100dvh;'), 'index.css must include 100vh fallback before 100dvh for legacy WebViews');
      assert(css.includes('--safe-left: env(safe-area-inset-left, 0px);'), 'index.css must define horizontal safe-area-inset-left');
      assert(css.includes('--safe-right: env(safe-area-inset-right, 0px);'), 'index.css must define horizontal safe-area-inset-right');
      assert(css.includes('padding-inline-start: var(--safe-left);'), 'app-shell-viewport must use logical RTL horizontal safe areas');
      assert(css.includes('@supports not ((backdrop-filter: blur(1px))'), 'index.css must include legacy WebView backdrop-filter fallback');
      assert(css.includes('@keyframes mascotTouchPop'), 'index.css must define mascot touch reaction animation');
    }),

    await runCase('GE-0008 #6: Permanent OTA anti-stale-CDN defenses (SW sequence guard, ./sw.js?v= CDN bypass & release-pointer cache-buster)', () => {
      const swSrc = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
      assert(swSrc.includes('RESOLVED_RELEASE_SEQ'), 'sw.js must track RESOLVED_RELEASE_SEQ to reject stale older CDN HTML');
      assert(swSrc.includes('validation.responseReleaseSeq > RESOLVED_RELEASE_SEQ'), 'sw.js must only pass through mismatched HTML when strictly newer');

      const adapterSrc = fs.readFileSync(path.join(ROOT, 'src/services/updates/adapters/webPwaAdapter.ts'), 'utf8');
      assert(adapterSrc.includes('./sw.js?v=${encodeURIComponent(input.manifest.releaseId)}'), 'WebPwaUpdateAdapter must fall back to same-scope CDN-bypassing ./sw.js?v=<releaseId>');

      const clientSrc = fs.readFileSync(path.join(ROOT, 'src/services/updates/manifestClient.ts'), 'utf8');
      assert(clientSrc.includes("u.searchParams.set('_cb'"), 'manifestClient must bypass edge CDN cache on fresh browser release-pointer fetches');
    }),
  ];
}
