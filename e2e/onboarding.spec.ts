import { expect, test } from './test';

import { drawStroke, enterDojo, gradeGotItDespiteChecker } from './helpers';

test('first visit explains the product, persists onboarding, and reaches a summary', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to KanjiPain' })).toBeVisible();
  await expect(page.getByText(/stored only in this browser/i)).toBeVisible();
  await expect(page.getByText(/the grade is yours/i)).toBeVisible();
  await expect(page.getByText(/drawings are never included in a backup/i)).toBeVisible();

  await page.getByRole('button', { name: 'Enter the Dojo' }).click();
  await expect(page.getByRole('heading', { name: 'Dojo', exact: true })).toBeVisible();
  await expect(page.locator('.home-stat', { hasText: 'Due now' })).toContainText('0');
  await expect(page.locator('.home-stat', { hasText: 'New allowance today' })).toContainText('5');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dojo', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome to KanjiPain' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Start practice' }).click();
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
  await page.getByRole('button', { name: 'Hide and try' }).click();
  await expect(page.getByRole('heading', { name: 'Write the kanji for:' })).toBeVisible();
  await expect(page.locator('.prompt-meaning')).toHaveText('day, sun, Japan');

  await drawStroke(page);
  await page.getByRole('button', { name: 'Compare answer' }).click();
  await expect(page.getByRole('heading', { name: 'The character was' })).toBeVisible();
  await gradeGotItDespiteChecker(page);
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();

  await page.getByRole('button', { name: 'Finish session' }).click();
  await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
  await expect(page.getByText('Partial session')).toBeVisible();
  await expect(page.locator('.metric', { hasText: 'New characters introduced' })).toContainText(
    '2',
  );
  expect(page.url()).toContain('/#/sessions/');

  await page.getByRole('link', { name: 'Return to the Dojo' }).click();
  await expect(page.getByRole('heading', { name: 'Dojo', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open last summary' })).toBeVisible();
});

test('the onboarding flag is stored locally rather than only in React state', async ({ page }) => {
  await enterDojo(page);
  await page.goto('/#/collection');
  await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible();
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Dojo', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome to KanjiPain' })).toHaveCount(0);
});
