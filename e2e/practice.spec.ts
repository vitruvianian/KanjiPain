import { BROWSER_TIME, expect, test } from './test';

import {
  completePaperAttempt,
  drawStroke,
  enterDojo,
  importBackup,
  gradeGotItDespiteChecker,
} from './helpers';

test('draws a real character, grades it, and finishes with a summary', async ({ page }) => {
  await page.goto('/#/practice');
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);

  await page.getByRole('button', { name: 'Hide and try' }).click();
  await expect(page.getByRole('heading', { name: 'Write the kanji for:' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Kanji drawing area' })).toBeVisible();
  await expect(page.locator('.prompt-meaning')).toHaveText('day, sun, Japan');

  await drawStroke(page);
  await page.getByRole('button', { name: 'Compare answer' }).click();
  await expect(page.getByRole('heading', { name: 'The character was' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Your submitted drawing' })).toBeVisible();

  await gradeGotItDespiteChecker(page);
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
  await expect(page.locator('.practice-progress')).toContainText('4 primary');

  await page.getByRole('button', { name: 'Finish session' }).click();
  await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
  await expect(page.getByText('Partial session')).toBeVisible();
  await expect(page.locator('.metric', { hasText: 'New characters introduced' })).toContainText(
    '2',
  );
  await expect(page.getByRole('link', { name: 'Return to the Dojo' })).toBeVisible();
  expect(page.url()).toContain('/#/sessions/');
});

test('supports a keyboard-only paper attempt and stacks feedback at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/#/practice');
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();

  await page.getByRole('button', { name: 'Hide and try' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Write the kanji for:' })).toBeVisible();

  await page.getByRole('radio', { name: 'Write on paper' }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name: 'I wrote it on paper' })).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Compare answer' })).toBeEnabled();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'The character was' })).toBeVisible();
  const attempt = await page.getByRole('heading', { name: 'Your attempt' }).boundingBox();
  const grade = await page.getByRole('heading', { name: 'How did it go?' }).boundingBox();
  expect(attempt).not.toBeNull();
  expect(grade).not.toBeNull();
  expect(grade?.y ?? 0).toBeGreaterThan(attempt?.y ?? 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);

  await page.getByRole('button', { name: 'Got it' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
});

test('persists hints, assistance, and repair across reloads', async ({ page }) => {
  await page.goto('/#/practice');
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
  await page.getByRole('button', { name: 'Hide and try' }).click();
  await expect(page.getByRole('heading', { name: 'Write the kanji for:' })).toBeVisible();

  await page.getByRole('button', { name: 'Give me a foothold' }).click();
  await expect(page.getByText(/Stroke count: 4/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Write the kanji for:' })).toBeVisible();
  await expect(page.getByText(/Stroke count: 4/)).toBeVisible();

  await page.getByRole('radio', { name: 'Write on paper' }).check();
  await page.getByRole('checkbox', { name: 'I wrote it on paper' }).check();
  await page.getByRole('button', { name: 'Compare answer' }).click();
  await expect(page.getByText(/Assisted recall/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Got it' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Continue — practice again' }).click();
  await expect(
    page.getByRole('heading', { name: 'Look closely, then try once more' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Look closely, then try once more' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();

  await page.getByRole('button', { name: 'Finish session' }).click();
  await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
  await expect(page.locator('.metric', { hasText: 'Needs another round' })).toContainText('1');
});

test('a hinted due-card miss returns after three distinct completions', async ({ page }) => {
  await importBackup(page, 'progress-backup.json');
  await page.goto('/#/');
  await expect(page.locator('.home-stat', { hasText: 'Due now' })).toContainText('4');
  await expect(page.locator('.home-stat', { hasText: 'Paused' })).toContainText('1');

  await page.getByRole('link', { name: 'Start practice' }).click();
  await expect(page.getByRole('heading', { name: 'Write the kanji for:' })).toBeVisible();
  await expect(page.locator('.prompt-meaning')).toHaveText('day, sun, Japan');

  await page.getByRole('button', { name: 'Give me a foothold' }).click();
  await expect(page.getByText(/Stroke count: 4/)).toBeVisible();
  await page.getByRole('radio', { name: 'Write on paper' }).check();
  await page.getByRole('checkbox', { name: 'I wrote it on paper' }).check();
  await page.getByRole('button', { name: 'Compare answer' }).click();
  await expect(page.getByText(/Assisted recall/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue — practice again' }).click();
  await expect(
    page.getByRole('heading', { name: 'Look closely, then try once more' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  for (const meaning of ['one, one radical (no.1)', 'person', 'year, counter for years']) {
    await expect(page.getByRole('heading', { name: 'Write the kanji for:' })).toBeVisible();
    await expect(page.locator('.prompt-meaning')).toHaveText(meaning);
    await completePaperAttempt(page);
    await page.getByRole('button', { name: 'Got it', exact: true }).click();
  }

  await expect(page.getByRole('heading', { name: 'Write the kanji for:' })).toBeVisible();
  await expect(page.locator('.prompt-meaning')).toHaveText('day, sun, Japan');
  await completePaperAttempt(page);
  await page.getByRole('button', { name: 'Got it', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
  await expect(page.locator('.metric', { hasText: 'Misses recovered' })).toContainText('1');
  await expect(page.locator('.metric', { hasText: 'Needs another round' })).toContainText('0');
  await expect(page.locator('.metric', { hasText: 'Independent reviews' })).toContainText('3');
});

test('a short queue offers a bounded short rematch instead of inventing spacing', async ({
  page,
}) => {
  await importBackup(page, 'single-due-backup.json');
  await page.goto('/#/');
  await expect(page.locator('.home-stat', { hasText: 'Due now' })).toContainText('1');
  await page.getByRole('link', { name: 'Start practice' }).click();

  await expect(page.getByRole('heading', { name: 'Write the kanji for:' })).toBeVisible();
  await page.getByRole('button', { name: 'Give me a foothold' }).click();
  await page.getByRole('radio', { name: 'Write on paper' }).check();
  await page.getByRole('checkbox', { name: 'I wrote it on paper' }).check();
  await page.getByRole('button', { name: 'Compare answer' }).click();
  await page.getByRole('button', { name: 'Continue — practice again' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(
    page.getByRole('heading', { name: 'Short rematch — less spacing this time' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Practice it now' }).click();
  await expect(page.locator('.prompt-meaning')).toHaveText('day, sun, Japan');
  await completePaperAttempt(page);
  await page.getByRole('button', { name: 'Missed it' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(
    page.getByRole('heading', { name: 'Short rematch — less spacing this time' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Practice it now' }).click();
  await completePaperAttempt(page);
  await page.getByRole('button', { name: 'Missed it' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
  await expect(page.locator('.metric', { hasText: 'Needs another round' })).toContainText('1');
  await page.goto('/#/kanji/k-65e5');
  await expect(page.getByText('Scheduled review', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Rematch', { exact: true })).toHaveCount(2);
});

test('rapid repeated grade activation persists exactly one scheduled review', async ({ page }) => {
  await importBackup(page, 'single-due-backup.json');
  await page.goto('/#/practice');
  await expect(page.getByRole('heading', { name: 'Write the kanji for:' })).toBeVisible();
  await completePaperAttempt(page);

  const gradeButton = page.getByRole('button', { name: 'Got it', exact: true });
  await gradeButton.evaluate((element) => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
  await expect(page.locator('.metric', { hasText: 'Independent reviews' })).toContainText('1');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.metric', { hasText: 'Independent reviews' })).toContainText('1');
  await page.goto('/#/kanji/k-65e5');
  // One fixture event plus exactly one new primary, even after reload.
  await expect(page.getByText('Scheduled review', { exact: true })).toHaveCount(2);
});

test('a stale second tab reloads canonical state instead of clobbering the session', async ({
  page,
}) => {
  const second = await page.context().newPage();
  await second.clock.setFixedTime(BROWSER_TIME);
  await Promise.all([page.goto('/#/practice'), second.goto('/#/practice')]);
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
  await expect(second.getByRole('heading', { name: 'Meet the character' })).toBeVisible();

  await page.getByRole('button', { name: 'Hide and try' }).click();
  await drawStroke(page);
  await page.getByRole('button', { name: 'Compare answer' }).click();
  await gradeGotItDespiteChecker(page);
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();

  await second.getByRole('button', { name: 'Hide and try' }).click();
  await expect(second.getByText(/changed in another tab/i)).toBeVisible();
  await expect(second.getByRole('heading', { name: 'Meet the character' })).toBeVisible();

  await second.getByRole('button', { name: 'Finish session' }).click();
  await expect(second.getByRole('heading', { name: 'Session summary' })).toBeVisible();
  await expect(second.locator('.metric', { hasText: 'New characters introduced' })).toContainText(
    '2',
  );
  await second.close();
});

test('flagging ambiguity pauses the card and resuming keeps its original due date', async ({
  page,
}) => {
  await importBackup(page, 'single-due-backup.json');
  await page.goto('/#/kanji/k-65e5');
  await expect(page.getByRole('heading', { level: 1, name: '日' })).toBeVisible();
  const dueBefore = await page
    .locator('.character-facts div', { hasText: 'Next review' })
    .locator('dd')
    .textContent();
  expect(dueBefore).toContain('Due now');

  await page.goto('/#/practice');
  await expect(page.getByRole('heading', { name: 'Write the kanji for:' })).toBeVisible();
  await completePaperAttempt(page);
  await page.getByRole('button', { name: 'This prompt is ambiguous' }).click();
  await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();

  await page.goto('/#/collection');
  await page.getByLabel('Filter by progress').selectOption('paused');
  await expect(page.getByText(/Showing 1–1 of 1 matching characters/)).toBeVisible();
  await page.getByRole('link', { name: /日/ }).click();
  await expect(page.getByText(/This card is paused after an ambiguous prompt/i)).toBeVisible();

  await page.getByRole('button', { name: 'Resume this character' }).click();
  await expect(page.getByText(/Pause cleared/)).toBeVisible();
  const dueAfter = await page
    .locator('.character-facts div', { hasText: 'Next review' })
    .locator('dd')
    .textContent();
  expect(dueAfter).toBe(dueBefore);
});

test('after assets load, a complete session works with the network disabled', async ({
  page,
  context,
}) => {
  await enterDojo(page);
  await page.getByRole('link', { name: 'Start practice' }).click();
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Hide and try' }).click();
  await drawStroke(page);
  await page.getByRole('button', { name: 'Compare answer' }).click();
  await gradeGotItDespiteChecker(page);
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish session' }).click();
  await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();
  await expect(page.locator('.metric', { hasText: 'New characters introduced' })).toContainText(
    '2',
  );
  await context.setOffline(false);
});
