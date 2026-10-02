import React from 'react';

// Catches rendering crashes anywhere below it so a bug shows a message
// with recovery actions instead of a blank white page.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    try {
      // eslint-disable-next-line no-console
      console.error('[app crash]', error);
    } catch {}
  }

  render() {
    const { error } = this.state;
    if (error) {
      const msg = String((error && error.message) || error || 'Unknown error');
      return (
        <div className="auth-wrap">
          <div className="card auth-card" style={{ textAlign: 'center', padding: '36px 24px' }}>
            <h1>Something went wrong</h1>
            <p className="muted small">{msg}</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
              <button type="button" className="btn primary" onClick={() => window.location.reload()}>Reload page</button>
              <a className="btn" href="/shop">Back to shop</a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
