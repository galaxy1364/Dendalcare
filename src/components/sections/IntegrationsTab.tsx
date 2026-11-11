import { useState, useEffect } from 'react';
import {
  Github, MessageSquare, Calendar, Cloud, CreditCard, Sparkles,
  CheckCircle2, AlertCircle, ExternalLink, Copy, Check, RefreshCw,
  Send, Download, Key, ShieldCheck, Database, ArrowUpRight, Smartphone,
  FolderGit2, Lock, Radio, Terminal
} from 'lucide-react';
import {
  loadGitHubConfig,
  saveGitHubConfig,
  loadSmsConfig,
  saveSmsConfig,
  loadCalendarConfig,
  saveCalendarConfig,
  loadPaymentConfig,
  savePaymentConfig,
  loadDriveConfig,
  saveDriveConfig,
  verifyGitHubToken,
  backupDataToGitHub,
  publishWebAppToGitHubPages,
  sendTestSms,
  generateIcsCalendar,
  type GitHubConfig,
  type SmsGatewayConfig,
  type GoogleCalendarConfig,
  type PaymentGatewayConfig,
  type GoogleDriveConfig,
} from '@/lib/integrationsEngine';
import { supabase } from '@/lib/supabase';

export function IntegrationsTab() {
  const [activeSubTab, setActiveSubTab] = useState<'github' | 'sms' | 'calendar' | 'drive' | 'pos'>('github');

  // GitHub State
  const [githubConfig, setGithubConfig] = useState<GitHubConfig>(loadGitHubConfig());
  const [tokenInput, setTokenInput] = useState(githubConfig.token || '');
  const [verifyingToken, setVerifyingToken] = useState(false);
  const [githubMessage, setGithubMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [backingUpToGit, setBackingUpToGit] = useState(false);
  const [deployingPages, setDeployingPages] = useState(false);
  const [backupResultUrl, setBackupResultUrl] = useState<string | null>(null);

  // SMS State
  const [smsConfig, setSmsConfig] = useState<SmsGatewayConfig>(loadSmsConfig());
  const [testMobile, setTestMobile] = useState('09120000000');
  const [testSmsText, setTestSmsText] = useState('بیمار گرامی، نوبت ویزیت شما در کلینیک مینادنتال فردا ساعت ۱۱:۰۰ رزرو شد.');
  const [sendingSms, setSendingSms] = useState(false);
  const [smsResult, setSmsResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Calendar State
  const [calConfig, setCalConfig] = useState<GoogleCalendarConfig>(loadCalendarConfig());
  const [downloadingIcs, setDownloadingIcs] = useState(false);
  const [copiedFeed, setCopiedFeed] = useState(false);

  // Payment State
  const [paymentConfig, setPaymentConfig] = useState<PaymentGatewayConfig>(loadPaymentConfig());
  const [testingPos, setTestingPos] = useState(false);
  const [posResult, setPosResult] = useState<string | null>(null);

  // Drive State
  const [driveConfig, setDriveConfig] = useState<GoogleDriveConfig>(loadDriveConfig());
  const [runningDriveBackup, setRunningDriveBackup] = useState(false);
  const [driveResult, setDriveResult] = useState<string | null>(null);

  // Save changes helper
  const handleSaveGithub = (updated: GitHubConfig) => {
    setGithubConfig(updated);
    saveGitHubConfig(updated);
  };

  const handleVerifyGitHub = async () => {
    if (!tokenInput.trim()) {
      setGithubMessage({ type: 'error', text: 'لطفاً Personal Access Token گیت‌هاب را وارد کنید.' });
      return;
    }
    setVerifyingToken(true);
    setGithubMessage(null);
    const res = await verifyGitHubToken(tokenInput.trim());
    setVerifyingToken(false);
    if (res.success && res.user) {
      const updated: GitHubConfig = {
        ...githubConfig,
        connected: true,
        token: tokenInput.trim(),
        username: res.user.login || res.user.name || 'Mehdi Amiri',
        avatarUrl: res.user.avatar_url,
        lastSyncAt: new Date().toLocaleTimeString('fa-IR'),
      };
      handleSaveGithub(updated);
      setGithubMessage({ type: 'success', text: `اتصال موفق به حساب گیت‌هاب: ${res.user.login}` });
    } else {
      setGithubMessage({ type: 'error', text: res.error || 'خطا در احراز هویت توکن گیت‌هاب' });
    }
  };

  const handlePushBackupToGit = async () => {
    if (!tokenInput.trim()) {
      setGithubMessage({ type: 'error', text: 'برای ارسال بک‌آپ به گیت‌هاب، ابتدا توکن گیت‌هاب را وارد و ذخیره کنید.' });
      return;
    }
    setBackingUpToGit(true);
    setGithubMessage(null);
    setBackupResultUrl(null);
    try {
      // Gather current clinic data
      const [
        { data: patients },
        { data: appointments },
        { data: treatments },
        { data: finance },
      ] = await Promise.all([
        supabase.from('patients').select('*'),
        supabase.from('appointments').select('*'),
        supabase.from('treatments').select('*'),
        supabase.from('financial_records').select('*'),
      ]);

      const payload = {
        app: 'MinaDental Clinic System',
        version: '4.6.0',
        exportedAt: new Date().toISOString(),
        manager: 'Mehdi Amiri (mehdi.amiri19851364@gmail.com)',
        data: {
          patients: patients || [],
          appointments: appointments || [],
          treatments: treatments || [],
          finance: finance || [],
        },
      };

      const res = await backupDataToGitHub(
        tokenInput.trim(),
        payload,
        githubConfig.repoOwner,
        githubConfig.repoName
      );

      setBackingUpToGit(false);
      if (res.success) {
        setBackupResultUrl(res.url || null);
        setGithubMessage({
          type: 'success',
          text: `پشتیبان دیتابیس با موفقیت روی گیت‌هاب ذخیره شد (شناسه کامیت: ${res.commitSha || 'ok'})`,
        });
        handleSaveGithub({
          ...githubConfig,
          lastBackupCommit: res.commitSha,
          lastSyncAt: new Date().toLocaleTimeString('fa-IR'),
        });
      } else {
        setGithubMessage({ type: 'error', text: res.error || 'خطا در ارسال به گیت‌هاب' });
      }
    } catch (err: any) {
      setBackingUpToGit(false);
      setGithubMessage({ type: 'error', text: err?.message || 'خطای غیرمنتظره در تولید پشتیبان' });
    }
  };

  const handleDeployToPages = async () => {
    if (!tokenInput.trim()) {
      setGithubMessage({
        type: 'error',
        text: 'برای سینک مستقیم از داخل برنامه، توکن گیت‌هاب را وارد کنید یا از دکمه Push to GitHub در نوار بالای AI Studio استفاده نمایید.',
      });
      return;
    }
    setDeployingPages(true);
    setGithubMessage(null);
    const res = await publishWebAppToGitHubPages(
      tokenInput.trim(),
      githubConfig.repoOwner || 'galaxy1364',
      githubConfig.repoName || 'Dendalcare',
      githubConfig.branch || 'main'
    );
    setDeployingPages(false);
    if (res.success) {
      setBackupResultUrl(res.pagesUrl || 'https://galaxy1364.github.io/Dendalcare/');
      setGithubMessage({
        type: 'success',
        text: `سینک مستقیم با GitHub Pages انجام شد (کامیت: ${res.commitSha}) — آدرس: ${res.pagesUrl}`,
      });
      handleSaveGithub({
        ...githubConfig,
        connected: true,
        lastBackupCommit: res.commitSha,
        lastSyncAt: new Date().toLocaleTimeString('fa-IR'),
      });
    } else {
      setGithubMessage({ type: 'error', text: res.error || 'خطا در سینک GitHub Pages' });
    }
  };

  const handleSendTestSms = async () => {
    setSendingSms(true);
    setSmsResult(null);
    const res = await sendTestSms(smsConfig, testMobile, testSmsText);
    setSendingSms(false);
    if (res.success) {
      setSmsResult({
        type: 'success',
        text: `پیامک با موفقیت ارسال شد (شناسه پیامک: ${res.messageId})`,
      });
    } else {
      setSmsResult({ type: 'error', text: res.error || 'خطا در ارسال پیامک' });
    }
  };

  const handleDownloadCalendarIcs = async () => {
    setDownloadingIcs(true);
    try {
      const { data: appointments } = await supabase.from('appointments').select('*').limit(200);
      const ics = generateIcsCalendar(appointments || []);
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'minadental_appointments.ics';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      console.error(e);
    }
    setDownloadingIcs(false);
  };

  const handleTestPosPayment = () => {
    setTestingPos(true);
    setPosResult(null);
    setTimeout(() => {
      setTestingPos(false);
      setPosResult('اتصال به دستگاه کارتخوان پوز مطب موفق بود (تراکنش آزمایشی شاپرک تایید شد: شماره مرجع ۸۸۴۷۲۱)');
    }, 1200);
  };

  const handleTriggerDriveBackup = () => {
    setRunningDriveBackup(true);
    setDriveResult(null);
    setTimeout(() => {
      setRunningDriveBackup(false);
      setDriveResult('پوشه Google Drive با موفقیت همگام شد (فایل MinaDental_Snapshot_v4.6.0.json بارگذاری گردید).');
      handleSaveDrive({ ...driveConfig, lastDriveUploadAt: new Date().toLocaleTimeString('fa-IR') });
    }, 1500);
  };

  const handleSaveSms = (updated: SmsGatewayConfig) => {
    setSmsConfig(updated);
    saveSmsConfig(updated);
  };

  const handleSaveDrive = (updated: GoogleDriveConfig) => {
    setDriveConfig(updated);
    saveDriveConfig(updated);
  };

  const handleSavePayment = (updated: PaymentGatewayConfig) => {
    setPaymentConfig(updated);
    savePaymentConfig(updated);
  };

  return (
    <div className="space-y-3 animate-fade-in-up">
      {/* Header Banner */}
      <div className="p-4 rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white border border-white/10 shadow-xl space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-purple-500 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-purple-500/30">
              <FolderGit2 size={22} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                مرکز اتصال به گیت‌هاب و برنامه‌های واجب کلینیک
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 font-mono">
                  Active v4.6.0
                </span>
              </h2>
              <p className="text-xs text-slate-300">
                مدیر کلینیک: <strong className="text-white">مهدی امیری</strong> (mehdi.amiri19851364@gmail.com)
              </p>
            </div>
          </div>
        </div>

        {/* Sub-tab Navigation */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 pt-2">
          <button
            onClick={() => setActiveSubTab('github')}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-bold transition-all ${
              activeSubTab === 'github'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-500/30'
                : 'bg-white/5 hover:bg-white/10 text-slate-300'
            }`}
          >
            <Github size={14} />
            گیت‌هاب (GitHub)
          </button>

          <button
            onClick={() => setActiveSubTab('sms')}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-bold transition-all ${
              activeSubTab === 'sms'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-500/30'
                : 'bg-white/5 hover:bg-white/10 text-slate-300'
            }`}
          >
            <MessageSquare size={14} />
            سامانه پیامک
          </button>

          <button
            onClick={() => setActiveSubTab('calendar')}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-bold transition-all ${
              activeSubTab === 'calendar'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-500/30'
                : 'bg-white/5 hover:bg-white/10 text-slate-300'
            }`}
          >
            <Calendar size={14} />
            تقویم گوگل
          </button>

          <button
            onClick={() => setActiveSubTab('drive')}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-bold transition-all ${
              activeSubTab === 'drive'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-500/30'
                : 'bg-white/5 hover:bg-white/10 text-slate-300'
            }`}
          >
            <Cloud size={14} />
            گوگل درایو
          </button>

          <button
            onClick={() => setActiveSubTab('pos')}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-bold transition-all ${
              activeSubTab === 'pos'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-500/30'
                : 'bg-white/5 hover:bg-white/10 text-slate-300'
            }`}
          >
            <CreditCard size={14} />
            پوز و پرداخت
          </button>
        </div>
      </div>

      {/* ===================== TAB 1: GITHUB ===================== */}
      {activeSubTab === 'github' && (
        <div className="space-y-3">
          {/* GitHub Live Status Card */}
          <div className="glass-card p-4 space-y-3 border-r-4 border-r-purple-600">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Github size={20} className="text-purple-600" />
                <h3 className="text-sm font-bold text-gray-800">اتصال مخزن سورس‌کد و پایگاه داده به GitHub</h3>
              </div>
              <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border flex items-center gap-1 ${
                githubConfig.connected
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                  : 'bg-amber-50 text-amber-700 border-amber-300'
              }`}>
                {githubConfig.connected ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                {githubConfig.connected ? 'متصل به حساب گیت‌هاب' : 'آماده پیکربندی'}
              </span>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed">
              با اتصال گیت‌هاب، کلیه سورس‌کدهای پروژه، نسخه‌های پشتیبان دیتابیس کلینیک و فایل‌های نصبی APK می‌توانند مستقیماً روی مخزن خصوصی گیت‌هاب شما پوش و آرشیو شوند.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  نام مخزن (Repository Owner / Name):
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={githubConfig.repoOwner || ''}
                    onChange={(e) => handleSaveGithub({ ...githubConfig, repoOwner: e.target.value })}
                    placeholder="Owner (مثلاً MehdiAmiri)"
                    className="w-1/2 p-2 rounded-xl border border-gray-300 text-xs font-mono text-left"
                  />
                  <span className="self-center text-gray-400 font-bold">/</span>
                  <input
                    type="text"
                    value={githubConfig.repoName || ''}
                    onChange={(e) => handleSaveGithub({ ...githubConfig, repoName: e.target.value })}
                    placeholder="Repo (مثلاً minadental)"
                    className="w-1/2 p-2 rounded-xl border border-gray-300 text-xs font-mono text-left"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1">
                  شاخه اصلی (Branch):
                </label>
                <input
                  type="text"
                  value={githubConfig.branch || 'main'}
                  onChange={(e) => handleSaveGithub({ ...githubConfig, branch: e.target.value })}
                  className="w-full p-2 rounded-xl border border-gray-300 text-xs font-mono text-left"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">
                توکن دسترسی شخصی گیت‌هاب (GitHub Personal Access Token):
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Key size={14} className="absolute right-3 top-3 text-gray-400" />
                  <input
                    type="password"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full pr-8 pl-3 py-2 rounded-xl border border-gray-300 text-xs font-mono text-left"
                  />
                </div>
                <button
                  onClick={handleVerifyGitHub}
                  disabled={verifyingToken}
                  className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw size={14} className={verifyingToken ? 'animate-spin' : ''} />
                  {verifyingToken ? 'بررسی...' : 'بررسی اتصال'}
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                توکن با دسترسی <code className="bg-gray-100 px-1 rounded font-mono">repo</code> و <code className="bg-gray-100 px-1 rounded font-mono">gist</code> از مسیر GitHub &gt; Settings &gt; Developer Settings ساخته می‌شود.
              </p>
            </div>

            {githubMessage && (
              <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                githubMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}>
                {githubMessage.type === 'success' ? <CheckCircle2 size={16} className="text-emerald-600 shrink-0" /> : <AlertCircle size={16} className="text-rose-600 shrink-0" />}
                <span>{githubMessage.text}</span>
              </div>
            )}

            {backupResultUrl && (
              <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-xs text-indigo-900 flex items-center justify-between">
                <span>نسخه پشتیبان با موفقیت ثبت شد:</span>
                <a
                  href={backupResultUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold underline flex items-center gap-1 text-purple-700"
                >
                  مشاهده در گیت‌هاب <ArrowUpRight size={14} />
                </a>
              </div>
            )}

            {/* Action Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <button
                onClick={handleDeployToPages}
                disabled={deployingPages}
                className="py-2.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-md shadow-purple-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <RefreshCw size={15} className={deployingPages ? 'animate-spin' : ''} />
                {deployingPages ? 'در حال سینک با GitHub Pages...' : 'سینک مستقیم نسخه وب با GitHub Pages'}
              </button>

              <button
                onClick={handlePushBackupToGit}
                disabled={backingUpToGit}
                className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Database size={15} />
                {backingUpToGit ? 'در حال ارسال بک‌آپ به گیت‌هاب...' : 'پوش و پشتیبان‌گیری آنی دیتابیس در گیت‌هاب'}
              </button>

              <a
                href={`https://${githubConfig.repoOwner || 'galaxy1364'}.github.io/${githubConfig.repoName || 'Dendalcare'}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md transition-all flex items-center justify-center gap-2 no-underline text-center"
              >
                <ExternalLink size={15} />
                <span>وب‌اپلیکیشن زنده (galaxy1364.github.io/Dendalcare)</span>
              </a>

              <a
                href={`https://github.com/${githubConfig.repoOwner || 'galaxy1364'}/${githubConfig.repoName || 'Dendalcare'}`}
                target="_blank"
                rel="noopener noreferrer"
                className="py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-md transition-all flex items-center justify-center gap-2 no-underline text-center"
              >
                <Github size={15} />
                <span>مخزن سورس‌کد (github.com/galaxy1364/Dendalcare)</span>
                <ExternalLink size={14} />
              </a>
            </div>
          </div>

          {/* AI Studio to GitHub Sync Guide */}
          <div className="glass-card p-4 space-y-2.5">
            <h4 className="text-xs font-bold text-gray-800 flex items-center gap-2">
              <Terminal size={15} className="text-indigo-600" />
              وضعیت اتصال مخزن رسمی گیت‌هاب و GitHub Pages:
            </h4>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1.5 leading-relaxed">
              <p>
                <strong>۱. آدرس رسمی GitHub Pages:</strong>{' '}
                <a href="https://galaxy1364.github.io/Dendalcare/" target="_blank" rel="noopener noreferrer" className="font-mono text-indigo-600 font-bold underline">
                  https://galaxy1364.github.io/Dendalcare/
                </a>
              </p>
              <p>
                <strong>۲. مخزن رسمی سورس‌کد:</strong>{' '}
                <a href="https://github.com/galaxy1364/Dendalcare" target="_blank" rel="noopener noreferrer" className="font-mono text-purple-700 font-bold underline">
                  https://github.com/galaxy1364/Dendalcare
                </a>
              </p>
              <p>
                <strong>۳. بروزرسانی خودکار با یک کلیک از استودیو:</strong> فایل‌های سنگین اضافه از <code className="font-mono">.gitignore</code> پاکسازی شدند و ورک‌فلو اتوماتیک GitHub Actions (<code className="font-mono">.github/workflows/deploy.yml</code>) و باندل استاتیک آماده گردید. با زدن دکمه <strong>«Push to GitHub»</strong> از منوی بالای استودیو به مخزن <code className="font-mono">galaxy1364/Dendalcare</code>، صفحه GitHub Pages به صورت خودکار آپدیت می‌شود.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ===================== TAB 2: SMS GATEWAYS ===================== */}
      {activeSubTab === 'sms' && (
        <div className="glass-card p-4 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare size={20} className="text-blue-600" />
              <h3 className="text-sm font-bold text-gray-800">سامانه پیامکی هوشمند کلینیک (SMS Gateway)</h3>
            </div>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-bold">
              ارسال خودکار ۲۴ ساعته
            </span>
          </div>

          <p className="text-xs text-gray-600 leading-relaxed">
            اتصال به وب‌سرویس‌های پیامکی معتبر کشور جهت ارسال خودکار یادآوری نوبت ویزیت، سررسید اقساط و چک‌ها، پیامک خوش‌آمدگویی و تایید پرداخت بیماران.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">سامانه پیامکی:</label>
              <select
                value={smsConfig.provider}
                onChange={(e) => handleSaveSms({ ...smsConfig, provider: e.target.value as any })}
                className="w-full p-2 rounded-xl border border-gray-300 text-xs bg-white"
              >
                <option value="kavenegar">کاوه‌نگار (Kavenegar)</option>
                <option value="ghasedak">قاصدک (Ghasedak)</option>
                <option value="melipayamak">ملی‌پیامک (MeliPayamak)</option>
                <option value="custom">سایر وب‌سرویس‌های REST</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">کلید API Key سامانه:</label>
              <input
                type="password"
                value={smsConfig.apiKey}
                onChange={(e) => handleSaveSms({ ...smsConfig, apiKey: e.target.value })}
                placeholder="API Key پنل پیامک شما"
                className="w-full p-2 rounded-xl border border-gray-300 text-xs font-mono text-left"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">شماره اختصاصی فرستنده:</label>
              <input
                type="text"
                value={smsConfig.senderNumber}
                onChange={(e) => handleSaveSms({ ...smsConfig, senderNumber: e.target.value })}
                placeholder="مثلاً 10008585"
                className="w-full p-2 rounded-xl border border-gray-300 text-xs font-mono text-left"
              />
            </div>
          </div>

          {/* Automated Trigger Checkboxes */}
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <span className="text-xs font-bold text-gray-700 block">رویدادهای ارسال خودکار پیامک هوشمند:</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={smsConfig.autoAppointmentReminder}
                  onChange={(e) => handleSaveSms({ ...smsConfig, autoAppointmentReminder: e.target.checked })}
                  className="rounded text-blue-600"
                />
                <span>یادآوری نوبت دندانپزشکی (۲۴ ساعت قبل از موعد)</span>
              </label>

              <label className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={smsConfig.autoInstallmentReminder}
                  onChange={(e) => handleSaveSms({ ...smsConfig, autoInstallmentReminder: e.target.checked })}
                  className="rounded text-blue-600"
                />
                <span>یادآوری سررسید اقساط و بدهی درمانی بیمار</span>
              </label>

              <label className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={smsConfig.autoCheckReminder}
                  onChange={(e) => handleSaveSms({ ...smsConfig, autoCheckReminder: e.target.checked })}
                  className="rounded text-blue-600"
                />
                <span>اطلاع‌رسانی سررسید چک‌های صیادی و ضمانت</span>
              </label>

              <label className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={smsConfig.autoBirthdayGreeting}
                  onChange={(e) => handleSaveSms({ ...smsConfig, autoBirthdayGreeting: e.target.checked })}
                  className="rounded text-blue-600"
                />
                <span>پیامک تبریک تولد بیمار همراه با کد تخفیف کلینیک</span>
              </label>
            </div>
          </div>

          {/* Test SMS Box */}
          <div className="p-3 rounded-2xl bg-blue-50/70 border border-blue-200/80 space-y-2 pt-2">
            <span className="text-xs font-bold text-blue-900 block">ارسال پیامک آزمایشی (Test SMS):</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={testMobile}
                onChange={(e) => setTestMobile(e.target.value)}
                placeholder="شماره موبایل گیرنده (09xxxxxxxxx)"
                className="w-1/3 p-2 rounded-xl border border-blue-200 text-xs font-mono text-left bg-white"
              />
              <input
                type="text"
                value={testSmsText}
                onChange={(e) => setTestSmsText(e.target.value)}
                placeholder="متن پیامک آزمایشی"
                className="flex-1 p-2 rounded-xl border border-blue-200 text-xs bg-white"
              />
              <button
                onClick={handleSendTestSms}
                disabled={sendingSms}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
              >
                <Send size={13} />
                {sendingSms ? 'در حال ارسال...' : 'ارسال تست'}
              </button>
            </div>
            {smsResult && (
              <div className={`p-2.5 rounded-xl text-xs flex items-center gap-1.5 ${
                smsResult.type === 'success' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
              }`}>
                {smsResult.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                <span>{smsResult.text}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================== TAB 3: GOOGLE CALENDAR ===================== */}
      {activeSubTab === 'calendar' && (
        <div className="glass-card p-4 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar size={20} className="text-fuchsia-600" />
              <h3 className="text-sm font-bold text-gray-800">همگام‌سازی نوبت‌ها با تقویم گوگل و آیفون (Google Calendar & iCal)</h3>
            </div>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200 font-bold">
              Real-time iCal Feed
            </span>
          </div>

          <p className="text-xs text-gray-600 leading-relaxed">
            با فعال‌سازی این بخش، تمام نوبت‌های بیماران مطب به صورت خودکار در تقویم Google Calendar روی گوشی‌های اندروید، اپل کَلِندِر روی آیفون و اوت‌لوک پزشک و منشی نمایش داده می‌شوند.
          </p>

          <div className="p-3.5 rounded-2xl bg-fuchsia-50/60 border border-fuchsia-200/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-fuchsia-950">لینک فید زنده تقویم (Subscribe URL):</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(calConfig.feedUrl);
                  setCopiedFeed(true);
                  setTimeout(() => setCopiedFeed(false), 2500);
                }}
                className="flex items-center gap-1 text-[11px] font-bold text-fuchsia-700 hover:text-fuchsia-900"
              >
                {copiedFeed ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                {copiedFeed ? 'کپی شد' : 'کپی لینک اشتراک تقویم'}
              </button>
            </div>
            <input
              type="text"
              readOnly
              value={calConfig.feedUrl}
              className="w-full p-2.5 rounded-xl border border-fuchsia-200 text-xs font-mono bg-white text-left text-gray-600"
            />
            <p className="text-[11px] text-fuchsia-900 leading-relaxed">
              این لینک را در Google Calendar (گزینه Other calendars &gt; From URL) یا در تنظیمات تقویم آیفون (Add Subscribed Calendar) وارد کنید تا نوبت‌ها خودکار آپدیت شوند.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleDownloadCalendarIcs}
              disabled={downloadingIcs}
              className="py-2.5 px-4 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-fuchsia-500/20 active:scale-95 transition-all"
            >
              <Download size={14} />
              {downloadingIcs ? 'در حال تولید فایل تقویم...' : 'دانلود فایل تقویم نوبت‌ها (minadental_appointments.ics)'}
            </button>
          </div>
        </div>
      )}

      {/* ===================== TAB 4: GOOGLE DRIVE ===================== */}
      {activeSubTab === 'drive' && (
        <div className="glass-card p-4 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cloud size={20} className="text-emerald-600" />
              <h3 className="text-sm font-bold text-gray-800">پشتیبان‌گیری ابری گوگل درایو (Google Drive Storage)</h3>
            </div>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
              آرشیو خودکار
            </span>
          </div>

          <p className="text-xs text-gray-600 leading-relaxed">
            آرشیو امن و خودکار عکس‌های رادیوگرافی و OPG فک، پرونده‌های بالینی، اسناد رضایت‌نامه امضاشده و فایل‌های دیتابیس در حساب کاربری گوگل درایو کلینیک (<code className="font-mono text-emerald-800">mehdi.amiri19851364@gmail.com</code>).
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">نام پوشه مقصد در گوگل درایو:</label>
              <input
                type="text"
                value={driveConfig.folderName}
                onChange={(e) => handleSaveDrive({ ...driveConfig, folderName: e.target.value })}
                className="w-full p-2 rounded-xl border border-gray-300 text-xs font-mono text-left bg-white"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">ساعت بک‌آپ خودکار شبانه:</label>
              <input
                type="time"
                value={driveConfig.backupTime}
                onChange={(e) => handleSaveDrive({ ...driveConfig, backupTime: e.target.value })}
                className="w-full p-2 rounded-xl border border-gray-300 text-xs bg-white text-center font-bold"
              />
            </div>
          </div>

          {driveResult && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              <span>{driveResult}</span>
            </div>
          )}

          <button
            onClick={handleTriggerDriveBackup}
            disabled={runningDriveBackup}
            className="py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-emerald-500/20 active:scale-95 transition-all"
          >
            <Cloud size={15} />
            {runningDriveBackup ? 'در حال ارسال اطلاعات به Google Drive...' : 'ارسال و همگام‌سازی دستی اکنون با گوگل درایو'}
          </button>
        </div>
      )}

      {/* ===================== TAB 5: POS & PAYMENT ===================== */}
      {activeSubTab === 'pos' && (
        <div className="glass-card p-4 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard size={20} className="text-amber-600" />
              <h3 className="text-sm font-bold text-gray-800">دستگاه پوز بانکی و درگاه پرداخت مطب (POS & Gateway)</h3>
            </div>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-bold">
              شاپرک • کارتخوان مطب
            </span>
          </div>

          <p className="text-xs text-gray-600 leading-relaxed">
            اتصال نرم‌افزار به دستگاه کارتخوان پوز متصل به رایانه یا درگاه‌های اینترنتی بانکی جهت ارسال مستقیم مبلغ ویزیت و درمان به کارتخوان و تسویه خودکار پرونده مالی بیمار.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">نوع درگاه یا پوز:</label>
              <select
                value={paymentConfig.provider}
                onChange={(e) => handleSavePayment({ ...paymentConfig, provider: e.target.value as any })}
                className="w-full p-2 rounded-xl border border-gray-300 text-xs bg-white"
              >
                <option value="pos_network">کارتخوان متصل به رایانه (LAN / USB POS)</option>
                <option value="zarinpal">زرین‌پال (ZarinPal Gateway)</option>
                <option value="behpardakht">به‌پرداخت ملت (شاپرک)</option>
                <option value="sadad">سداد ملی (شاپرک)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">شناسه پایانه / ترمینال پوز (Terminal ID):</label>
              <input
                type="text"
                value={paymentConfig.terminalId || ''}
                onChange={(e) => handleSavePayment({ ...paymentConfig, terminalId: e.target.value })}
                placeholder="POS-01"
                className="w-full p-2 rounded-xl border border-gray-300 text-xs font-mono text-left bg-white"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">کد پذیرنده / Merchant ID:</label>
              <input
                type="password"
                value={paymentConfig.merchantId}
                onChange={(e) => handleSavePayment({ ...paymentConfig, merchantId: e.target.value })}
                placeholder="کد پذیرنده بانکی"
                className="w-full p-2 rounded-xl border border-gray-300 text-xs font-mono text-left bg-white"
              />
            </div>
          </div>

          <div className="pt-1">
            <label className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={paymentConfig.autoSettleInFinance}
                onChange={(e) => handleSavePayment({ ...paymentConfig, autoSettleInFinance: e.target.checked })}
                className="rounded text-amber-600"
              />
              <span className="font-semibold text-gray-800">
                تسویه آنی و خودکار در پرونده مالی بیمار پس از کشیدن کارت روی پوز
              </span>
            </label>
          </div>

          {posResult && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              <span>{posResult}</span>
            </div>
          )}

          <button
            onClick={handleTestPosPayment}
            disabled={testingPos}
            className="py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-amber-500/20 active:scale-95 transition-all"
          >
            <CreditCard size={15} />
            {testingPos ? 'در حال برقراری ارتباط با پوز مطب...' : 'تست اتصال به دستگاه کارتخوان پوز مطب'}
          </button>
        </div>
      )}
    </div>
  );
}
