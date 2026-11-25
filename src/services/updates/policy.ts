import type {
  PinnedPublicKey,
  SafePointBlocker,
  SafePointEvaluation,
  UpdateErrorCode,
  UpdateState,
} from './contracts';

/**
 * Authoritative V7 Update State Transition Table.
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
  /** Asset verification per-file timeout */
  ASSET_TIMEOUT_MS: 12_000,
  /** Retry budget for transient network/5xx errors */
  MAX_CHECK_RETRIES: 2,
  BASE_RETRY_BACKOFF_MS: 600,
  /** Cross-tab leader lock lease duration */
  LEADER_LEASE_MS: 20_000,
  /** Maximum activation attempts for a given releaseId before pausing for user intervention */
  MAX_ACTIVATION_ATTEMPTS: 2,
  /** Supported clinic database schema version */
  CLIENT_SCHEMA_VERSION: 4,
} as const;

/**
 * Pinned release verification public keys (ECDSA P-256).
 * Private keys stay strictly in CI/KMS secrets and are NEVER bundled in the client.
 * Key rotation adds a new `active` entry, marks the previous key `rotated`, and
 * revokes compromised keys via `status: 'revoked'`.
 */
export const PINNED_RELEASE_PUBLIC_KEYS: readonly PinnedPublicKey[] = [];

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
}): SafePointEvaluation {
  const blockers: SafePointBlocker[] = [...input.localBlockers, ...input.remoteTabBlockers];
  if (input.offlineQueueCount > 0) {
    blockers.push({
      id: 'offline_mutation_queue',
      reason: `${input.offlineQueueCount.toLocaleString('fa-IR')} تغییر ثبت‌شده در صف آفلاین هنوز با سرور همگام نشده است.`,
      tabId: input.activeTabId,
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
    case 'SEQUENCE_CONFLICT':
      return 'تعارض نسخه شناسایی شد: شماره انتشار یکسان با محتوای متفاوت دریافت شد.';
    case 'DOWNGRADE_REJECTED':
      return 'بازگشت به نسخه قدیمی‌تر (Downgrade) جهت حفظ امنیت رد شد.';
    case 'REPLAY_REJECTED':
      return 'مانیفست قدیمی یا تکراری (Replay) شناسایی و رد شد.';
    case 'RELEASE_REVOKED':
      return 'این انتشار توسط مرجع رسمی لغو (Revoked) شده و قابل نصب نیست.';
    case 'MIGRATION_REQUIRED':
      return 'نسخه جدید نیازمند به‌روزرسانی ساختار دیتابیس (Migration) کلینیک است.';
    case 'NATIVE_UPDATE_REQUIRED':
      return 'برای دریافت این نسخه، به‌روزرسانی نسخه بومی اپلیکیشن از فروشگاه رسمی لازم است.';
    case 'ASSET_VERIFICATION_FAILED':
      return 'برخی فایل‌های اجرایی انتشار جدید ناقص یا نامعتبر بودند؛ نسخه فعلی حفظ شد.';
    case 'ACTIVATION_TIMEOUT':
      return 'سرویس‌ورکر نسخه جدید در زمان مقرر فعال نشد؛ نسخه فعلی همچنان فعال است.';
    case 'BOOT_MISMATCH':
      return 'پس از بازنشانی، شناسه نسخه در حال اجرا با نسخه هدف تطابق نداشت.';
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
    code === 'ACTIVATION_TIMEOUT'
  );
}
