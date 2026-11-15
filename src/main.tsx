import '@fontsource/noto-sans-jp/400.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { AppProviders } from './app/AppProviders';
import { ErrorBoundary } from './app/ErrorBoundary';
import { registerServiceWorker } from './app/service-worker';
import { loadReferenceStrokes } from './recognition/load';
import './styles/global.css';

// Fetch stroke data alongside the app so drawings can be checked without a later request.
void loadReferenceStrokes().catch(() => undefined);

registerServiceWorker();

const root = document.querySelector<HTMLDivElement>('#root');

if (root === null) {
  throw new Error('KanjiPain could not find its root element.');
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProviders>
        <App />
      </AppProviders>
    </ErrorBoundary>
  </StrictMode>,
);
