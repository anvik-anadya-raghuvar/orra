import React from 'react';

/**
 * Last resort. Without this, any uncaught render error anywhere in the tree
 * unmounts the whole app to a blank white page — no message, no way back
 * short of knowing to open devtools. This turns that into a recoverable
 * screen instead.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div style={{ maxWidth: 440, textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Something went wrong</p>
            <p style={{ fontSize: 13.5, color: 'var(--slate)', marginBottom: 16 }}>
              {this.state.error.message || 'This screen hit an unexpected error.'}
            </p>
            <div style={{ display: 'flex', gap: 9, justifyContent: 'center' }}>
              <button
                className="btn"
                type="button"
                onClick={() => this.setState({ error: null })}
              >
                Try again
              </button>
              <button className="btn solid" type="button" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
