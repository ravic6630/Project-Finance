import { Component } from 'react';

// App-level safety net: a render crash shows a friendly recover card instead
// of a blank white page. Class component because error boundaries still
// require one.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[sampada] render crash:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#faf9f5] px-6 text-center">
        <div className="text-4xl">🌱</div>
        <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
        <p className="max-w-sm text-sm text-slate-500">
          Sampada hit an unexpected error. Your data is safe — reloading usually fixes it.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          Reload Sampada
        </button>
      </div>
    );
  }
}
