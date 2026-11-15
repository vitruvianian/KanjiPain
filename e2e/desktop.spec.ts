import { expect, test } from './test';

import { enterDojo } from './helpers';

test('a paper session can be graded with keyboard shortcuts alone', async ({ page }) => {
  await enterDojo(page);
  await page.getByRole('link', { name: 'Start practice' }).click();
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
  // The answer is drawn from its strokes, in handwriting rather than a print font.
  await expect(page.getByTestId('answer-glyph')).toBeVisible();
  await expect(page.locator('.glyph')).toHaveText('日');

  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Write the kanji for:' })).toBeVisible();
  await expect(page.getByText(/Keyboard: Enter compares/)).toBeVisible();

  await page.getByRole('radio', { name: 'Write on paper' }).check();
  await page.getByRole('checkbox', { name: 'I wrote it on paper' }).check();
  // On a focused checkbox, Enter belongs to the checkbox; H still works.
  await page.keyboard.press('h');
  await expect(page.getByText('Stroke count: 4')).toBeVisible();
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'The character was' })).toBeVisible();

  // The hint made this attempt assisted: Enter continues as a miss.
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Look closely, then try once more' }),
  ).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.getByRole('radio', { name: 'Write on paper' }).check();
  await page.getByRole('checkbox', { name: 'I wrote it on paper' }).check();
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Keyboard: 1 Got it, 2 Barely, 3 Missed it/)).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
});

test('the light theme can be chosen in Settings and survives a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await enterDojo(page);
  const background = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  expect(await background()).toBe('rgb(20, 20, 20)');

  await page.goto('/#/settings');
  await page.getByRole('radio', { name: 'Light' }).check();
  expect(await background()).toBe('rgb(247, 244, 238)');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();
  expect(await background()).toBe('rgb(247, 244, 238)');

  await page.getByRole('radio', { name: 'Match the system' }).check();
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await background()).toBe('rgb(247, 244, 238)');
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await background()).toBe('rgb(20, 20, 20)');
});

test('the Dojo shows when the last backup was made', async ({ page }) => {
  await enterDojo(page);
  await expect(page.getByText('No backup exported from this browser yet.')).toBeVisible();
  await page.goto('/#/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  await download;
  await expect(page.getByTestId('last-backup')).toContainText('Last backup:');
  await page.goto('/');
  await expect(page.getByText(/^Last backup:/)).toBeVisible();
});
