import { Component, type ErrorInfo, type ReactNode } from 'react';

/* `main.tsx` rendered `<App />` bare: nothing in the SPA caught a render throw,
   so one broken screen blanked the WHOLE panel — white page, no message, no
   reload affordance — with an abuse-report queue behind it that nobody could
   then reach. The mobile app has AppErrorBoundary for exactly this; the
   moderator panel had nothing.

   Keyed on the active screen in App.tsx, so switching away from a broken screen
   clears the error instead of trapping the admin on it. */

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Nothing collects these yet, so the console is the only place a developer
    // can read the stack — say so rather than swallowing it silently.
    console.error('[admin] ekran xətası', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" style={{ padding: 22, borderColor: 'var(--red)' }}>
        <div style={{ font: '700 16px/1.2 var(--font)', marginBottom: 8 }}>Bu ekran açılmadı</div>
        <div style={{ font: '400 13px/1.5 var(--font)', color: 'var(--text3)', marginBottom: 6 }}>
          Ekranı çəkərkən xəta baş verdi. Panelin qalan hissəsi işləyir — soldakı menyudan başqa
          bölməyə keçə bilərsən, növbələr yerindədir.
        </div>
        <div style={{ font: '400 12px/1.5 var(--font)', color: 'var(--muted)', marginBottom: 16, wordBreak: 'break-word' }}>
          {this.state.error.message || 'naməlum xəta'}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={() => this.setState({ error: null })}>Yenidən cəhd et</button>
          <button className="btn primary" onClick={() => window.location.reload()}>Səhifəni yenilə</button>
        </div>
      </div>
    );
  }
}
