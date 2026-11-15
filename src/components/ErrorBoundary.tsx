import React from 'react';
import { RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  autoRetryCount: number;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
    autoRetryCount: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      message: error.message || 'An unexpected rendering error occurred.',
    };
  }

  componentDidCatch() {
    // Automatically recover from transient wake/background UI glitches without interrupting audio
    if (this.state.autoRetryCount < 2) {
      window.setTimeout(() => {
        this.setState((prev) => ({
          hasError: false,
          message: '',
          autoRetryCount: prev.autoRetryCount + 1,
        }));
      }, 60);
    }
  }

  handleReload = () => {
    this.setState({ hasError: false, message: '', autoRetryCount: 0 });
  };

  render() {
    if (this.state.hasError && this.state.autoRetryCount >= 2) {
      return (
        <div className="min-h-screen bg-[#090A0F] text-white flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl bg-[#11131A] border border-white/10 p-6 space-y-4 text-center">
            <h1 className="text-lg font-bold text-white">Something went wrong in VIBRA</h1>
            <p className="text-xs text-slate-400 leading-relaxed">{this.state.message}</p>
            <button
              type="button"
              onClick={this.handleReload}
              className="h-10 px-5 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-xs font-semibold text-white inline-flex items-center gap-2 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Resume VIBRA</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
