import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 text-center">
          <div className="w-16 h-16 rounded-3xl bg-red-500/10 text-red-500 flex items-center justify-center mb-4">
            <AlertTriangle size={32} />
          </div>
          <h3 className="text-base font-bold text-white mb-2">خطایی در نمایش این بخش رخ داد</h3>
          <p className="text-xs text-gray-400 max-w-sm mb-6 leading-relaxed">
            {this.state.error?.message || 'مشکلی در پردازش اطلاعات به وجود آمده است.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-all active:scale-95 shadow-lg shadow-blue-500/25"
          >
            <RefreshCw size={14} />
            تلاش مجدد و بارگذاری
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
