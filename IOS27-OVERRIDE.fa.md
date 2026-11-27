# سند معماری اجباری V2 / NATIVE iOS 27 — مینادنتال (`IOS27-OVERRIDE.fa.md`)

این سند به‌عنوان **الزام بالادستی** بر تمام مستندات و طراحی‌های قبلی رابط کاربری مینادنتال حاکم است و منطق درمان، پرونده بیماران، چارت پالمر، حسابداری، چک‌های صیادی، اقساط، سفته و گاوصندوق ضدحذف (Zero-Delete Vault) را بدون هیچ تغییر غیرضروری حفظ می‌کند.

## ۱. اصول بنیادین معماری صفحه اصلی (Viewport-Based & No-Scroll Home)
- **NO SCROLL HOME**: صفحه اصلی (`Dashboard`) در ابعاد متداول گوشی (`375×812` و `390×844`) با اندازه فونت پیش‌فرض تا حد امکان در ارتفاع نمایشگر جا بگیرد؛ هشدار فوری، متن بزرگ و ارتفاع محدود نباید باعث حذف محتوا شوند و اسکرول عمودی ایمن مجاز است.
- **استثنای دسترس‌پذیری و صفحات بسیار کوچک**: اسکرول عمودی داخلی در صفحه اصلی صرفاً در گوشی‌های بسیار کوتاه (`height < 660px`) یا هنگام فعال‌سازی حالت متن درشت / Dynamic Type (`large` / `xlarge`) مجاز است.
- **NO NESTED DASHBOARD**: هیچ ماژول، لیست طولانی یا زیرصفحه‌ای داخل داشبورد اصلی باز یا تعبیه نمی‌شود.
- **محتوای مجاز در صفحه اصلی (حداکثر موارد)**:
  1. **۴ شاخص حیاتی** (`kpi_pc_ratio`, `kpi_case_acceptance`, `kpi_chair_utilization`, `kpi_ar_status`).
  2. **حداکثر ۸ خدمت منتخب** (`QBankTile homeDense`، ۴+۴ با پیمایش افقی RTL و کنترل صفحه، تنظیم ترتیب با صفحه‌کلید و Drag & Drop و دکمه «بیشتر» برای خدمات مجاز).
  3. **۱ خلاصه هوشمند** (`dashboard_smart_summary`).
  4. **۱ اقدام اولویت‌دار** (`dashboard_priority_action`).
  5. **۱ نوبت بعدی** (`dashboard_next_appointment` — در صورت وجود فضای کافی عمودی در صفحه).

## ۲. ناوبری تمام‌صفحه و پشته بومی (Full-Screen Routing & Native Navigation Stack)
- **FULL-SCREEN ROUTING**: تمام بخش‌های اصلی، صفحه مستقل «همه خدمات و گزارش نوبت ۳ روزه» (`services`)، جزئیات پرونده‌ها و فرم‌های ثبت/ویرایش (`Sheet`) در موبایل به‌صورت تمام‌صفحه باز می‌شوند.
- **NATIVE NAVIGATION STACK**: حفظ وضعیت و موقعیت اسکرول هر مسیر در `navigationStack.ts`، دکمه بازگشت زمینه‌ای، پشتیبانی از `popstate` و پشتیبانی صحیح RTL.
- **RTL SWIPE BACK**: ژست کشیدن از لبه راست صفحه به سمت چپ در RTL برای بازگشت تعاملی در صفحات و شیت‌ها.

## ۳. موتور سراسری هپتیک و تأیید واقعی سرور (Global Haptic Engine & Server-Confirmed Success)
- پیاده‌سازی `HapticEngine` مرکزی با پنج الگوی استاندارد:
  - `selection`
  - `impact('light' | 'medium' | 'heavy')`
  - `success`
  - `warning`
  - `error`
- اتصال پل بومی اندروید (`AndroidHapticBridge`) به `View.performHapticFeedback` در `DentalCareWebView.kt`.
- **تضمین صداقت سرور**: عملیات حساس (ثبت بیمار، نوبت، درمان، لابراتوار، ایمپلنت، پرداخت، چک/قسط، پرسنل، تنظیمات و بکاپ) **فقط پس از تأیید واقعی سرور** (`verifyServerMutation(res)` بدون خطا و بدون وضعیت صف آفلاین `202`) مجاز به نمایش موفقیت کامل و اجرای `HapticEngine.success()` هستند. در حالت صف آفلاین (`queuedOffline`) فقط پیام هشدار صف و `HapticEngine.warning()` اجرا می‌شود.

## ۴. ژست‌ها و حرکت سیستم (Native Gestures & Motion)
- **Interactive Swipe Back**: بازگشت تعاملی از لبه راست در RTL.
- **Context Menu / Long Press**: منوی زمینه‌ای سریع با نگه داشتن انگشت یا راست‌کلیک روی کارت‌های خدمات، بیماران و نوبت‌ها (`ContextMenu.tsx`).
- **Swipe Actions**: ژست کشیدن افقی برای اقدام سریع در کشوی اعلان‌ها، یادآوری‌ها و کارت‌های نوبت.
- **Drag & Drop**: جابجایی و چیدمان حداکثر ۸ خدمت منتخب صفحه اصلی توسط کاربر.
- **Reduce Motion**: احترام به `prefers-reduced-motion` و تنظیم دستی کاهش انیمیشن در `appearanceEngine.ts`.

## ۵. ظاهر سیستم، تطبیق‌پذیری و صداقت پلتفرمی (Appearance, Adaptive Layout & Honest Capabilities)
- **System Appearance**: پشتیبانی واقعی از `Light`، `Dark`، `System`، مقیاس تایپوگرافی (`Dynamic Type`: `compact` / `default` / `large` / `xlarge`) و نواحی امن (`Safe Area` `env(safe-area-inset-*)`).
- **Adaptive Layout**: اولویت اول گوشی، نوار کناری جمع‌شونده در آیپد (`768px–1023px`) و سایدبار کامل در دسکتاپ/ویندوز (`≥1024px`).
- **Platform Capability Honesty**: گزارش دقیق و صادقانه امکانات واقعی محیط اجرا در `platformEngine.ts`:
  - در محیط وب/PWA و اندروید WebView، کنترل‌های بومی Apple SwiftUI/UIKit Liquid Glass (`nativeLiquidGlassAvailable = false`) و موتور سخت‌افزاری اپل CoreHaptics (`nativeCoreHapticsAvailable = false`) **در دسترس نیستند** و به‌عنوان قابلیت بومی اپل معرفی نمی‌شوند. نسخه بومی iOS 27 نیازمند ساخت پروژه SwiftUI/UIKit در Xcode روی macOS است.
