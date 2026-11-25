import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Home, RefreshCw, RotateCcw } from 'lucide-react';
import { sanitizeLogMessage } from '@/app/bootstrapState';

export function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  const name = error instanceof Error ? error.name : '';
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Unable to preload CSS/i.test(msg)
  );
}

type Props = {
  children: ReactNode;
  /** Resets boundary state automatically whenever route/context key changes so one broken route never locks others */
  resetKey?: string | number;
  onGoHome?: () => void;
  maxRetries?: number;
};

type State = {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
  chunkError: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    retryCount: 0,
    chunkError: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      chunkError: isChunkLoadError(error),
    };
  }

  public componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({
        hasError: false,
        error: null,
        retryCount: 0,
        chunkError: false,
      });
    }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const safeMsg = sanitizeLogMessage(error);
    const componentHint = (errorInfo.componentStack || '')
      .split('\n')
      .slice(0, 3)
      .join(' ')
      .trim();
    console.error('[MinaDental RouteBoundary]', safeMsg, componentHint);
  }

  private handleBoundedRetry = () => {
    const maxRetries = this.props.maxRetries ?? 2;
    if (this.state.retryCount >= maxRetries) {
      this.handleControlledReload();
      return;
    }
    this.setState((prev) => ({
      hasError: false,
      error: null,
      chunkError: false,
      retryCount: prev.retryCount + 1,
    }));
  };

  private handleControlledReload = () => {
    if (typeof window === 'undefined') return;
    const cleanup = async () => {
      try {
        if ('caches' in window) {
          const keys = await window.caches.keys();
          await Promise.all(
            keys
              .filter((k) => k.startsWith('minadental-'))
              .map((k) => window.caches.delete(k))
          );
        }
      } catch {
        // ignore
      }
      window.location.reload();
    };
    void cleanup();
  };

  public render() {
    if (this.state.hasError) {
      const maxRetries = this.props.maxRetries ?? 2;
      const canRetryInPlace = !this.state.chunkError && this.state.retryCount < maxRetries;
      const safeMessage = this.state.chunkError
        ? 'نسخه جدیدی از این بخش منتشر شده یا دریافت فایل آن با اختلال مواجه شد. با بارگذاری مجدد کنترل‌شده، نسخه هماهنگ دریافت می‌شود.'
        : sanitizeLogMessage(this.state.error) || 'مشکلی در پردازش این بخش به وجود آمده است.';

      return (
        <div
          role="alert"
          data-testid="route_error_boundary"
          className="flex flex-col items-center justify-center min-h-[45vh] p-6 text-center"
        >
          <div className="w-16 h-16 rounded-3xl bg-red-500/10 text-red-500 flex items-center justify-center mb-4">
            <AlertTriangle size={32} />
          </div>
          <h3 className="text-base font-bold text-[#14283B] dark:text-[#F1F5F9] mb-2">
            {this.state.chunkError
              ? 'بروزرسانی فایل‌های این بخش لازم است'
              : 'خطایی در نمایش این بخش رخ داد'}
          </h3>
          <p className="text-xs text-[#526779] dark:text-[#9FB1C1] max-w-sm mb-6 leading-relaxed">
            {safeMessage}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {canRetryInPlace && (
              <button
                type="button"
                data-testid="error_boundary_retry_button"
                onClick={this.handleBoundedRetry}
                className="flex items-center gap-2 px-4 py-2.5 min-h-[48px] rounded-[12px] bg-[#087C76] text-white text-xs font-bold hover:opacity-95 transition-all active:scale-95"
              >
                <RefreshCw size={14} />
                تلاش مجدد
              </button>
            )}
            <button
              type="button"
              data-testid="error_boundary_reload_button"
              onClick={this.handleControlledReload}
              className="flex items-center gap-2 px-4 py-2.5 min-h-[48px] rounded-[12px] bg-[#0369A1] text-white text-xs font-bold hover:opacity-95 transition-all active:scale-95"
            >
              <RotateCcw size={14} />
              بارگذاری مجدد نسخه
            </button>
            {this.props.onGoHome && (
              <button
                type="button"
                data-testid="error_boundary_home_button"
                onClick={() => {
                  this.setState({
                    hasError: false,
                    error: null,
                    retryCount: 0,
                    chunkError: false,
                  });
                  this.props.onGoHome?.();
                }}
                className="flex items-center gap-2 px-4 py-2.5 min-h-[48px] rounded-[12px] bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] text-[#14283B] dark:text-[#F1F5F9] text-xs font-bold hover:opacity-95 transition-all active:scale-95"
              >
                <Home size={14} />
                بازگشت به خانه
              </button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
