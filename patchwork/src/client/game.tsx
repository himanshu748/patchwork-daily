import { initialAssign, requestAssign } from './app/boot';
import './tokens.css';
import './game.css';

import { Component, StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AssignResponse, ClientResult } from '../shared/api';
import { App } from './app/App';
import { TEXT } from './lib/messages';

function Crashed(props: { readonly onReload: () => void }) {
  return (
    <main className="center" role="alert">
      <p className="t-m">{TEXT.somethingWrong}</p>
      <button type="button" className="button primary" onClick={props.onReload}>
        Reload
      </button>
    </main>
  );
}

class ErrorBoundary extends Component<
  { readonly children: ReactNode; readonly onReload: () => void },
  { readonly failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    return this.state.failed ? <Crashed onReload={this.props.onReload} /> : this.props.children;
  }
}

const container = document.getElementById('root');
if (container) {
  let mounts = 0;
  // "Reload" remounts the shell with a fresh assignment; Devvit web views do not navigate with window.location.
  const reload = (): void => mount(requestAssign());
  // Errors reach console.error so a fault stays visible in the Req 25.4 runs (D40).
  const root = createRoot(container, {
    onCaughtError: (error) => console.error('Patchwork caught an error', error),
    onUncaughtError: (error) => {
      console.error('Patchwork crashed', error);
      root.render(<Crashed onReload={reload} />);
    },
  });
  const mount = (assign: Promise<ClientResult<AssignResponse>>): void => {
    mounts++;
    root.render(
      <StrictMode>
        <ErrorBoundary key={mounts} onReload={reload}>
          <App initialAssign={assign} />
        </ErrorBoundary>
      </StrictMode>,
    );
  };
  mount(initialAssign);
}
