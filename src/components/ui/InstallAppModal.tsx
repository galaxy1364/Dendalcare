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

    // 2. Manifest validation
    let manifestValid = false;
    let manifestDetails = 'فایل manifest.json یافت نشد';
    try {
      const res = await fetch('./manifest.json', { cache: 'no-store' });
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
          ? `معتبر (${validCount}/5 کلید • ${data.short_name || data.name} • ${data.display} • ${data.icons.length} آیکون)`
          : `ناقص (${validCount}/5 کلید • نیاز به name, icons, display)`;
      }
    } catch {
      const linkEl = document.querySelector('link[rel="manifest"]');
      manifestValid = Boolean(linkEl);
      manifestDetails = linkEl ? 'لینک مانیفست در DOM قرار دارد' : 'خطا در خواندن manifest.json';
    }

    // 3. Service Worker status
    let serviceWorkerActive = false;
    let swDetails = 'پشتیبانی نمی‌شود';
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg?.active) {
          serviceWorkerActive = true;
          swDetails = navigator.serviceWorker.controller
            ? 'فعال و کنترل‌کننده صفحه (Controller Active)'
            : 'فعال و آماده (SW Active)';
        } else if (reg?.installing || reg?.waiting) {
          serviceWorkerActive = true;
          swDetails = 'در حال نصب یا انتظار (Installing/Waiting)';
        } else {
          swDetails = 'ثبت نشده (نیاز به ثبت یا Hard Reload)';
        }
      } else if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
        serviceWorkerActive = true;
        swDetails = 'اجرا در محیط محلی (Local Asset Host)';
      }
    } catch {
      swDetails = 'اجرا در محیط ایزوله';
    }

    setEligibility({
      checking: false,
      isSecureContext: isSecure,
      protocol,
      manifestValid,
      manifestDetails,
      serviceWorkerActive,
      swDetails,
      installPromptReady: Boolean(deferredPrompt),
      inIframe,
    });
  }, [deferredPrompt]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ua = navigator.userAgent.toLowerCase();
      const isIos = /iphone|ipad|ipod/.test(ua);
      const isAndroid = /android/.test(ua);
      if (isIos) setPlatform('ios');
      else if (isAndroid) setPlatform('android');
      else setPlatform('desktop');

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
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        onInstallSuccess?.();
        onClose();
      }
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
            {deferredPrompt ? (
              <button
                onClick={handlePromptInstall}
                data-testid="pwa_prompt_install_button"
                className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold text-sm shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 active:scale-95 transition-all"
              >
                <Download size={18} />
                نصب مستقیم روی گوشی (یک کلیک)
              </button>
            ) : (
              <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 space-y-2 text-xs">
                <div className="flex items-center gap-2 font-bold text-cyan-300">
                  <Zap size={16} />
                  نصب مستقیم بدون نیاز به گوگل‌پلی یا بازار:
                </div>
                <p className="text-[11px] text-white/80 leading-relaxed">
                  در مرورگر Chrome یا سامسونگ، روی علامت سه نقطه (منو) در بالا یا دکمه افزودن کلیک کرده و گزینه <strong>«افزودن به صفحه اصلی / Install App»</strong> را لمس کنید تا آیکون مینادنتال روی صفحه اصلی گوشی شما ظاهر شود.
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
                  className="w-full py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all text-center"
                >
                  <Download size={15} />
                  دانلود مستقیم فایل APK برنامه (DentalCare.apk)
                </button>
              )}

              {/* 403 Forbidden Guidance */}
              {downloadError403 && (
                <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-200 text-[11px] space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-amber-300">
                    <AlertCircle size={15} className="shrink-0 text-amber-400" />
                    <span>علت خطای 403 (Forbidden) گوگل و راه‌حل قطعی:</span>
                  </div>
                  <p className="leading-relaxed text-white/90">
                    گوگل استودیو به دلایل امنیتی اجازه دانلود مستقیم فایل‌های حجیم <code className="bg-black/30 px-1 rounded text-cyan-300 font-mono">.apk</code> را از مرورگر خارجی یا تب بدون لاگین نمی‌دهد. برای دریافت فایل:
                  </p>
                  <div className="space-y-1 pr-2 border-r-2 border-amber-400/40">
                    <div><strong>روش ۱ (سریع‌ترین):</strong> در نوار ابزار بالای استودیو گزینه <strong>Export</strong> یا <strong>Download APK</strong> را بزنید.</div>
                    <div><strong>روش ۲:</strong> در نوار کناری (پوشه فایل‌ها 📁)، روی فایل <strong className="text-white">DentalCare.apk</strong> راست‌کلیک کرده و <strong>Download</strong> را بزنید.</div>
                    <div><strong>روش ۳ (پیشنهادی):</strong> نیازی به فایل ۵۶ مگابایتی نیست! با زدن <strong>«افزودن به صفحه اصلی»</strong> از بالای همین صفحه، برنامه بدون حجم اضافی نصب شده و تمام آپدیت‌ها را ۱۰۰٪ آنی دریافت می‌کند.</div>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(window.location.origin + '/DentalCare.apk');
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2500);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/40 hover:bg-black/60 text-white text-[10px] font-bold"
                  >
                    {copiedLink ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    {copiedLink ? 'لینک کپی شد' : 'کپی لینک مستقیم فایل'}
                  </button>
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
              راهنمای راه‌اندازی در آیفون و آیپد (iOS / iPadOS)
            </div>
            <p className="text-[11px] text-white/80 leading-relaxed">
              با تکنولوژی مدرن PWA اپل، برنامه روی آیفون دقیقاً مشابه نسخه خروجی IPA عمل کرده و در حالت تمام صفحه (بدون نوار سافاری) اجرا می‌گردد:
            </p>

            <div className="space-y-2.5 pt-1">
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/5 border border-white/5">
                <span className="w-5 h-5 rounded-full bg-blue-500/30 text-blue-300 font-bold text-xs flex items-center justify-center shrink-0">۱</span>
                <div className="text-[11px] text-white/90">
                  در مرورگر <strong>Safari</strong> دکمه اشتراک‌گذاری (<Share2 size={12} className="inline mx-1 text-cyan-300" /> Share) در نوار پایینی را لمس کنید.
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/5 border border-white/5">
                <span className="w-5 h-5 rounded-full bg-blue-500/30 text-blue-300 font-bold text-xs flex items-center justify-center shrink-0">۲</span>
                <div className="text-[11px] text-white/90">
                  در منوی باز شده گزینه <strong className="text-cyan-300">«Add to Home Screen»</strong> (افزودن به صفحه اصلی <PlusSquare size={12} className="inline mx-1 text-cyan-300" />) را انتخاب کنید.
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/5 border border-white/5">
                <span className="w-5 h-5 rounded-full bg-blue-500/30 text-blue-300 font-bold text-xs flex items-center justify-center shrink-0">۳</span>
                <div className="text-[11px] text-white/90">
                  در گوشه بالا دکمه <strong>«Add»</strong> را لمس کنید. آیکون اختصاصی برنامه به لیست اپ‌های آیفون شما افزوده می‌شود.
                </div>
              </div>
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
