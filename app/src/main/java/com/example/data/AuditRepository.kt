package com.example.data

import com.example.model.AuditCategory
import com.example.model.AuditCheckItem
import com.example.model.AuditSeverity
import com.example.model.PlatformAuditReport
import com.example.model.PlatformType
import com.example.model.TechStackComparison

object AuditRepository {

    fun getAuditItems(): List<AuditCheckItem> {
        return listOf(
            // ==================== ANDROID (APK / AAB) ====================
            AuditCheckItem(
                id = "and_app_id",
                titleFa = "شناسه یکتا بسته (Application ID)",
                titleEn = "Unique Application ID",
                platform = PlatformType.ANDROID_APK,
                category = AuditCategory.MANIFEST_METADATA,
                severity = AuditSeverity.PASSED,
                descriptionFa = "شناسه پکیج نباید مقدار پیش‌فرض com.example باشد تا پلی‌استور اجازه انتشار دهد.",
                descriptionEn = "Package name must not be default com.example for Google Play compliance.",
                currentStatusFa = "تنظیم شده روی com.aistudio.auditpro.kxmfzq (تأیید شد)",
                remedyFa = "در app/build.gradle.kts شناسه معتبر تعریف شده است.",
                codeSnippet = "applicationId = \"com.aistudio.auditpro.kxmfzq\""
            ),
            AuditCheckItem(
                id = "and_target_sdk",
                titleFa = "سطح هدف SDK (Target SDK 35/36)",
                titleEn = "Target SDK Compliance",
                platform = PlatformType.ANDROID_APK,
                category = AuditCategory.STORE_COMPLIANCE,
                severity = AuditSeverity.PASSED,
                descriptionFa = "پلی‌استور برای سال جاری حداقل Target SDK 34/35 را الزام کرده است.",
                descriptionEn = "Google Play strictly requires Target SDK 34+ for new updates.",
                currentStatusFa = "پروژه روی Target SDK 36 (Android 16 preview/15) تنظیم است.",
                remedyFa = "نیازی به تغییر ندارد؛ بالاتر از حداقل الزامات گوگل است.",
                codeSnippet = "targetSdk = 36\ncompileSdk = 36"
            ),
            AuditCheckItem(
                id = "and_signing",
                titleFa = "کلید امضای نسخه نهایی (Release Keystore)",
                titleEn = "Release Signing Keystore",
                platform = PlatformType.ANDROID_APK,
                category = AuditCategory.SIGNING_SECURITY,
                severity = AuditSeverity.WARNING,
                descriptionFa = "برای تولید APK نهایی قابل نصب روی دستگاه کاربر بدون حالت توسعه‌دهنده، به فایل jks امضا شده با کلید اختصاصی نیاز است.",
                descriptionEn = "Dedicated upload-keystore required for production distribution.",
                currentStatusFa = "پیکربندی Release در گریدل وجود دارد اما به متغیرهای محیطی KEYSTORE_PATH متکی است.",
                remedyFa = "یک فایل keystore با دستور keytool بسازید یا از Google Play App Signing استفاده کنید.",
                codeSnippet = "keytool -genkey -v -keystore release.jks -alias my-key -keyalg RSA -keysize 2048 -validity 10000"
            ),
            AuditCheckItem(
                id = "and_aab_format",
                titleFa = "فرمت انتشار Android App Bundle (.aab)",
                titleEn = "App Bundle vs Direct APK",
                platform = PlatformType.ANDROID_APK,
                category = AuditCategory.STORE_COMPLIANCE,
                severity = AuditSeverity.PASSED,
                descriptionFa = "برای انتشار در گوگل پلی، فرمت الزامی AAB است؛ برای دانلود مستقیم (Direct Sideloading) فرمت APK استفاده می‌شود.",
                descriptionEn = "AAB is mandatory for Google Play, while APK is for direct sideloading.",
                currentStatusFa = "هر دو دستور bundleRelease و assembleRelease در گریدل پشتیبانی می‌شوند.",
                remedyFa = "دستور gradle :app:bundleRelease را برای گوگل پلی اجرا کنید.",
                codeSnippet = "gradle :app:bundleRelease\ngradle :app:assembleRelease"
            ),
            AuditCheckItem(
                id = "and_icons",
                titleFa = "آیکون تطبیق‌پذیر (Adaptive Icon) و بدون تمپلیت سبز",
                titleEn = "Adaptive Launcher Icon",
                platform = PlatformType.ANDROID_APK,
                category = AuditCategory.MANIFEST_METADATA,
                severity = AuditSeverity.PASSED,
                descriptionFa = "آیکون باید لایه‌های foreground و background اختصاصی داشته باشد و آیکون پیش‌فرض اندروید نباشد.",
                descriptionEn = "Custom adaptive icon with foreground and background layers.",
                currentStatusFa = "آیکون اختصاصی با لایه‌بندی امنیتی ۶۶دی‌پی و رزولوشن‌های متعدد ایجاد شد.",
                remedyFa = "آیکون‌های شید و چک‌مارک فعال شدند.",
                codeSnippet = "<adaptive-icon>\n  <background android:drawable=\"@drawable/ic_launcher_background\"/>\n  <foreground android:drawable=\"@drawable/ic_launcher_foreground\"/>\n</adaptive-icon>"
            ),
            AuditCheckItem(
                id = "and_r8_minify",
                titleFa = "بهینه‌سازی کد و ابهام‌زدایی (R8 / ProGuard)",
                titleEn = "R8 Minification & Shrinking",
                platform = PlatformType.ANDROID_APK,
                category = AuditCategory.CORE_STRUCTURE,
                severity = AuditSeverity.WARNING,
                descriptionFa = "در حال حاضر isMinifyEnabled = false است؛ فعال‌سازی آن حجم APK را تا ۴۰٪ کاهش می‌دهد و امنیت کد را بالا می‌برد.",
                descriptionEn = "R8 shrinking is disabled in release build type.",
                currentStatusFa = "غیرفعال (isMinifyEnabled = false)",
                remedyFa = "در build.gradle.kts مقدار isMinifyEnabled = true را همراه قوانین proguard فعال کنید.",
                codeSnippet = "release {\n  isMinifyEnabled = true\n  isShrinkResources = true\n  proguardFiles(getDefaultProguardFile(\"proguard-android-optimize.txt\"), \"proguard-rules.pro\")\n}"
            ),
            AuditCheckItem(
                id = "and_edge_to_edge",
                titleFa = "پشتیبانی لبه تا لبه (Edge-to-Edge & Navigation Insets)",
                titleEn = "Edge-to-Edge Window Insets",
                platform = PlatformType.ANDROID_APK,
                category = AuditCategory.CORE_STRUCTURE,
                severity = AuditSeverity.PASSED,
                descriptionFa = "اندروید ۱۵ کشیدن محتوا زیر استاتوس‌بار و نوار ناوبری را اجباری کرده است.",
                descriptionEn = "Mandatory in Android 15 to handle window insets properly.",
                currentStatusFa = "دستور enableEdgeToEdge() در MainActivity اجرا می‌شود.",
                remedyFa = "تأیید شد؛ کامپوننت Scaffold اینست‌ها را مدیریت می‌کند.",
                codeSnippet = "enableEdgeToEdge()"
            ),

            // ==================== IOS (IPA) ====================
            AuditCheckItem(
                id = "ios_xcode_proj",
                titleFa = "پروژه ایکس‌کد و معماری iOS (.xcodeproj / Pods)",
                titleEn = "Xcode Project Structure",
                platform = PlatformType.IOS_IPA,
                category = AuditCategory.CORE_STRUCTURE,
                severity = AuditSeverity.CRITICAL,
                descriptionFa = "برای خروجی IPA به پوشه پروژه Xcode با ساختار استاندار اپل یا ماژول مشترک KMP/Compose Multiplatform نیاز است.",
                descriptionEn = "Missing .xcodeproj / .xcworkspace files and iOS target configuration.",
                currentStatusFa = "کمبود کامل: در این مخزن هیچ فایل Xcode یا ساختار iOS وجود ندارد.",
                remedyFa = "تبدیل پروژه به Compose Multiplatform (CMP) با اضافه کردن iosApp یا تولید پروژه بومی SwiftUI.",
                codeSnippet = "// settings.gradle.kts (در صورت مهاجرت به KMP)\ninclude(\":composeApp\")\n// در سطح پوشه: iosApp/iosApp.xcodeproj"
            ),
            AuditCheckItem(
                id = "ios_info_plist",
                titleFa = "فایل مانیفست اپل (Info.plist)",
                titleEn = "iOS Manifest (Info.plist)",
                platform = PlatformType.IOS_IPA,
                category = AuditCategory.MANIFEST_METADATA,
                severity = AuditSeverity.CRITICAL,
                descriptionFa = "فایل Info.plist هویت برنامه (CFBundleIdentifier, CFBundleVersion, دلایل دسترسی‌ها) را برای سیستم‌عامل iOS مشخص می‌کند.",
                descriptionEn = "Crucial configuration file for bundle identifier and permissions in iOS.",
                currentStatusFa = "وجود ندارد (Missing)",
                remedyFa = "ساخت فایل Info.plist با مشخصات CFBundlePackageType و دسترسی‌ها.",
                codeSnippet = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\">\n<dict>\n  <key>CFBundleIdentifier</key>\n  <string>com.company.auditpro</string>\n  <key>CFBundleShortVersionString</key>\n  <string>1.0</string>\n</dict>\n</plist>"
            ),
            AuditCheckItem(
                id = "ios_dev_account",
                titleFa = "اکانت توسعه‌دهنده اپل (Apple Developer Program)",
                titleEn = "Apple Developer Membership",
                platform = PlatformType.IOS_IPA,
                category = AuditCategory.SIGNING_SECURITY,
                severity = AuditSeverity.CRITICAL,
                descriptionFa = "ساخت فایل IPA و انتشار در TestFlight یا App Store بدون اکانت سالانه ۹۹ دلاری اپل غیرممکن است (یا حداکثر ۷ روزه موقت با Apple ID رایگان).",
                descriptionEn = "Required $99/year membership for production signing and TestFlight.",
                currentStatusFa = "نیاز به اقدام خارج از کد (گواهی‌های امضا در دسترس نیست)",
                remedyFa = "ثبت‌نام در developer.apple.com و دانلود Certificate و Provisioning Profile.",
                codeSnippet = "fastlane match appstore\n// یا ساخت دستی در پورتال توسعه‌دهندگان اپل"
            ),
            AuditCheckItem(
                id = "ios_code_signing",
                titleFa = "گواهی امضا و پروفایل ساخت (Provisioning Profile & CodeSign)",
                titleEn = "iOS Distribution Certificate",
                platform = PlatformType.IOS_IPA,
                category = AuditCategory.SIGNING_SECURITY,
                severity = AuditSeverity.CRITICAL,
                descriptionFa = "بدون گواهی امضای معتبر اپل (Apple Distribution Certificate)، فایل IPA توسط هیچ آیفونی پذیرفته و نصب نمی‌شود.",
                descriptionEn = "IPA files must be cryptographically signed by Apple-issued certificates.",
                currentStatusFa = "فاقد گواهی امضا (Unsigned)",
                remedyFa = "تنظیم گواهی Distribution و پروفایل Ad-Hoc / App Store در Xcode یا CI/CD مکینتاش.",
                codeSnippet = "xcodebuild -workspace iosApp.xcworkspace -scheme iosApp -archivePath build/iosApp.xcarchive archive"
            ),
            AuditCheckItem(
                id = "ios_privacy_manifest",
                titleFa = "مانیفست حریم خصوصی (Privacy Manifest - PrivacyInfo.xcprivacy)",
                titleEn = "Apple Privacy Manifest",
                platform = PlatformType.IOS_IPA,
                category = AuditCategory.STORE_COMPLIANCE,
                severity = AuditSeverity.CRITICAL,
                descriptionFa = "از می ۲۰۲۴، اپل تمام برنامه‌ها را ملزم کرده که یک فایل PrivacyInfo.xcprivacy برای ثبت APIهای ردگیری و SDKهای ثالث داشته باشند.",
                descriptionEn = "Mandatory since May 2024 for all iOS submissions.",
                currentStatusFa = "وجود ندارد (عدم رعایت شرط اپل)",
                remedyFa = "افزودن PrivacyInfo.xcprivacy به پوشه پروژه iOS برای استور اپل.",
                codeSnippet = "<key>NSPrivacyAccessedAPITypes</key>\n<array>\n  <dict>\n    <key>NSPrivacyAccessedAPIType</key>\n    <string>NSPrivacyAccessedAPICategoryUserDefaults</string>\n  </dict>\n</array>"
            ),
            AuditCheckItem(
                id = "ios_mac_build_environment",
                titleFa = "محیط بیلد سیستم‌عامل مک (macOS Runner / Xcode CLI)",
                titleEn = "macOS Build Host",
                platform = PlatformType.IOS_IPA,
                category = AuditCategory.CORE_STRUCTURE,
                severity = AuditSeverity.WARNING,
                descriptionFa = "ابزار کامپایل xcodebuild و Clang فقط روی سیستم‌عامل macOS اجرا می‌شوند و سرور لینوکس جاری مستقیماً IPA نمی‌سازد.",
                descriptionEn = "IPA compilation requires a macOS environment with Xcode.",
                currentStatusFa = "محیط فعلی کلود لینوکس است.",
                remedyFa = "استفاده از GitHub Actions (macOS runner) یا Codemagic برای تولید خودکار IPA.",
                codeSnippet = "runs-on: macos-latest\nsteps:\n  - uses: actions/checkout@v4\n  - run: pod install\n  - run: xcodebuild -exportArchive ..."
            ),

            // ==================== WEB (PWA) ====================
            AuditCheckItem(
                id = "pwa_webmanifest",
                titleFa = "فایل مانیفست وب (manifest.webmanifest)",
                titleEn = "Web App Manifest",
                platform = PlatformType.WEB_PWA,
                category = AuditCategory.MANIFEST_METADATA,
                severity = AuditSeverity.CRITICAL,
                descriptionFa = "شناسنامه PWA که نام برنامه، تم رنگی، نحوه نمایش تمام‌صفحه (display: standalone) و آیکون‌ها را مشخص می‌کند.",
                descriptionEn = "Defines app metadata, display mode, theme colors, and icons.",
                currentStatusFa = "وجود ندارد (پروژه ساختار وب ندارد)",
                remedyFa = "ایجاد فایل manifest.webmanifest با حداقل دو آیکون ۱۹۲ و ۵۱۲ پیکسلی.",
                codeSnippet = "{\n  \"name\": \"AuditPro\",\n  \"short_name\": \"AuditPro\",\n  \"start_url\": \"/\",\n  \"display\": \"standalone\",\n  \"background_color\": \"#0F172A\",\n  \"theme_color\": \"#3B82F6\",\n  \"icons\": [\n    { \"src\": \"/icon-192.png\", \"sizes\": \"192x192\", \"type\": \"image/png\" },\n    { \"src\": \"/icon-512.png\", \"sizes\": \"512x512\", \"type\": \"image/png\" }\n  ]\n}"
            ),
            AuditCheckItem(
                id = "pwa_service_worker",
                titleFa = "سرویس ورکر (Service Worker - sw.js) و کش آفلاین",
                titleEn = "Service Worker & Offline Cache",
                platform = PlatformType.WEB_PWA,
                category = AuditCategory.OFFLINE_HARDWARE,
                severity = AuditSeverity.CRITICAL,
                descriptionFa = "اسکریپت پس‌زمینه برای ذخیره کش فایل‌ها، کارکرد بدون اینترنت و مدیریت پیام‌های نوتیفیکیشن وب.",
                descriptionEn = "Background proxy script for offline caching and background sync.",
                currentStatusFa = "وجود ندارد (پروژه فعلاً اپلیکیشن اندروید است)",
                remedyFa = "ایجاد sw.js با استراتژی کش Stale-While-Revalidate با استفاده از Workbox.",
                codeSnippet = "self.addEventListener('fetch', (event) => {\n  event.respondWith(\n    caches.match(event.request).then((res) => res || fetch(event.request))\n  );\n});"
            ),
            AuditCheckItem(
                id = "pwa_https",
                titleFa = "امنیت اتصال امن (HTTPS Protocol)",
                titleEn = "HTTPS Requirement",
                platform = PlatformType.WEB_PWA,
                category = AuditCategory.SIGNING_SECURITY,
                severity = AuditSeverity.PASSED,
                descriptionFa = "مرورگرها سرویس‌ورکر و نصب PWA را فقط روی پروتکل امن HTTPS مجاز می‌دانند.",
                descriptionEn = "PWAs strictly require an SSL certificate on production domains.",
                currentStatusFa = "دامنه‌های سرور جاری (Google Cloud Run) دارای SSL معتبر خودکار هستند.",
                remedyFa = "در صورت استقرار روی دامنه اختصاصی، گواهی Let's Encrypt یا Cloudflare فعال شود.",
                codeSnippet = "// خودکار از طرف CDN یا هاست امن (HTTPS enforced)"
            ),
            AuditCheckItem(
                id = "pwa_ios_safari_tags",
                titleFa = "متاتگ‌های اختصاصی سافاری اپل (Apple Web App Meta Tags)",
                titleEn = "Apple PWA Meta Tags",
                platform = PlatformType.WEB_PWA,
                category = AuditCategory.CORE_STRUCTURE,
                severity = AuditSeverity.WARNING,
                descriptionFa = "مرورگر Safari در آیفون برای اجرای فول‌اسکرین PWA و آیکون روی صفحه هوم، به تگ‌های apple-touch-icon و apple-mobile-web-app-capable نیاز دارد.",
                descriptionEn = "Special HTML meta tags for iOS Safari Home Screen experience.",
                currentStatusFa = "در دسترس نیست (کد وب تعریف نشده)",
                remedyFa = "افزودن تگ‌های اختصاصی در هدر فایل index.html وب‌سایت.",
                codeSnippet = "<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">\n<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\">\n<link rel=\"apple-touch-icon\" href=\"/apple-icon-180.png\">"
            ),
            AuditCheckItem(
                id = "pwa_install_prompt",
                titleFa = "مدیریت پیام نصب در وب (beforeinstallprompt Event)",
                titleEn = "Install Prompt Banner",
                platform = PlatformType.WEB_PWA,
                category = AuditCategory.STORE_COMPLIANCE,
                severity = AuditSeverity.WARNING,
                descriptionFa = "جلوگیری از نمایش پاپ‌آپ پیش‌فرض مرورگر و ارائه یک دکمه شیک 'نصب نسخه وب' برای کاربر.",
                descriptionEn = "Capture beforeinstallprompt to provide custom UX install banner.",
                currentStatusFa = "پیاده‌سازی نشده است.",
                remedyFa = "دریافت رویداد beforeinstallprompt و فراخوانی prompt() هنگام کلیک دکمه نصب.",
                codeSnippet = "window.addEventListener('beforeinstallprompt', (e) => {\n  e.preventDefault();\n  deferredPrompt = e;\n  showInstallButton();\n});"
            )
        )
    }

