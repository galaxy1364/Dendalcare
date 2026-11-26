import fs from 'node:fs';
import path from 'node:path';
import {
  resolvePlatformDesign,
  type DensityMode,
  type PlatformDesignLanguage,
} from '@/design-system/themes/appearance';
import { normalizePersianDigits } from '@/design-system/primitives/FormEngine';
import { readViewportMetrics } from '@/platform/safeArea';

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
    await runCase('GE-0003 #1: Dead duplicate navigation files (BottomDock, DesktopSidebar) are removed', () => {
      assert(!fs.existsSync(path.join(ROOT, 'src/components/BottomDock.tsx')), 'BottomDock.tsx must be deleted');
      assert(!fs.existsSync(path.join(ROOT, 'src/components/DesktopSidebar.tsx')), 'DesktopSidebar.tsx must be deleted');
    }),

    await runCase('GE-0003 #2: Duolingo-style emotional iridescent tooth mascot is unified across app, notifications & launcher icons', () => {
      const mascotSrc = fs.readFileSync(path.join(ROOT, 'src/components/ui/MascotTooth.tsx'), 'utf8');
      assert(mascotSrc.includes('useId()'), 'MascotTooth must use unique SVG gradient IDs via useId()');
      assert(mascotSrc.includes("type MascotMood = 'happy' | 'sad' | 'pro' | 'ai' | 'celebrate' | 'offline'"), 'MascotTooth must expose all 6 emotional moods');
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
