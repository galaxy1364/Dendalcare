import type {
  PinnedPublicKey,
  SafePointBlocker,
  SafePointEvaluation,
  UpdateErrorCode,
  UpdateState,
} from './contracts';

/**
 * Authoritative V7/V8 Update State Transition Table.
 * Every transition in UpdateCoordinator is checked against this table so invalid
 * transitions (e.g., CHECKING -> INSTALLED without activation & boot verification)
 * are mathematically impossible.
 */
export const ALLOWED_UPDATE_TRANSITIONS: Record<UpdateState, readonly UpdateState[]> = {
  IDLE: ['CHECKING', 'BOOT_VERIFYING', 'OFFLINE', 'NATIVE_STORE_REQUIRED'],
  CHECKING: ['UP_TO_DATE', 'AVAILABLE', 'CHECK_FAILED', 'OFFLINE', 'NATIVE_STORE_REQUIRED'],
  UP_TO_DATE: ['CHECKING', 'OFFLINE', 'IDLE'],
  AVAILABLE: [
    'DOWNLOADING',
    'CHECKING',
    'OFFLINE',
    'NATIVE_STORE_REQUIRED',
    'FAILED',
    'UP_TO_DATE',
  ],
  CHECK_FAILED: ['CHECKING', 'OFFLINE', 'IDLE'],
  OFFLINE: ['CHECKING', 'IDLE'],
  DOWNLOADING: ['VERIFYING', 'FAILED', 'OFFLINE'],
  VERIFYING: ['READY_TO_ACTIVATE', 'WAITING_FOR_SAFE_POINT', 'FAILED', 'OFFLINE'],
  READY_TO_ACTIVATE: ['WAITING_FOR_SAFE_POINT', 'ACTIVATING', 'FAILED', 'CHECKING'],
  WAITING_FOR_SAFE_POINT: ['ACTIVATING', 'READY_TO_ACTIVATE', 'CHECKING', 'FAILED'],
  ACTIVATING: ['BOOT_VERIFYING', 'FAILED', 'ROLLBACK_PENDING'],
  BOOT_VERIFYING: ['INSTALLED', 'FAILED', 'ROLLBACK_PENDING'],
  INSTALLED: ['CHECKING', 'UP_TO_DATE', 'IDLE'],
  FAILED: ['CHECKING', 'DOWNLOADING', 'ROLLBACK_PENDING', 'IDLE', 'OFFLINE'],
  ROLLBACK_PENDING: ['ROLLED_BACK', 'FAILED', 'CHECKING'],
  ROLLED_BACK: ['CHECKING', 'IDLE'],
  NATIVE_STORE_REQUIRED: ['CHECKING', 'IDLE'],
};

export function canTransitionUpdateState(from: UpdateState, to: UpdateState): boolean {
  if (from === to) return true;
  return ALLOWED_UPDATE_TRANSITIONS[from].includes(to);
}

export const UPDATE_TIMING_POLICY = {
  /** Default foreground polling interval: 5 minutes */
  DEFAULT_POLL_INTERVAL_MS: 5 * 60 * 1000,
  /** Maximum jitter added to polling interval: up to 30 seconds */
  POLL_JITTER_MAX_MS: 30 * 1000,
  /** Minimum debounce between automatic discovery checks: 30 seconds */
  MIN_AUTO_CHECK_DEBOUNCE_MS: 30 * 1000,
  /** Independent per-attempt network timeout */
  REQUEST_TIMEOUT_MS: 10_000,
  /** Asset verification per-file timeout (covers headers + body read + SHA-256) */
  ASSET_TIMEOUT_MS: 12_000,
  /** Overall staging deadline across all assets */
  STAGE_TOTAL_DEADLINE_MS: 60_000,
  /** Maximum parallel asset fetches during staging */
  MAX_CONCURRENT_ASSET_DOWNLOADS: 3,
  /** Bounded per-asset byte ceiling (20 MiB) */
  MAX_SINGLE_ASSET_BYTES: 20 * 1024 * 1024,
  /** Bounded full-release byte ceiling (60 MiB) */
  MAX_TOTAL_RELEASE_BYTES: 60 * 1024 * 1024,
  /** Retry budget for transient network/5xx errors */
  MAX_CHECK_RETRIES: 2,
  BASE_RETRY_BACKOFF_MS: 600,
  /** Cross-tab leader lock lease duration */
  LEADER_LEASE_MS: 20_000,
  /** Multi-tab BroadcastChannel peer blocker heartbeat expiry */
  PEER_HEARTBEAT_TTL_MS: 15_000,
  /** Maximum activation attempts for a given releaseId before pausing for user intervention */
  MAX_ACTIVATION_ATTEMPTS: 2,
  /** Supported clinic database schema version */
  CLIENT_SCHEMA_VERSION: 4,
} as const;

