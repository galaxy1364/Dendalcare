# ADR-003: Universal Platform Capability Registry, Wrapper Inventory & Role-Aware Adaptive Shell

- **Status:** Accepted (V13 Phase A/B Foundation)
- **Date:** 2026-11-26
- **Reviewed Baseline Commit:** `7925767ce462b2d61cf983e5bd4b80e1bf5ddf99`
- **Coordination Issue:** https://github.com/galaxy1364/Dendalcare/issues/4#issuecomment-7175753238

## 1. Context & Repository Host Inventory (Verified On Disk)
To avoid unverified assumptions about native packaging or duplicating frameworks unnecessarily (such as adding Capacitor over an existing maintained host), we inventoried all platform wrappers currently in the workspace:

1. **Web / Installable PWA (`public/manifest.json`, `public/sw.js`, `src/lib/updateManager.ts`)**
   - **Status:** Implemented & tested.
   - Provides RTL PWA manifest (`display_override: window-controls-overlay, standalone`), self-hosted `Vazirmatn` fonts, verified structural HTML SW cache/fallback (`validateNavigationHtml`), and signed atomic update state machine.
   - Visual glass surfaces use CSS `backdrop-filter` approximation backed by solid opaque surface colors (`rgba(255,255,255,0.96)` light / `#11202E` dark) — **never** claimed as native Apple SwiftUI Liquid Glass.

2. **Android WebView / Compose Host (`/app/`, `build.gradle.kts`, `AndroidManifest.xml`)**
   - **Status:** Maintained custom Kotlin/Compose WebView host verified on disk.
   - `MainActivity.kt` hosts `LocalAssetServer` + `DentalCareWebView.kt` inside Compose edge-to-edge `statusBarsPadding()` / `navigationBarsPadding()` + `AppCheckConfig.kt`.
   - `DentalCareWebView.kt` registers `AndroidHapticBridge` (`@JavascriptInterface fun performHaptic(kind: String)` and `getNativeAppInfo()`), scoped to local/appassets origins.
   - **Decision:** Retain this existing maintained Android WebView host rather than introducing Capacitor redundantly. Note: container lacks Android emulator/ADB execution, and production release APK/AAB signing requires CI/owner release keystore.

3. **Windows Desktop Delivery (`src/platform/capabilities.ts`, `NavigationRail.tsx`)**
   - **Status:** Edge/Chrome PWA `--app` launcher (`MinaDental-Windows.cmd`) + adaptive RTL desktop sidebar & keyboard shortcuts (`Ctrl+K`, `F1`–`F9`, `Escape`).
   - **Decision:** Keep Edge PWA-first delivery per V13 contract; evaluate MSIX/WinUI 3 only when Windows-native printing/COM integrations become justified. No `.msix` or `.exe` package is generated in Linux CI.

4. **iOS / iPadOS (`MinaDental-iOS.mobileconfig`, `apple-touch-icon.png`)**
   - **Status:** Safari / Home Screen WebClip PWA profile exists on disk; **no `ios/` Xcode project, Swift source, entitlements, privacy manifest, or macOS/Xcode 27 runner exists in this repository or execution environment.**
   - **Decision:** JS bridge adapter (`webkit.messageHandlers.minaHaptics`) remains guarded and strictly reports `'unavailable'` unless a genuine native WKWebView host responds. Native IPA archive, TestFlight signing, CoreHaptics, WidgetKit, ActivityKit, and App Intents are **honestly marked `unavailable / blocked (no macOS/Xcode/Apple signing host in container)`** until an authorized macOS/Xcode project is added.

## 2. Decisions
1. **Typed Capability Negotiation (`src/platform/capabilities.ts`)**:
   - Every capability reports `{ availability: 'supported' | 'permission_required' | 'unavailable' | 'disabled' | 'restricted', reason, source }`.
   - `negotiatePlatformBridgeHandshake()` validates allowed origins, enforces request timeout fallback, parses `AndroidBridge.getNativeAppInfo()` defensively, and exposes **no** arbitrary JS execution, filesystem, or credential APIs.
   - Keep `nativeLiquidGlassAvailable = false` on Web/PWA/Android; `nativeCoreHapticsAvailable` is `true` only when a verified iOS WKWebView host handler exists.

2. **Window-Size-First Adaptive Breakpoints (`src/platform/capabilities.ts` & `src/platform/safeArea.ts`)**:
   - Use V13 4-band window width classification (`compact < 600`, `medium 600–1023`, `expanded 1024–1439`, `wide >= 1440`) alongside existing compatibility breakpoint helpers.

3. **Role-Aware Adaptive Navigation (`FloatingDock.tsx`, `NavigationRail.tsx`, `AppShell.tsx`)**:
   - Both mobile QBank bottom dock (`FloatingDock`) and tablet/desktop sidebar (`NavigationRail`) must consume the verified `effectiveRole` from `AppProviders`, never stale local role fields alone.
   - `FloatingDock` preserves canonical 4-destination QBank capsule geometry (`dashboard`, `appointments`, `patients`, `finance` for finance-authorized roles) while automatically replacing/hiding `'finance'` for roles denied financial access (`dentist` -> safe `calendar`, `assistant` -> safe `calendar`, `unauthorized` -> empty/hidden) and hiding unauthorized routes.

4. **Draft-Safe & Cancellable RTL Gestures (`src/platform/gestures.ts`)**:
   - RTL right-edge back swipe (`10..44px` corridor) stays strictly guarded against OS edge zone (`0..10px`), horizontal scrollers/inputs, active modals, and unsaved form drafts (`[data-unsaved-draft="true"]`, `[data-gesture-lock="true"]`), and resets cleanly via `cancelRtlEdgeBackSwipe` on `touchcancel`.

## 3. Consequences
- Positive: Prevents unauthorized route exposure (`finance`, `reports`) in navigation chrome across every form factor, prevents accidental draft loss from RTL edge swipes, and guarantees zero deceptive capability/platform claims.
- Trade-off: Native iOS IPA, WidgetKit, ActivityKit, and Windows MSIX packaging remain explicitly deferred to Phase D/E with dedicated native runners and owner signing credentials.
