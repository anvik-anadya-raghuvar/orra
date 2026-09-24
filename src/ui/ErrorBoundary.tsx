import React from 'react';

/** The messages browsers use when a lazy route's chunk is gone — almost
 *  always because a deploy replaced the hashed file this tab was built with. */
const CHUNK_FAILURE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

const RELOAD_KEY = 'orra:chunk-reload-at';
/** One automatic reload per this window: if the fresh page fails the same
 *  way, it is not a stale deploy, and reloading again would only loop. */
const RELOAD_WINDOW_MS = 30_000;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return CHUNK_FAILURE.test(message);
}

/** Reload once for a stale chunk. Returns true when a reload was started. */
function reloadForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // No storage means no loop guard; show the error screen instead.
    return false;
  }
  window.location.reload();
  return true;
}

/**
 * Last resort. Without this, any uncaught render error anywhere in the tree
 * unmounts the whole app to a blank white page — no message, no way back
 * short of knowing to open devtools. This turns that into a recoverable
 * screen instead.
 *
 * App.tsx keys the route-level boundary on the pathname, so a crash in one
 * room is cleared by navigating to another rather than following you there.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null; reloading: boolean }
> {
  state: { error: Error | null; reloading: boolean } = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
    if (isChunkLoadError(error) && reloadForStaleChunk()) this.setState({ reloading: true });
  }

  render() {
    if (this.state.reloading) return null;
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div style={{ maxWidth: 440, textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Something went wrong</p>
            <p style={{ fontSize: 13.5, color: 'var(--slate)', marginBottom: 16 }}>
              {isChunkLoadError(this.state.error)
                ? 'ORRA was updated while this tab was open. Reload to get the new version.'
                : this.state.error.message || 'This screen hit an unexpected error.'}
            </p>
            <div style={{ display: 'flex', gap: 9, justifyContent: 'center' }}>
              <button
                className="btn"
                type="button"
                style={{ minHeight: 44 }}
                onClick={() => this.setState({ error: null })}
              >
                Try again
              </button>
              <button
                className="btn solid"
                type="button"
                style={{ minHeight: 44 }}
                onClick={() => window.location.reload()}
              >
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
