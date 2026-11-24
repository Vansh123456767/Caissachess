import React, { Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface BoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Caissa render error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-stone-50 text-stone-900">
          <div className="max-w-md w-full bg-white border border-stone-200 rounded-xl p-6 space-y-4 shadow-sm">
            <h1 className="text-lg font-bold">Unable to load Caissa Chess</h1>
            <p className="text-sm text-stone-600">
              {this.state.error.message || 'An unexpected browser error occurred.'}
            </p>
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.clear();
                } catch {
                  // ignore
                }
                window.location.reload();
              }}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold"
            >
              Reset Local Data &amp; Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
