import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

import { offlineServiceWorker, woff2Only } from './vite-plugins.ts';

export default defineConfig({
  plugins: [react(), woff2Only(), offlineServiceWorker()],
  build: {
    outDir: 'dist-e2e',
    rolldownOptions: {
      input: {
        app: resolve('index.html'),
        inputFixture: resolve('tests/browser-fixture/index.html'),
      },
    },
  },
});
