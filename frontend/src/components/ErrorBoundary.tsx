import { Component, ErrorInfo, ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State { return { hasError: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Monstera UI rendering failed:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return <main className="min-h-screen bg-[#f9faf5] px-5 flex items-center justify-center">
        <section role="alert" className="w-full max-w-md rounded-3xl border border-[#edeee9] bg-white p-8 text-center shadow-sm">
          <h1 className="font-headline text-2xl font-bold">This screen could not load</h1>
          <p className="mt-3 text-sm text-[#6f7a72]">Your account data is safe. Reload Monstera to try again.</p>
          <button onClick={() => window.location.reload()} className="mt-6 rounded-xl bg-[#0c6440] px-5 py-3 text-sm font-semibold text-white">Reload Monstera</button>
        </section>
      </main>;
    }
    return this.props.children;
  }
}
