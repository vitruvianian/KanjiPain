import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    // Tests start from fresh storage; the offline spec opts back in to the service worker.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Safari's engine for the flows that differ most between browsers: drawing and practice.
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: ['drawing.spec.ts', 'practice.spec.ts', 'checker.spec.ts', 'desktop.spec.ts'],
    },
  ],
  webServer: {
    command:
      'npm run build:e2e && npm run preview:e2e -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
