# سند جامع استراتژی انتشار و توزیع سیستم مدیریت دندانپزشکی مینادنتال (DentalCare)

**اطلاعات فنی پروژه:**
- **نام برنامه:** DentalCare (مینادنتال)
- **شناسه اندروید (Application ID):** `com.aistudio.auditpro.kxmfzq`
- **نسخه فعلی:** `versionCode = 6` | `versionName = "1.0.6"`
- **پشته ساختار وب:** React + Vite + Tailwind CSS + Supabase Realtime DB
- **پشته نیتیو اندروید:** Kotlin + Jetpack Compose + NanoHTTPD Asset Server + WebView ChromeClient

---

## ۱. استراتژی انتشار در گوگل پلی استور (Google Play Store - APK / AAB)

### ۱.۱. پیش‌نیازها و گام‌های آماده‌سازی
1. **تولید بسته Android App Bundle (AAB):**
   برای گوگل پلی، خروجی به صورت `.aab` (از طریق دستور `gradle :app:bundleRelease`) جایگزین APK سنتی می‌شود.
2. **امضای اختصاصی (Keystore & Release Signing):**
   - کلید امضا درون `my-upload-key.jks` با الگوریتم RSA 4096-bit و SHA-256 ذخیره می‌گردد.
   - فعال‌سازی Google Play App Signing جهت حفاظت از کلید اصلی.
3. **پیکربندی هوشمند VersionCode:**
   - اسکریپت خودکار در `app/build.gradle.kts` با هر بیلد رلیز، شماره نسخه را پله‌ای از طریق `version.properties` افزایش می‌دهد.

### ۱.۲. رعایت ضوابط و سیاست‌های گوگل پلی (Play Policy Compliance)
- **عدم درخواست دسترسی‌های حساس (Sensitive Permissions):**
  از دسترسی‌های خطرناک مانند `READ_MEDIA_IMAGES` یا `MANAGE_EXTERNAL_STORAGE` اجتناب شده و برای انتخاب عکس رادیوگرافی بیماران از **Android Photo Picker** نیتیو بهره‌گیری شده است.
- **حفظ حریم خصوصی داده‌های پزشکی (HIPAA & Health Data Policy):**
  اطلاعات بیماران و پرونده‌های کلینیکی درون سرور امن Supabase با دسترسی zero-trust RLS ذخیره می‌گردند.
- **شفافیت در عملکرد حقوقی:**
  فرم رضایت‌نامه آگاهانه (ConsentModal) منطبق با استانداردهای سازمان نظام پزشکی تدوین شده است.

---

## ۲. استراتژی انتشار در اپ‌استور اپل (Apple App Store - IPA)

### ۲.۱. چالش‌های فنی iOS و راهکار عبور از Review بند 4.2
اپل طبق **App Store Review Guideline 4.2** وب‌سایت‌ها یا WebView‌های ساده بدون قابلیت‌های نیتیو را ریجکت می‌کند. برای تایید ۱۰۰٪ IPA:

1. **محیط ساخت نیتیو iOS (Capacitor / Swift Wrapper):**
   پروژه React درون یک لایه **Capacitor iOS / Swift** بسته‌بندی می‌شود تا دسترسی کامل به دوربین، بیومتریک (FaceID/TouchID)، و نوتیفیکیشن‌های بومی اپل داشته باشد.
2. **پیکربندی گواهی‌های اپل (Apple Developer Account):**
   - ایجاد شناسه `com.aistudio.dentalcare` درون Apple Developer Portal.
   - صدور گواهی‌نامه‌های App Store Distribution Certificate و Provisioning Profile.
3. **پشتیبانی از فرم‌فکتورهای مختلف اپل:**
   تست کامل روی iPhone 16 Pro Max، iPad Pro 12.9 (در حالت Split View) و دستگاه‌های iOS 18+.

---

## ۳. طرح ارائه، توزیع و ارتقای اتوماتیک PWA (Progressive Web App)

PWA به عنوان یک کانال توزیع فوق‌سریع و بدون سانسور/ارزیابی استورها عمل می‌کند:

### ۳.۱. مکانیزم نصب مستقیم با یک کلیک
- **اندروید و دسکتاپ:** پرامپت نیتیو `beforeinstallprompt` در برنامه فعال است و کاربر با لمس یک دکمه برنامه را روی هوم‌اسکرین نصب می‌کند.
- **آیفون (iOS Safari):** استفاده از متاتگ‌های `apple-mobile-web-app-capable` و راهنمای ۳ مرحله‌ای افزودن به هوم‌اسکرین Safari.

### ۳.۲. موتور ارتقای اتوماتیک بی‌صدا (Silent Over-The-Air Hot-Update)
- سرویس‌ورکر (`sw.js`) هر ۳۰ ثانیه یک‌بار تغییرات کد سورس را در پس‌زمینه پایش می‌کند.
- به محض انتشار کد جدید، نیازی به دانلود مجدد فایل APK یا IPA نیست؛ سرویس‌ورکر کد جدید را بی‌صدا کش کرده و برنامه خودکار بروزرسانی می‌شود.

---

## ۴. جدول مقایسه‌ای کمبودها، چالش‌ها و راهکارهای اجرایی

| مسیر توزیع | چالش‌ها و کمبودها | راهکار حل تخصصی |
| :--- | :--- | :--- |
| **Google Play (APK/AAB)** | ریجکت به دلیل تداخل versionCode در بیلدها | اسکریپت خودکار افزایش پله‌ای versionCode در `build.gradle.kts` |
| **Google Play (APK/AAB)** | سخت‌گیری درباره داده‌های سلامت و مانیفست | حذف دسترسی‌های غیرضروری و استفاده از Photo Picker صفر-مجوز |
| **Apple App Store (IPA)** | قانون 4.2 (حداقل پویایی نیتیو و ریجکت WebView) | تبدیل به Capacitor iOS با پشتیبانی FaceID و OPG Camera Native |
| **Apple App Store (IPA)** | هزینه اکانت سالانه اپل ($99) و تحریم‌ها | استفاده هم‌زمان از PWA مستقل برای کاربران آیفون بدون محدودیت |
| **PWA (وب‌اپلیکیشن)** | محدودیت‌های کش در Safari بعد از ۷ روز عدم استفاده | استفاده از IndexedDB و Sync اتوماتیک پایگاه داده Supabase |

---

## ۵. نتیجه‌گیری و نقشه راه انتشار

1. **فاز ۱ (هم‌اکنون فعال):** ارائه PWA و فایل APK اندروید با قابلیت ارتقای اتوماتیک کادربندی و versionCode خودکار.
2. **فاز ۲ (انتشار گوگل پلی):** خروجی گرفتن AAB و ثبت پرونده امنیتی داده‌های سلامت در Google Play Console.
3. **فاز ۳ (انتشار اپ‌استور):** خروجی IPA از طریق Capacitor و ارزیابی در TestFlight اپل.
