import { BROWSER_TIME, expect, test } from './test';

import {
  drawStroke,
  enterDojo,
  importBackup,
  importBackupFile,
  setDailyNewLimit,
  gradeGotItDespiteChecker,
} from './helpers';

test('exporting then importing into a fresh context preserves schedule, history, and summary', async ({
  page,
  browser,
}) => {
  await enterDojo(page);
  await setDailyNewLimit(page, 1);
  await page.goto('/#/');
  await page.getByRole('link', { name: 'Start practice' }).click();
  await page.getByRole('button', { name: 'Hide and try' }).click();
  await drawStroke(page);
  await page.getByRole('button', { name: 'Compare answer' }).click();
  await gradeGotItDespiteChecker(page);
  await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
  const summaryUrl = page.url();

  await page.goto('/#/kanji/k-65e5');
  const dueBefore = await page
    .locator('.character-facts div', { hasText: 'Next review' })
    .locator('dd')
    .textContent();

  await page.goto('/#/settings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const download = await downloadPromise;
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();

  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  await second.clock.setFixedTime(BROWSER_TIME);
  await importBackupFile(second, downloadedPath);
  await second.goto('/#/');
  await expect(second.getByRole('heading', { name: 'Dojo', exact: true })).toBeVisible();
  await expect(second.locator('.home-stat', { hasText: 'Due now' })).toContainText('0');
  await expect(second.getByRole('link', { name: 'Open last summary' })).toBeVisible();

  const summaryPath = new URL(summaryUrl).hash;
  await second.goto(`/${summaryPath}`);
  await expect(second.getByRole('heading', { name: 'Session summary' })).toBeVisible();
  await expect(second.locator('.metric', { hasText: 'New characters introduced' })).toContainText(
    '1',
  );
  await expect(second.locator('.introduced-glyphs')).toContainText('日');

  await second.goto('/#/kanji/k-65e5');
  const dueAfter = await second
    .locator('.character-facts div', { hasText: 'Next review' })
    .locator('dd')
    .textContent();
  expect(dueAfter).toBe(dueBefore);
  await expect(second.getByText('Scheduled review', { exact: true })).toBeVisible();
  await expect(second.getByText('Got it')).toBeVisible();
  await expect(second.getByText(/Drawing · Unassisted/)).toBeVisible();
  await secondContext.close();
});

test('settings persist across reloads without resetting today’s introductions', async ({
  page,
}) => {
  await enterDojo(page);
  await setDailyNewLimit(page, 1);
  await page.goto('/#/');
  await page.getByRole('link', { name: 'Start practice' }).click();
  await page.getByRole('button', { name: 'Hide and try' }).click();
  await page.getByRole('button', { name: "I don't know" }).click();
  await page.getByRole('button', { name: 'Continue — practice again' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  // With nothing else queued, a short rematch is offered with its own "Finish session";
  // the one in the header is there either way.
  await page.getByRole('button', { name: 'Finish session' }).first().click();
  await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
  await expect(page.locator('.metric', { hasText: 'New characters introduced' })).toContainText(
    '1',
  );

  await page.goto('/#/settings');
  await page.getByLabel('New characters per day').selectOption('2');
  await page.getByRole('radio', { name: 'Paper beside the screen' }).check();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText(/Preferences saved/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('New characters per day')).toHaveValue('2');
  await expect(page.getByRole('radio', { name: 'Paper beside the screen' })).toBeChecked();

  await page.goto('/#/');
  await expect(page.locator('.home-stat', { hasText: 'New allowance today' })).toContainText('1');
  await expect(page.locator('.home-stat', { hasText: 'New allowance today' })).toContainText(
    'limit of 2',
  );
});

test('backup controls are replaced by a resume link while a session is active', async ({
  page,
}) => {
  await page.goto('/#/practice');
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
  await page.goto('/#/settings');

  await expect(page.getByText(/Backup export and import are disabled/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export backup' })).toHaveCount(0);
  const resume = page.getByRole('link', { name: 'Resume the active session' });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
});

test('invalid JSON is rejected before any progress is replaced', async ({ page }) => {
  await importBackup(page, 'progress-backup.json');
  await page.goto('/#/settings');
  await page.getByLabel('Choose a backup file').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{'),
  });

  await expect(page.getByRole('alert')).toContainText(/not valid JSON/i);
  await expect(page.getByRole('heading', { name: 'Review this backup' })).toHaveCount(0);

  await page.goto('/#/');
  await expect(page.locator('.home-stat', { hasText: 'Due now' })).toContainText('4');
  await expect(page.locator('.home-stat', { hasText: 'Paused' })).toContainText('1');
});