export const DEFAULT_REMOTE_RELEASE_BASE_URL: string =
  ((typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_REMOTE_RELEASE_BASE_URL) ||
    'https://galaxy1364.github.io/Dendalcare/').replace(/\/?$/, '/');

function loadInjectedPinnedKeys(): readonly PinnedPublicKey[] {
  try {
    const raw =
      typeof import.meta !== 'undefined'
        ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env
            ?.VITE_PINNED_RELEASE_KEYS_JSON
        : undefined;
    if (!raw || !raw.trim()) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (k): k is PinnedPublicKey =>
        Boolean(k && typeof k.keyId === 'string' && k.algorithm === 'ECDSA-P256-SHA256' && k.jwk)
    );
  } catch {
    return [];
  }
}

/**
 * Pinned release verification public keys (ECDSA P-256).
 * Private keys stay strictly in CI/KMS secrets and are NEVER bundled in the client.
 * When empty, the engine NEVER claims `signatureVerified: true` (honest `unsigned_web_origin_only`).
 */
export const PINNED_RELEASE_PUBLIC_KEYS: readonly PinnedPublicKey[] = loadInjectedPinnedKeys();

function resolveDefaultRequireSignature(): boolean {
  const env =
    typeof import.meta !== 'undefined'
      ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      : undefined;
  if (env?.VITE_ALLOW_UNSIGNED_WEB_MIGRATION === 'true') return false;
  if (env?.VITE_REQUIRE_RELEASE_SIGNATURE === 'true') return true;
  return PINNED_RELEASE_PUBLIC_KEYS.length > 0;
}

/**
 * V9 P1 Fail-Closed Signature Policy:
 * Whenever pinned ECDSA public keys are bundled (or VITE_REQUIRE_RELEASE_SIGNATURE=true),
 * unsigned manifests are rejected by default unless explicit migration opt-out is configured.
 */
export const DEFAULT_REQUIRE_RELEASE_SIGNATURE: boolean = resolveDefaultRequireSignature();

export function computeJitteredDelayMs(
  baseMs: number,
  jitterMaxMs: number,
  randomFn: () => number = Math.random
): number {
  const r = Math.min(1, Math.max(0, randomFn()));
  return Math.round(baseMs + jitterMaxMs * r);
}

export function evaluateSafePoint(input: {
  localBlockers: readonly SafePointBlocker[];
  remoteTabBlockers: readonly SafePointBlocker[];
  offlineQueueCount: number;
  activeTabId: string;
  nowMs?: number;
  peerTtlMs?: number;
}): SafePointEvaluation {
  const nowMs = input.nowMs ?? Date.now();
  const peerTtlMs = input.peerTtlMs ?? UPDATE_TIMING_POLICY.PEER_HEARTBEAT_TTL_MS;

  // Retain only non-expired remote tab blockers (handles crashed/frozen tabs conservatively)
  const activeRemote = input.remoteTabBlockers.filter(
    (b) => b.updatedAt === undefined || nowMs - b.updatedAt <= peerTtlMs
  );

  const blockers: SafePointBlocker[] = [...input.localBlockers, ...activeRemote];
  if (input.offlineQueueCount > 0) {
    blockers.push({
      id: 'offline_mutation_queue',
      reason: `${input.offlineQueueCount.toLocaleString('fa-IR')} تغییر ثبت‌شده در صف آفلاین هنوز با سرور همگام نشده است.`,
      tabId: input.activeTabId,
      updatedAt: nowMs,
    });
  }
  return {
    isSafe: blockers.length === 0,
    blockers,
  };
}

