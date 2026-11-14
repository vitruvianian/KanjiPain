import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
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
