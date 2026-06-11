'use client';
import React from 'react';

interface State { hasError: boolean; message: string }

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(err: unknown): State {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  handleReset = () => {
    // Clear saved state that might be corrupt, then reload
    try { localStorage.removeItem('baseball-pitch-tracker-v1'); } catch {}
    this.setState({ hasError: false, message: '' });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
          <div className="text-[60px] mb-4">⚾</div>
          <h1 className="text-[27px] font-bold mb-2">Something went wrong</h1>
          <p className="text-slate-400 text-[18px] mb-2">The app hit an unexpected error.</p>
          {this.state.message && (
            <p className="text-red-400 text-[15px] font-mono mb-6 max-w-xs break-words opacity-70">
              {this.state.message}
            </p>
          )}
          <button
            onClick={this.handleReset}
            className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-[21px] px-8 py-3 rounded-2xl"
          >
            Reload App
          </button>
          <p className="text-slate-600 text-[15px] mt-4">
            (This will clear unsaved data)
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
