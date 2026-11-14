import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

export const BROWSER_TIME = Date.UTC(2027, 0, 15, 12);

export const test = base.extend({
  page: async ({ page }, run) => {
    // Keep timers running, but make due dates and local-day limits deterministic.
    await page.clock.setFixedTime(BROWSER_TIME);
    await run(page);
  },
});
