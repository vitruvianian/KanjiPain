import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { offlineServiceWorker, woff2Only } from './vite-plugins.ts';

export default defineConfig({
  plugins: [react(), woff2Only(), offlineServiceWorker()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
  },
});