export function getPersianUpdateErrorMessage(code: UpdateErrorCode): string {
  switch (code) {
    case 'OFFLINE':
      return 'دستگاه آفلاین است؛ بررسی بروزرسانی پس از برقراری اتصال اینترنت انجام می‌شود.';
    case 'TIMEOUT':
      return 'پاسخ سرور انتشار در زمان مجاز دریافت نشد. لطفاً دوباره تلاش کنید.';
    case 'HTTP_ERROR':
      return 'سرور انتشار پاسخ نامعتبر بازگرداند. نسخه فعلی شما بدون تغییر باقی ماند.';
    case 'SCHEMA_INVALID':
      return 'ساختار مانیفست انتشار نامعتبر است و برای حفظ امنیت رد شد.';
    case 'ORIGIN_NOT_ALLOWED':
      return 'نشانی منبع بروزرسانی خارج از فهرست امن HTTPS است و مسدود شد.';
    case 'SIGNATURE_INVALID':
      return 'امضای دیجیتال بسته انتشار تأیید نشد؛ نصب برای جلوگیری از دستکاری متوقف شد.';
    case 'DIGEST_MISMATCH':
      return 'اثر انگشت SHA-256 فایل‌های دریافتی با مانیفست رسمی تطابق ندارد.';
    case 'SIZE_MISMATCH':
      return 'حجم فایل دریافتی با اندازه اعلام‌شده در مانیفست رسمی مطابقت ندارد.';
    case 'STORAGE_QUOTA_EXCEEDED':
      return 'فضای ذخیره‌سازی مرورگر برای آماده‌سازی نسخه جدید کافی نیست؛ داده‌های شما کاملاً محفوظ ماندند.';
    case 'SEQUENCE_CONFLICT':
      return 'تعارض نسخه شناسایی شد: شماره انتشار یکسان با محتوای متفاوت دریافت شد.';
    case 'DOWNGRADE_REJECTED':
      return 'بازگشت به نسخه قدیمی‌تر (Downgrade) جهت حفظ امنیت رد شد.';
    case 'REPLAY_REJECTED':
      return 'مانیفست منقضی یا تکراری (Replay) شناسایی و رد شد.';
    case 'RELEASE_REVOKED':
      return 'این انتشار توسط مرجع رسمی لغو (Revoked) شده و قابل نصب نیست.';
    case 'MIGRATION_REQUIRED':
      return 'نسخه جدید نیازمند به‌روزرسانی ساختار دیتابیس (Migration) کلینیک است.';
    case 'NATIVE_UPDATE_REQUIRED':
      return 'برای دریافت این نسخه، به‌روزرسانی نسخه بومی اپلیکیشن از کانال رسمی فروشگاه لازم است.';
    case 'ASSET_VERIFICATION_FAILED':
      return 'برخی فایل‌های اجرایی یا سرویس‌ورکر انتشار جدید ناقص یا نامعتبر بودند؛ نسخه فعلی حفظ شد.';
    case 'ACTIVATION_TIMEOUT':
      return 'سرویس‌ورکر نسخه جدید در زمان مقرر فعال نشد؛ نسخه فعلی همچنان فعال است.';
    case 'BOOT_MISMATCH':
      return 'پس از بازنشانی، شناسه اجرایی نسخه یا سرویس‌ورکر با نسخه هدف تطابق نداشت.';
    case 'RECOVERY_VERIFICATION_FAILED':
      return 'بازیابی به نسخه سالم قبلی هنوز روی کلاینت اثبات نشده است؛ پرونده خطا جهت بررسی حفظ شد.';
    case 'RELOAD_LIMIT_REACHED':
      return 'سقف بازنشانی خودکار برای جلوگیری از حلقه رفرش پر شد؛ می‌توانید به‌صورت دستی تلاش کنید.';
    case 'CLIENT_PUBLISH_FORBIDDEN':
      return 'انتشار نسخه رسمی فقط از طریق خط لوله CI معتبر مجاز است و از کلاینت انجام نمی‌شود.';
    case 'UNSUPPORTED_PLATFORM':
      return 'این پلتفرم از نصب مستقیم درون‌برنامه‌ای پشتیبانی نمی‌کند.';
    default:
      return 'خطای غیرمنتظره در فرآیند بروزرسانی رخ داد؛ داده‌های شما کاملاً محفوظ هستند.';
  }
}

export function isRetryableUpdateError(code: UpdateErrorCode): boolean {
  return (
    code === 'OFFLINE' ||
    code === 'TIMEOUT' ||
    code === 'HTTP_ERROR' ||
    code === 'ASSET_VERIFICATION_FAILED' ||
    code === 'ACTIVATION_TIMEOUT' ||
    code === 'STORAGE_QUOTA_EXCEEDED'
  );
}
