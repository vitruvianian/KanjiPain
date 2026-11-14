import { expect, test } from './test';

import { enterDojo, setDailyNewLimit } from './helpers';

test('extra sessions go past the daily limit and can be repeated', async ({ page }) => {
  await enterDojo(page);
  await setDailyNewLimit(page, 0);
  await page.goto('/#/');
  await expect(page.getByText('Nothing is scheduled right now.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start practice' })).toHaveCount(0);

  for (const round of [1, 2]) {
    await page.getByRole('link', { name: 'Learn 5 more new characters' }).first().click();
    await expect(page.getByText('Extra session: new characters')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
    await page.getByRole('button', { name: 'Finish session' }).click();

    await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
    await expect(page.getByText(/extra session/)).toBeVisible();
    await expect(page.locator('.metric', { hasText: 'New characters introduced' })).toContainText(
      String(1),
    );
    // Straight from the summary, another extra session is one click away.
    await expect(page.getByRole('link', { name: 'Learn 5 more new characters' })).toBeVisible();
    if (round === 1) await page.goto('/#/');
  }

  await page.getByRole('link', { name: /^Review 2 learned characters ahead$/ }).click();
  await expect(page.getByText('Extra session: reviewing ahead')).toBeVisible();
  await expect(page.locator('.practice-progress')).toContainText('2 primary');
});
