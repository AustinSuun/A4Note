import React from 'react';

type ErrorBoundaryState = {
  error: Error | null;
  copied: boolean;
};

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
    copied: false,
  };

  static getDerivedStateFromError(error: Error) {
    return { error, copied: false };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Aster UI crashed', error, info);
  }

  private copyError = async () => {
    if (!this.state.error) return;
    const details = [
      'Aster UI error',
      `Message: ${this.state.error.message}`,
      `Stack: ${this.state.error.stack ?? 'unavailable'}`,
      `User agent: ${navigator.userAgent}`,
      `Time: ${new Date().toISOString()}`,
    ].join('\n\n');
    try {
      await navigator.clipboard.writeText(details);
      this.setState({ copied: true });
    } catch {
      this.setState({ copied: false });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="error-boundary-shell">
        <section className="error-boundary-card">
          <div className="eyebrow">Aster</div>
          <h1>界面遇到异常</h1>
          <p>当前窗口没有关闭。可以先复制错误信息用于排查，然后重新载入界面。</p>
          <pre>{this.state.error.message}</pre>
          <div className="error-boundary-actions">
            <button type="button" className="primary rounded-button" onClick={() => window.location.reload()}>
              重新载入
            </button>
            <button type="button" className="rounded-button" onClick={() => void this.copyError()}>
              {this.state.copied ? '已复制' : '复制错误信息'}
            </button>
          </div>
        </section>
      </main>
    );
  }
}
