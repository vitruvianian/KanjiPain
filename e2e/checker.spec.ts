import { expect, test } from './test';

import { drawLine, storedActiveSession } from './helpers';

async function openFirstPrompt(page: import('@playwright/test').Page) {
  await page.goto('/#/practice');
  await page.getByRole('button', { name: 'Hide and try' }).click();
  await expect(page.locator('.prompt-meaning')).toHaveText('day, sun, Japan');
}

// 日, in standard stroke order: left side, top and right side, middle bar, bottom bar.
const SUN = [
  [
    [0.3, 0.2],
    [0.3, 0.8],
  ],
  [
    [0.3, 0.2],
    [0.7, 0.2],
    [0.7, 0.8],
  ],
  [
    [0.3, 0.5],
    [0.7, 0.5],
  ],
  [
    [0.3, 0.8],
    [0.7, 0.8],
  ],
] as const;

test('a correctly drawn character is recognized and can be graded directly', async ({ page }) => {
  await openFirstPrompt(page);
  for (const stroke of SUN) await drawLine(page, stroke);
  await page.getByRole('button', { name: 'Compare answer' }).click();

  await expect(page.getByText('This matches 日.')).toBeVisible();
  await expect(page.getByText('Suggested grade: Got it.', { exact: false })).toBeVisible();
  await expect(page.getByTestId('model-strokes').locator('polyline')).toHaveCount(4);

  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
  expect((await storedActiveSession(page))?.completedEventIds).toHaveLength(1);
});

test('wrong stroke order is recognized as the right shape and suggests Barely', async ({
  page,
}) => {
  await openFirstPrompt(page);
  for (const index of [2, 0, 1, 3] as const) await drawLine(page, SUN[index]);
  await page.getByRole('button', { name: 'Compare answer' }).click();

  await expect(page.getByText('Right shape, wrong stroke order.')).toBeVisible();
  await expect(page.getByText('Suggested grade: Barely.', { exact: false })).toBeVisible();
  await expect(page.getByText('written out of order')).toBeVisible();
  await page.getByRole('button', { name: 'Barely', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
});

test('a wrong drawing is rejected and needs confirmation to count as correct', async ({ page }) => {
  await openFirstPrompt(page);
  await drawLine(page, SUN[2]);
  await page.getByRole('button', { name: 'Compare answer' }).click();

  await expect(page.getByText('The stroke count is off.')).toBeVisible();
  await expect(page.getByText('You drew 1 stroke; 日 has 4.')).toBeVisible();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Confirm grade' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Missed it', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Look closely, then try once more' }),
  ).toBeVisible();
});

test('a new character shows how to write it before the attempt, and never during it', async ({
  page,
}) => {
  await page.goto('/#/practice');
  await expect(page.getByRole('heading', { name: 'How to write it' })).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Stroke order animation for 日: 4 strokes' }),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: /^Stroke \d of 4$/ })).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Replay stroke order' })).toBeVisible();

  await page.getByRole('button', { name: 'Hide and try' }).click();
  await expect(page.getByRole('heading', { name: 'Write the kanji for:' })).toBeVisible();
  await expect(page.locator('.stroke-order')).toHaveCount(0);

  await page.goto('/#/kanji/k-6c38');
  await expect(page.getByRole('img', { name: /^Stroke \d of 5$/ })).toHaveCount(5);
});
