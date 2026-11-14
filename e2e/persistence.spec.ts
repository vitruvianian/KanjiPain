import { expect, test } from './test';

import {
  completePaperAttempt,
  drawStroke,
  storedActiveSession,
  gradeGotItDespiteChecker,
} from './helpers';

test('reloading prompt and feedback never exposes another answer or resets the attempt', async ({
  page,
}) => {
  await page.goto('/#/practice');
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
  await page.getByRole('button', { name: 'Hide and try' }).click();
  await expect(page.getByRole('heading', { name: 'Write the kanji for:' })).toBeVisible();

  await drawStroke(page);
  await expect
    .poll(async () => {
      const session = await storedActiveSession(page);
      return session?.phase.kind === 'prompt' ? session.phase.draft.strokes.length : 0;
    })
    .toBe(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Write the kanji for:' })).toBeVisible();
  await expect(page.locator('.prompt-meaning')).toHaveText('day, sun, Japan');
  await expect(page.getByRole('button', { name: 'Compare answer' })).toBeEnabled();

  await page.getByRole('button', { name: 'Compare answer' }).click();
  await expect(page.getByRole('heading', { name: 'The character was' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Your submitted drawing' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'The character was' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Your submitted drawing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Got it', exact: true })).toBeEnabled();

  await gradeGotItDespiteChecker(page);
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish session' }).click();
  await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
  await expect(page.locator('.metric', { hasText: 'New characters introduced' })).toContainText(
    '2',
  );
});

test('reloading repair keeps the unscored second attempt and its target state', async ({
  page,
}) => {
  await page.goto('/#/practice');
  await page.getByRole('button', { name: 'Hide and try' }).click();
  await completePaperAttempt(page);
  await page.getByRole('button', { name: 'Missed it' }).click();

  await expect(
    page.getByRole('heading', { name: 'Look closely, then try once more' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Look closely, then try once more' }),
  ).toBeVisible();
  await expect(page.getByText(/unscored and does not change your schedule/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide it and draw once more' })).toBeVisible();

  await page.getByRole('button', { name: 'Hide it and draw once more' }).click();
  await expect(page.getByRole('img', { name: 'Repair drawing area' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('img', { name: 'Repair drawing area' })).toBeVisible();
  await page.getByRole('button', { name: 'Show the answer' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();

  await page.getByRole('button', { name: 'Finish session' }).click();
  await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
  await expect(page.locator('.metric', { hasText: 'Needs another round' })).toContainText('1');
});