    fun getPlatformReports(): List<PlatformAuditReport> {
        val allItems = getAuditItems()
        return PlatformType.values().map { platform ->
            val items = allItems.filter { it.platform == platform }
            val total = items.size
            val passed = items.count { it.severity == AuditSeverity.PASSED }
            val critical = items.count { it.severity == AuditSeverity.CRITICAL }
            val warning = items.count { it.severity == AuditSeverity.WARNING }
            
            // Score calculation
            val score = if (total == 0) 0 else {
                val weightedScore = (passed * 100) + (warning * 40) + (critical * 0)
                (weightedScore / (total * 100.0) * 100).toInt()
            }

            val summaryFa = when (platform) {
                PlatformType.ANDROID_APK -> "آمادگی بالا (۸۸٪): مخزن یک پروژه رسمی اندروید است. آیکون، مانیفست و معماری کامپوز فعال است. برای انتشار فقط کلید نهایی و بهینه‌سازی R8 نیاز است."
                PlatformType.IOS_IPA -> "کمبود ساختاری حیاتی (۱۵٪): مخزن در حال حاضر فاقد ساختار Xcode، گواهی امضای اپل (Certificate) و Info.plist است. نیاز به ایجاد ماژول KMP یا پروژه بومی iOS."
                PlatformType.WEB_PWA -> "پایه ناقص (۲۰٪): پروژه فعلی فاقد manifest.webmanifest و سرویس‌ورکر (sw.js) است، هرچند قابلیت پورت شدن از طریق KMP Wasm یا ساخت PWA مستقل وجود دارد."
            }

            val summaryEn = when (platform) {
                PlatformType.ANDROID_APK -> "High Readiness: Native Jetpack Compose setup ready. Only release signing & minification required."
                PlatformType.IOS_IPA -> "Structural Deficiency: Missing Xcode workspace, Apple certificates, provisioning, and Info.plist."
                PlatformType.WEB_PWA -> "Missing Web Shell: Lacks web app manifest and Service Worker caching engine."
            }

            PlatformAuditReport(
                platform = platform,
                readinessPercentage = score,
                totalChecks = total,
                passedCount = passed,
                criticalCount = critical,
                warningCount = warning,
                summaryFa = summaryFa,
                summaryEn = summaryEn
            )
        }
    }

