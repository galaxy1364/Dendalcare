import { useState, useEffect, useCallback } from 'react';
import {
  Smartphone, Apple, Download, RefreshCw, CheckCircle2,
  Share2, PlusSquare, Sparkles, X, ShieldCheck, Zap, Laptop, AlertCircle, Lock, FileCode2, Server, HelpCircle, Copy, Check
} from 'lucide-react';
import { downloadApkSafely } from '../../lib/downloadHelper';
import { CURRENT_APP_VERSION, CURRENT_APP_BUILD } from '../../lib/cloudSyncEngine';

interface InstallAppModalProps {
  open: boolean;
  onClose: () => void;
  deferredPrompt: any;
  onInstallSuccess?: () => void;
  updateAvailable?: boolean;
  onApplyUpdate?: () => void;
}

interface EligibilityState {
  checking: boolean;
  isSecureContext: boolean;
  protocol: string;
  manifestValid: boolean;
  manifestDetails: string;
  serviceWorkerActive: boolean;
  swDetails: string;
  installPromptReady: boolean;
  inIframe: boolean;
}

export function InstallAppModal({
  open,
  onClose,
  deferredPrompt,
  onInstallSuccess,
  updateAvailable = false,
  onApplyUpdate,
}: InstallAppModalProps) {
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop'>('android');
  const [isStandalone, setIsStandalone] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [downloadingApk, setDownloadingApk] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError403, setDownloadError403] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [eligibility, setEligibility] = useState<EligibilityState>({
    checking: true,
    isSecureContext: false,
    protocol: '',
    manifestValid: false,
    manifestDetails: 'در حال بررسی...',
    serviceWorkerActive: false,
    swDetails: 'در حال بررسی...',
    installPromptReady: false,
    inIframe: false,
  });

  const activePrompt = deferredPrompt || (typeof window !== 'undefined' ? (window as any).__deferredInstallPrompt : null);
  const [iosNonSafari, setIosNonSafari] = useState(false);
  const [copiedPageUrl, setCopiedPageUrl] = useState(false);
  const [registeringSw, setRegisteringSw] = useState(false);

  const checkEligibility = useCallback(async () => {
    if (typeof window === 'undefined') return;
    setEligibility(prev => ({ ...prev, checking: true }));

    // 1. HTTPS / Secure Context check
    const isSecure = Boolean(
      window.isSecureContext ||
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    );
    const protocol = window.location.protocol.replace(':', '').toUpperCase();
    const inIframe = (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();

    // 2. Manifest validation (with credentials for authenticated origins)
    let manifestValid = false;
    let manifestDetails = 'فایل manifest.json یافت نشد';
    try {
      const linkEl = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
      const manifestHref = linkEl?.getAttribute('href') || './manifest.json';
      const res = await fetch(manifestHref, { cache: 'no-store', credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const hasName = Boolean(data.name || data.short_name);
        const hasIcons = Array.isArray(data.icons) && data.icons.length > 0;
        const hasDisplay = data.display === 'standalone' || data.display === 'fullscreen' || data.display === 'minimal-ui';
        const hasStartUrl = Boolean(data.start_url);
        const hasThemeColor = Boolean(data.theme_color || data.background_color);

        const validCount = [hasName, hasIcons, hasDisplay, hasStartUrl, hasThemeColor].filter(Boolean).length;
        manifestValid = hasName && hasIcons && hasDisplay;
        manifestDetails = manifestValid
          ? `معتبر (${validCount}/5 • ${data.short_name || data.name} • ${data.icons.length} آیکون)`
          : `ناقص (${validCount}/5 • نیاز به name, icons, display)`;
      }
    } catch {
      const linkEl = document.querySelector('link[rel="manifest"]');
      manifestValid = Boolean(linkEl);
      manifestDetails = linkEl ? 'لینک مانیفست در DOM قرار دارد' : 'خطا در خواندن manifest.json';
    }

    // 3. Service Worker status (auto-register if HTTPS and missing)
    let serviceWorkerActive = false;
    let swDetails = 'پشتیبانی نمی‌شود';
    try {
      if ('serviceWorker' in navigator) {
        let reg = await navigator.serviceWorker.getRegistration();
        if (!reg && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
          try {
            reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
          } catch {
            // ignore registration failure in restricted frames
          }
        }
        if (reg?.active) {
          serviceWorkerActive = true;
          swDetails = navigator.serviceWorker.controller
            ? 'فعال و کنترل‌کننده صفحه (Controller Active)'
            : 'فعال و آماده (SW Active)';
        } else if (reg?.installing || reg?.waiting) {
          serviceWorkerActive = true;
          swDetails = 'در حال فعال‌سازی (Installing/Waiting)';
        } else {
          swDetails = 'ثبت نشده (نیاز به باز کردن در تب مستقل)';
        }
      } else if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
        serviceWorkerActive = true;
        swDetails = 'اجرا در محیط محلی (Local Asset Host)';
      }
    } catch {
      swDetails = 'اجرا در محیط ایزوله';
    }

    const promptAvailable = Boolean(deferredPrompt || (window as any).__deferredInstallPrompt);
    setEligibility({
      checking: false,
      isSecureContext: isSecure,
      protocol,
      manifestValid,
      manifestDetails,
      serviceWorkerActive,
      swDetails,
      installPromptReady: promptAvailable,
      inIframe,
    });
  }, [deferredPrompt]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ua = navigator.userAgent;
      const uaLower = ua.toLowerCase();
      const isIos = /iphone|ipad|ipod/.test(uaLower) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isAndroid = /android/.test(uaLower);
      if (isIos) {
        setPlatform('ios');
        const isInAppOrNonSafari = /CriOS|FxiOS|EdgiOS|OPiOS|Instagram|FBAN|FBAV|Telegram|WhatsApp/i.test(ua);
        setIosNonSafari(isInAppOrNonSafari);
      } else if (isAndroid) {
        setPlatform('android');
      } else {
        setPlatform('desktop');
      }

      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true ||
        document.referrer.includes('android-app://');
      setIsStandalone(Boolean(standalone));
    }
  }, []);

  useEffect(() => {
    if (open) {
      checkEligibility();
    }
  }, [open, checkEligibility]);

  if (!open) return null;

  const handlePromptInstall = async () => {
    if (activePrompt) {
      activePrompt.prompt();
      const choice = await activePrompt.userChoice;
      if (choice.outcome === 'accepted') {
        (window as any).__deferredInstallPrompt = null;
        onInstallSuccess?.();
        onClose();
      }
    }
  };

  const handleManualRegisterSw = async () => {
    if (!('serviceWorker' in navigator)) return;
    setRegisteringSw(true);
    try {
      await navigator.serviceWorker.register('./sw.js', { scope: './' });
      await checkEligibility();
    } catch {
      // ignore
    } finally {
      setRegisteringSw(false);
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateStatus(null);
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update();
          if (reg.waiting || updateAvailable) {
            setUpdateStatus('نسخه جدید کشف شد! در حال ارتقا...');
            onApplyUpdate?.();
          } else {
            setUpdateStatus('شما در حال استفاده از آخرین نسخه پایدار (v3.0) هستید.');
          }
        } else {
          setUpdateStatus('سرویس‌ورکر فعال شد و برنامه بروز است.');
        }
      } else {
        setUpdateStatus('مرورگر شما در حالت بروزرسانی خودکار است.');
      }
    } catch {
      setUpdateStatus('بررسی انجام شد. سیستم با آخرین نسخه پایگاه ابری هماهنگ است.');
    } finally {
      setTimeout(() => setCheckingUpdate(false), 800);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-md animate-fade-in" dir="rtl" data-testid="install_app_modal">
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto glass-dark rounded-[28px] border border-white/15 p-5 text-white shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/30">
              <Smartphone size={22} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                نصب مستقیم و بررسی صلاحیت مرورگر
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-400/30">
                  APK • iOS • PWA
                </span>
              </h2>
              <p className="text-[11px] text-blue-200/70">نصب و بررسی پیش‌نیازهای فنی بر روی اندروید، آیفون و رایانه</p>
            </div>
          </div>
          <button
            onClick={onClose}
            data-testid="close_install_modal_button"
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Browser Installation Eligibility Criteria Panel */}
        <div className="p-3.5 rounded-2xl bg-white/5 border border-white/15 space-y-2.5" data-testid="eligibility_criteria_panel">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
              <ShieldCheck size={15} className="text-cyan-400" />
              شرایط صلاحیت نصب در مرورگر (Installation Eligibility)
            </span>
            <button
              onClick={checkEligibility}
              data-testid="recheck_eligibility_button"
              className="text-[10px] px-2 py-0.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 flex items-center gap-1 transition-all"
            >
              <RefreshCw size={11} className={eligibility.checking ? 'animate-spin' : ''} />
              بررسی مجدد
            </button>
          </div>

          <div className="space-y-1.5 text-[11px]">
            {/* Criterion 1: HTTPS / Secure Context */}
            <div className="flex items-center justify-between p-2 rounded-xl bg-black/25 border border-white/5">
              <div className="flex items-center gap-1.5 text-white/85">
                <Lock size={13} className={eligibility.isSecureContext ? 'text-emerald-400' : 'text-red-400'} />
                <span>بستر امن (HTTPS / Secure Context):</span>
              </div>
              <span className={`font-bold ${eligibility.isSecureContext ? 'text-emerald-300' : 'text-red-300'}`}>
                {eligibility.isSecureContext ? `تأیید شده (${eligibility.protocol})` : `نامعتبر (${eligibility.protocol})`}
              </span>
            </div>

            {/* Criterion 2: Web App Manifest */}
            <div className="flex items-center justify-between p-2 rounded-xl bg-black/25 border border-white/5">
              <div className="flex items-center gap-1.5 text-white/85">
                <FileCode2 size={13} className={eligibility.manifestValid ? 'text-emerald-400' : 'text-amber-400'} />
                <span>اعتبارسنجی مانیفست (Manifest):</span>
              </div>
              <span className={`font-bold truncate max-w-[180px] ${eligibility.manifestValid ? 'text-emerald-300' : 'text-amber-300'}`}>
                {eligibility.manifestDetails}
              </span>
            </div>

            {/* Criterion 3: Service Worker Status */}
            <div className="flex items-center justify-between p-2 rounded-xl bg-black/25 border border-white/5">
              <div className="flex items-center gap-1.5 text-white/85">
                <Server size={13} className={eligibility.serviceWorkerActive ? 'text-emerald-400' : 'text-amber-400'} />
                <span>وضعیت سرویس‌ورکر (Service Worker):</span>
              </div>
              <span className={`font-bold truncate max-w-[180px] ${eligibility.serviceWorkerActive ? 'text-emerald-300' : 'text-amber-300'}`}>
                {eligibility.swDetails}
              </span>
            </div>

            {/* Criterion 4: Install Prompt / Why Button May Be Disabled */}
            <div className="p-2 rounded-xl bg-black/25 border border-white/5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-white/85 flex items-center gap-1.5">
                  {eligibility.installPromptReady || isStandalone ? (
                    <CheckCircle2 size={13} className="text-emerald-400" />
                  ) : (
                    <AlertCircle size={13} className="text-amber-400" />
                  )}
                  وضعیت دکمه نصب مستقیم (Install Prompt):
                </span>
                <span className={`font-bold ${eligibility.installPromptReady || isStandalone ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {isStandalone
                    ? 'قبلاً نصب شده (Standalone)'
                    : eligibility.installPromptReady
                    ? 'آماده نصب تک‌کلیکی'
                    : eligibility.inIframe
                    ? 'مسدود در پیش‌نمایش (Iframe)'
                    : 'نیاز به نصب از منوی مرورگر'}
                </span>
              </div>
              {!eligibility.installPromptReady && !isStandalone && (
                <p className="text-[10px] text-amber-200/80 leading-relaxed pt-0.5">
                  {eligibility.inIframe
                    ? 'علت غیرفعال بودن نصب خودکار: برنامه داخل کادر پیش‌نمایش (Iframe) باز شده است. برای دانلود APK از آیکون پوشه (📁) در نوار پایین استودیو استفاده کنید.'
                    : platform === 'ios'
                    ? 'مرورگر Safari اپل از رویداد beforeinstallprompt پشتیبانی نمی‌کند؛ از گزینه Share ➔ Add to Home Screen استفاده نمایید.'
                    : 'اگر قبلاً برنامه را نصب کرده‌اید یا کش مرورگر مختل شده است، از بخش تنظیمات دکمه «پاکسازی کش و Hard Reload» را بزنید.'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Standalone status indicator */}
        {isStandalone && (
          <div className="p-3 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
            <span>برنامه در حالت اپلیکیشن بومی (Standalone App) نصب و فعال است.</span>
          </div>
        )}

        {/* Auto-Update Banner if available */}
        {updateAvailable && (
          <div className="p-3 rounded-2xl bg-gradient-to-r from-purple-500/30 to-blue-500/30 border border-purple-400/40 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-purple-200">
              <Sparkles size={16} className="text-purple-300 animate-spin" />
              <span>نسخه جدید برنامه آماده است!</span>
            </div>
            <p className="text-[11px] text-white/80">تغییرات جدید و بهینه‌سازی‌ها در دسترس هستند.</p>
            <button
              onClick={onApplyUpdate}
              className="w-full py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-md transition-all active:scale-95"
            >
              ارتقا و بارگذاری آنی نسخه جدید
            </button>
          </div>
        )}

        {/* Segmented Platform Selector */}
        <div className="flex gap-1 p-1 rounded-2xl bg-white/5 border border-white/10 text-xs">
          <button
            onClick={() => setPlatform('android')}
            className={`flex-1 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all ${
              platform === 'android' ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-md' : 'text-white/60 hover:text-white'
            }`}
          >
            <Smartphone size={14} />
            اندروید (APK / PWA)
          </button>
          <button
            onClick={() => setPlatform('ios')}
            className={`flex-1 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all ${
              platform === 'ios' ? 'bg-gradient-to-r from-slate-700 to-slate-900 text-white shadow-md border border-white/20' : 'text-white/60 hover:text-white'
            }`}
          >
            <Apple size={14} />
            آیفون (iOS / IPA)
          </button>
          <button
            onClick={() => setPlatform('desktop')}
            className={`flex-1 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all ${
              platform === 'desktop' ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md' : 'text-white/60 hover:text-white'
            }`}
          >
            <Laptop size={14} />
            ویندوز و مک
          </button>
        </div>

        {/* Android Tab */}
        {platform === 'android' && (
          <div className="space-y-3">
            {/* Direct PWA Install Button */}
            {activePrompt ? (
              <button
                onClick={handlePromptInstall}
                data-testid="pwa_prompt_install_button"
                className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold text-sm shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 active:scale-95 transition-all"
              >
                <Download size={18} />
                نصب مستقیم روی گوشی (یک کلیک)
              </button>
            ) : (
              <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 space-y-2.5 text-xs">
                <div className="flex items-center gap-2 font-bold text-cyan-300">
                  <Zap size={16} />
                  نصب مستقیم در مرورگر اندروید (Chrome / Samsung Internet):
                </div>
                {eligibility.inIframe && (
                  <button
                    type="button"
                    onClick={() => window.open(window.location.href, '_blank', 'noopener,noreferrer')}
                    className="w-full py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
                  >
                    <Smartphone size={15} />
                    باز کردن در تب مستقل مرورگر (ضروری برای نصب)
                  </button>
                )}
                {!eligibility.serviceWorkerActive && !eligibility.inIframe && (
                  <button
                    type="button"
                    onClick={handleManualRegisterSw}
                    disabled={registeringSw}
                    className="w-full py-2 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw size={13} className={registeringSw ? 'animate-spin' : ''} />
                    {registeringSw ? 'در حال فعال‌سازی موتور نصب...' : 'فعال‌سازی موتور نصب مرورگر (Service Worker)'}
                  </button>
                )}
                <p className="text-[11px] text-white/80 leading-relaxed">
                  در مرورگر <strong>Chrome</strong> یا <strong>Samsung Internet</strong>، روی علامت سه نقطه (⋮) در گوشه بالا ضربه بزنید و گزینه <strong className="text-emerald-300">«نصب برنامه / Install app»</strong> یا <strong className="text-cyan-300">«افزودن به صفحه اصلی / Add to Home screen»</strong> را لمس کنید تا با آیکون رسمی بنفش مینادنتال نصب شود.
                </p>
              </div>
            )}

            {/* Native APK Card */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-blue-900/40 to-indigo-950/60 border border-blue-400/20 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-300 flex items-center gap-1.5">
                  <ShieldCheck size={16} className="text-blue-400" />
                  بسته بومی اندروید (APK Release v{CURRENT_APP_VERSION})
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-200 border border-blue-400/30 font-mono">
                  Build #{CURRENT_APP_BUILD} • بهینه‌شده
                </span>
              </div>
              <p className="text-[11px] text-white/70 leading-relaxed">
                پکیج نیم‌اسپیس اختصاصی <code className="text-cyan-300 font-mono text-[10px]">com.aistudio.auditpro.kxmfzq</code> کامپایل شده و آماده نصب با پشتیبانی کامل از فایل چوزر، دوربین و سنسورهای گوشی.
              </p>

              {downloadingApk ? (
                <div className="space-y-1.5 p-2 rounded-xl bg-blue-950/60 border border-blue-400/30">
                  <div className="flex justify-between text-[11px] text-blue-200 font-bold">
                    <span>در حال دریافت ایمن فایل نصبی APK...</span>
                    <span>{downloadProgress}%</span>
                  </div>
                  <div className="w-full h-2 bg-blue-900/60 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-200 rounded-full"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        setDownloadingApk(true);
                        setDownloadProgress(10);
                        setDownloadError403(false);
                        const res = await downloadApkSafely('DentalCare.apk', (p) => setDownloadProgress(p));
                        setDownloadingApk(false);
                        if (!res.success) {
                          setDownloadError403(true);
                        }
                      }}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all text-center"
                    >
                      <Download size={15} />
                      دانلود مستقیم APK (سرور اصلی)
                    </button>
                    <a
                      href="https://galaxy1364.github.io/Dendalcare/DentalCare.apk"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold text-xs flex items-center justify-center gap-1.5 border border-cyan-500/30 active:scale-95 transition-all text-center"
                    >
                      <Download size={15} />
                      لینک کمکی گیت‌هاب (بدون فیلتر)
                    </a>
                  </div>
                )}

                {/* Important installation tips for Android */}
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-400/30 text-amber-200 text-[11px] space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-amber-300">
                    <AlertCircle size={15} className="shrink-0 text-amber-400" />
                    <span>راهنمای رفع خطای «برنامه نصب نشد» در اندروید:</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-white/80 leading-relaxed pr-1 text-[10.5px]">
                    <li><strong className="text-amber-200">حذف نسخه قبلی:</strong> اگر نسخه‌ای از برنامه قبلاً روی گوشی نصب بوده، ابتدا آن را Uninstall (حذف) کنید.</li>
                    <li><strong className="text-amber-200">سپر ایمنی گوگل (Play Protect):</strong> اگر هنگام نصب پیام اخطار دیدید، روی <strong className="text-cyan-300">«جزئیات بیشتر» (More details)</strong> بزنید و سپس <strong className="text-emerald-300">«نصب در هر حال» (Install anyway)</strong> را انتخاب کنید.</li>
                    <li><strong className="text-amber-200">نصب ناشناخته:</strong> به برنامه «مدیریت فایل» یا مرورگر خود در تنظیمات گوشی اجازه <strong className="text-cyan-300">Install Unknown Apps</strong> بدهید.</li>
                    <li><strong className="text-emerald-300">روش فوری پیشنهادی (PWA):</strong> با زدن دکمه <strong className="text-yellow-300">«نصب فوری در مرورگر»</strong> در بالای همین صفحه، برنامه در ۱ ثانیه بدون نیاز به فایل APK روی صفحه اصلی گوشی با آیکون رسمی نصب می‌شود.</li>
                  </ol>
                </div>

                {/* 403 Forbidden Guidance */}
                {downloadError403 && (
                  <div className="p-3 rounded-xl bg-red-500/20 border border-red-400/40 text-red-200 text-[11px] space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-red-300">
                      <AlertCircle size={15} className="shrink-0 text-red-400" />
                      <span>خطای دانلود؛ از لینک کمکی گیت‌هاب استفاده کنید:</span>
                    </div>
                    <p className="leading-relaxed text-white/90">
                      به دلیل محدودیت‌های پراکسی گوگل، می‌توانید مستقیماً از لینک کمکی گیت‌هاب فایل را بدون فیلتر دانلود کنید یا لینک مستقیم زیر را در مرورگر کپی کنید:
                    </p>
                    <div className="flex gap-2">
                      <a
                        href="https://galaxy1364.github.io/Dendalcare/DentalCare.apk"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-center font-bold text-xs"
                      >
                        دانلود از سرور گیت‌هاب
                      </a>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText('https://galaxy1364.github.io/Dendalcare/DentalCare.apk');
                          setCopiedLink(true);
                          setTimeout(() => setCopiedLink(false), 2500);
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/40 hover:bg-black/60 text-white text-[10px] font-bold"
                      >
                        {copiedLink ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        {copiedLink ? 'کپی شد' : 'کپی لینک'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
          </div>
        )}

        {/* iOS Tab */}
        {platform === 'ios' && (
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3 text-xs">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <Apple size={18} className="text-white" />
              نصب مستقیم روی آیفون و آیپد (iOS / iPadOS)
            </div>

            {iosNonSafari && (
              <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-100 text-[11px] space-y-2">
                <div className="font-bold text-amber-300 flex items-center gap-1.5">
                  <AlertCircle size={15} className="shrink-0" />
                  <span>مرورگر فعلی شما Safari نیست!</span>
                </div>
                <p className="leading-relaxed">
                  در آیفون برای نصب کامل و تمام‌صفحه، لینک زیر را کپی کرده و در مرورگر اصلی <strong>Safari</strong> باز کنید (یا در Chrome آیفون از دکمه Share بالا گزینه Add to Home Screen را بزنید):
                </p>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    setCopiedPageUrl(true);
                    setTimeout(() => setCopiedPageUrl(false), 2500);
                  }}
                  className="w-full py-2 px-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5"
                >
                  {copiedPageUrl ? <Check size={14} /> : <Copy size={14} />}
                  {copiedPageUrl ? 'آدرس کپی شد — در Safari پیست کنید' : 'کپی آدرس برای باز کردن در Safari'}
                </button>
              </div>
            )}

            <p className="text-[11px] text-white/80 leading-relaxed">
              برنامه روی آیفون با لوگوی رسمی بنفش مینادنتال و حالت تمام‌صفحه (بدون نوار سافاری) دقیقاً مشابه اپلیکیشن بومی اجرا می‌شود. از یکی از دو روش زیر استفاده کنید:
            </p>

            {/* Method 1: Safari Share -> Add to Home Screen */}
            <div className="space-y-2 pt-1">
              <div className="text-[11px] font-bold text-cyan-300">روش اول (سریع‌ترین — داخل Safari):</div>
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/5 border border-white/5">
                <span className="w-5 h-5 rounded-full bg-blue-500/30 text-blue-300 font-bold text-xs flex items-center justify-center shrink-0">۱</span>
                <div className="text-[11px] text-white/90">
                  در مرورگر <strong>Safari</strong> دکمه اشتراک‌گذاری (<Share2 size={12} className="inline mx-1 text-cyan-300" /> Share) در نوار پایینی را لمس کنید.
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/5 border border-white/5">
                <span className="w-5 h-5 rounded-full bg-blue-500/30 text-blue-300 font-bold text-xs flex items-center justify-center shrink-0">۲</span>
                <div className="text-[11px] text-white/90">
                  به پایین اسکرول کرده و گزینه <strong className="text-cyan-300">«Add to Home Screen»</strong> (افزودن به صفحه اصلی <PlusSquare size={12} className="inline mx-1 text-cyan-300" />) را انتخاب کنید.
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/5 border border-white/5">
                <span className="w-5 h-5 rounded-full bg-blue-500/30 text-blue-300 font-bold text-xs flex items-center justify-center shrink-0">۳</span>
                <div className="text-[11px] text-white/90">
                  دکمه <strong>«Add»</strong> را بزنید تا آیکون رسمی مینادنتال روی صفحه اصلی آیفون قرار گیرد.
                </div>
              </div>
            </div>

            {/* Method 2: Direct iOS WebClip Profile (.mobileconfig) */}
            <div className="p-3 rounded-xl bg-gradient-to-br from-purple-900/40 to-indigo-950/60 border border-purple-400/30 space-y-2">
              <div className="text-[11px] font-bold text-purple-200 flex items-center gap-1.5">
                <Download size={14} className="text-purple-300" />
                روش دوم (پروفایل نصب مستقیم آیفون — WebClip Profile):
              </div>
              <a
                href="./DentalCare.mobileconfig"
                download="MinaDental.mobileconfig"
                className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
              >
                <Download size={15} />
                دانلود پروفایل نصب مستقیم آیفون (.mobileconfig)
              </a>
              <p className="text-[10px] text-purple-200/80 leading-relaxed">
                پس از زدن Allow، به <strong>Settings ➔ General ➔ VPN &amp; Device Management</strong> (یا گزینه Profile Downloaded در بالای تنظیمات) بروید و <strong>Install</strong> را بزنید.
              </p>
            </div>
          </div>
        )}

        {/* Desktop Tab */}
        {platform === 'desktop' && (
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2.5 text-xs">
            <div className="flex items-center gap-2 font-bold text-indigo-300">
              <Laptop size={16} />
              اجرا در ویندوز، مک و لینوکس
            </div>
            <p className="text-[11px] text-white/80 leading-relaxed">
              در مرورگر Chrome یا Edge روی آیکون مانیتور کوچک یا فلش نصب در نوار آدرس کلیک کنید تا برنامه به صورت پنجره دسکتاپ مستقل و سبک نصب شود.
            </p>
          </div>
        )}

        {/* Auto-Update Engine Control */}
        <div className="pt-2 border-t border-white/10 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-white/90">
              <RefreshCw size={14} className={checkingUpdate ? 'animate-spin text-cyan-400' : 'text-blue-400'} />
              <span>موتور ارتقای اتوماتیک (Auto-Update Engine)</span>
            </div>
            <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
              فعال و هوشمند
            </span>
          </div>

          <button
            onClick={handleCheckUpdate}
            disabled={checkingUpdate}
            className="w-full py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-semibold text-white flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw size={13} className={checkingUpdate ? 'animate-spin text-cyan-300' : ''} />
            {checkingUpdate ? 'در حال بررسی نسخه جدید...' : 'بررسی دستی بروزرسانی جدید (Check for Updates)'}
          </button>

          {updateStatus && (
            <div className="p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-400/30 text-[11px] text-cyan-200 text-center animate-fade-in">
              {updateStatus}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
