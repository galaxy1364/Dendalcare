import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { appBootstrap, sanitizeLogMessage } from '@/app/bootstrapState';

interface RootErrorBoundaryProps {
  children: ReactNode;
  maxRetries?: number;
}

interface RootErrorBoundaryState {
  hasError: boolean;
  safeErrorMessage: string;
  retryCount: number;
  isRecovering: boolean;
}

/**
 * Provider-independent Root ErrorBoundary mounted directly in src/main.tsx.
 * Zero dependency on React Context, theme providers, or icon libraries so even
 * catastrophic provider/bootstrap render failures present a recoverable RTL UI
 * without wiping IndexedDB, patient records, auth tokens, or offline queues.
 */
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  public state: RootErrorBoundaryState = {
    hasError: false,
    safeErrorMessage: '',
    retryCount: 0,
    isRecovering: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<RootErrorBoundaryState> {
    return {
      hasError: true,
      safeErrorMessage: sanitizeLogMessage(error),
    };
  }

  public componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
    const safeMsg = sanitizeLogMessage(error);
    appBootstrap.transition('ERROR', {
      code: 'ROOT_RENDER_CRASH',
      message: safeMsg,
    });
    if (typeof document !== 'undefined') {
      const splashEl = document.getElementById('app-splash');
      if (splashEl) splashEl.remove();
    }
    console.error('[MinaDental RootErrorBoundary]', safeMsg);
  }

  private handleBoundedRetry = () => {
    const maxRetries = this.props.maxRetries ?? 2;
    if (this.state.retryCount >= maxRetries) return;
    this.setState((prev) => ({
      hasError: false,
      safeErrorMessage: '',
      retryCount: prev.retryCount + 1,
    }));
  };

  /**
   * Safe shell-cache recovery ONLY: clears minadental-* CacheStorage & unregisters SW.
   * NEVER touches IndexedDB, patient data, session tokens, or offline mutation queues.
   */
  private handleSafeShellReload = async () => {
    if (this.state.isRecovering) return;
    this.setState({ isRecovering: true });
    const tasks: Promise<unknown>[] = [];
    try {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        tasks.push(
          navigator.serviceWorker
            .getRegistrations()
            .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        );
      }
      if (typeof window !== 'undefined' && 'caches' in window) {
        tasks.push(
          window.caches.keys().then((keys) =>
            Promise.all(
              keys
                .filter((k) => k.startsWith('minadental-'))
                .map((k) => window.caches.delete(k))
            )
          )
        );
      }
    } catch {
      // ignore cleanup failures
    }
    await Promise.allSettled(tasks);
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  public render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const maxRetries = this.props.maxRetries ?? 2;
    const canRetry = this.state.retryCount < maxRetries;

    return (
      <div
        dir="rtl"
        role="alert"
        data-testid="root_error_boundary"
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#F4F7F9',
          color: '#14283B',
          fontFamily: "'Vazirmatn', system-ui, -apple-system, sans-serif",
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '400px',
            background: '#FFFFFF',
            border: '1px solid #D8E2EA',
            borderRadius: '22px',
            padding: '24px',
            boxShadow: '0 16px 40px rgba(20, 40, 59, 0.08)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: '52px',
              height: '52px',
              margin: '0 auto 14px',
              borderRadius: '16px',
              background: '#FFF1F2',
              color: '#BE123C',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              fontWeight: 800,
            }}
            aria-hidden="true"
          >
            !
          </div>
          <h1 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 800 }}>
            خطا در بارگذاری سامانه مینادنتال
          </h1>
          <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#526779', lineHeight: 1.8 }}>
            خطای غیرمنتظره‌ای در راه‌اندازی رابط کاربری رخ داد. تمامی پرونده‌ها، اطلاعات مالی و صف آفلاین شما کاملاً محفوظ هستند.
          </p>
          {this.state.safeErrorMessage && (
            <div
              style={{
                marginBottom: '16px',
                padding: '10px 12px',
                borderRadius: '12px',
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                fontSize: '11px',
                color: '#475569',
                direction: 'ltr',
                wordBreak: 'break-word',
              }}
            >
              {this.state.safeErrorMessage}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {canRetry && (
              <button
                type="button"
                data-testid="root_error_retry_button"
                onClick={this.handleBoundedRetry}
                style={{
                  minHeight: '46px',
                  borderRadius: '14px',
                  border: 'none',
                  background: '#087C76',
                  color: '#FFFFFF',
                  fontFamily: 'inherit',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: '0 16px',
                }}
              >
                تلاش مجدد ({maxRetries - this.state.retryCount} بار باقی‌مانده)
              </button>
            )}
            <button
              type="button"
              data-testid="root_error_safe_reload_button"
              disabled={this.state.isRecovering}
              onClick={this.handleSafeShellReload}
              style={{
                minHeight: '46px',
                borderRadius: '14px',
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#14283B',
                fontFamily: 'inherit',
                fontSize: '13px',
                fontWeight: 700,
                cursor: this.state.isRecovering ? 'wait' : 'pointer',
                padding: '0 16px',
              }}
            >
              {this.state.isRecovering
                ? 'در حال پاک‌سازی کش پوسته...'
                : 'پاک‌سازی کش پوسته و بارگذاری مجدد'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
