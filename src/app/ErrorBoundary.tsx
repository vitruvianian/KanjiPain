import { Component, type ReactNode } from 'react';

import { Button } from '../components/Button';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <section className="panel" role="alert" aria-labelledby="render-error-title">
          <h1 id="render-error-title">Something went wrong</h1>
          <p>KanjiPain could not display this screen. Reload to restore your saved progress.</p>
          <Button
            variant="primary"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload app
          </Button>
        </section>
      );
    }
    return this.props.children;
  }
}