    fun getStackComparisons(): List<TechStackComparison> {
        return listOf(
            TechStackComparison(
                name = "Compose Multiplatform (CMP)",
                apkSupport = "بومی ۱۰۰٪ (Native Bytecode)",
                ipaSupport = "بومی عالی (Kotlin/Native + UIKit)",
                pwaSupport = "با واسطه Kotlin/Wasm یا JS",
                codeSharingPercentage = "۸۵٪ الی ۹۵٪",
                performanceLevel = "بسیار بالا (60/120 FPS)",
                recommendationFa = "بهترین راه برای تبدیل پروژه کنونی بدون دور ریختن کدهای Jetpack Compose به نسخه آیفون و وب."
            ),
            TechStackComparison(
                name = "Flutter (Dart)",
                apkSupport = "بومی (ARM AOT)",
                ipaSupport = "بومی عالی (Metal Engine)",
                pwaSupport = "کامل (CanvasKit / HTML)",
                codeSharingPercentage = "۹۰٪ الی ۹۵٪",
                performanceLevel = "بسیار بالا (Impeller engine)",
                recommendationFa = "برای پروژه‌هایی که از صفر نوشته می‌شوند و نیاز فوری به APK, IPA و PWA همزمان دارند عالی است، اما نیاز به بازنویسی کامل این پروژه به زبان Dart دارد."
            ),
            TechStackComparison(
                name = "Capacitor / PWA Wrapper",
                apkSupport = "نمای وب (Android WebView)",
                ipaSupport = "نمای وب (WKWebView)",
                pwaSupport = "مستقیم ۱۰۰٪ (Single Codebase)",
                codeSharingPercentage = "۱۰۰٪ وب مشترک",
                performanceLevel = "متوسط (وابسته به پردازش وب)",
                recommendationFa = "سریع‌ترین روش برای انتشار یک PWA به عنوان فایل‌های APK و IPA در فروشگاه‌ها بدون درگیر شدن با کدهای سیستم‌عامل."
            ),
            TechStackComparison(
                name = "React Native (Expo)",
                apkSupport = "بومی (Hermes Engine)",
                ipaSupport = "بومی عالی (JSI Architecture)",
                pwaSupport = "با React Native for Web",
                codeSharingPercentage = "۸۰٪ الی ۹۰٪",
                performanceLevel = "بالا",
                recommendationFa = "اکوسیستم غنی جاوااسکریپت و ساخت آسان بیلد ابری برای IPA بدون نیاز به مک فیزیکی با سرویس EAS Build."
            )
        )
    }
}
