import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'An unexpected error occurred.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught application error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let parsedError: Record<string, unknown> | null = null;
      try {
        parsedError = JSON.parse(this.state.errorMessage);
      } catch {
        parsedError = null;
      }

      const displayMessage = (
        parsedError && typeof parsedError.error === 'string'
          ? parsedError.error
          : this.state.errorMessage
      )
        .replace(/Firebase:\s*/gi, '')
        .replace(/Firestore/gi, 'Cloud Database');

      return (
        <div className="min-h-dvh bg-[#F6F7F8] flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-white rounded-2xl border border-[#E5E7EB] p-6 shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-red-50 text-red-600 flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-[#111827] mb-1">
              Database or Application Notice
            </h2>
            <p className="text-sm text-[#6B7280] mb-4">{displayMessage}</p>
            <button
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '' });
                window.location.reload();
              }}
              className="w-full h-12 rounded-xl bg-[#0F7B49] text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
            >
              <RefreshCw className="w-4 h-4" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
