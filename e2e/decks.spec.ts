import { expect, test } from './test';

import { drawLine, drawStroke, enterDojo } from './helpers';

test('a custom deck: paste, warn about an unrecognized character, practise, share progress', async ({
  page,
}) => {
  await enterDojo(page);
  await page.getByRole('link', { name: 'Decks', exact: true }).click();
  await expect(page.getByText(/2,136 characters · read-only/)).toBeVisible();

  await page.getByLabel('Deck name').fill('Winter');
  await page.getByRole('button', { name: 'Create deck' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Winter' })).toBeVisible();

  // ☃ has no stroke data; 一 is also in the Standard deck.
  await page.getByLabel('Paste characters').fill('☃一');
  await page.getByRole('button', { name: 'Preview pasted characters' }).click();
  const preview = page.getByRole('region', { name: 'Review this import' });
  await expect(preview.getByText(/1 character is not recognized/)).toBeVisible();
  await expect(preview.getByText('1 stroke', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Add 2 characters' }).click();
  await expect(page.getByText('Import saved: 2 added, 0 merged.')).toBeVisible();
  await expect(page.getByText(/1 character without stroke data/)).toBeVisible();

  for (const [literal, meaning] of [
    ['☃', 'snowman'],
    ['一', 'one line'],
  ] as const) {
    await page.getByRole('button', { name: `Edit ${literal}` }).click();
    const editor = page.getByRole('form', { name: `Edit ${literal}` });
    await editor.getByLabel(/Meanings/).fill(meaning);
    await editor.getByRole('button', { name: 'Save entry' }).click();
    await expect(page.getByText(`Saved ${literal}.`)).toBeVisible();
  }

  await page.getByRole('button', { name: 'Use this deck' }).click();
  await page.getByRole('link', { name: 'Practise in the Dojo' }).click();
  await expect(page.getByLabel('Active deck')).toHaveValue(/.+/);
  await expect(page.getByText(/plans 2 primary exercises/)).toBeVisible();
  await page.getByRole('link', { name: 'Start practice' }).click();

  // The unrecognized character: a warning instead of stroke order, and plain self-grading.
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
  await expect(page.locator('.practice-deck')).toContainText('Winter');
  await expect(page.locator('.glyph')).toHaveText('☃');
  await expect(page.getByText(/Not recognized: stroke order and automatic checking/)).toBeVisible();
  await page.getByRole('button', { name: 'Hide and try' }).click();
  await expect(page.getByText('snowman')).toBeVisible();
  await drawStroke(page);
  await page.getByRole('button', { name: 'Compare answer' }).click();
  await expect(page.getByRole('heading', { name: 'The character was' })).toBeVisible();
  await expect(page.getByText(/Not recognized: stroke order and automatic checking/)).toBeVisible();
  await expect(page.getByText(/Suggested grade/)).toHaveCount(0);
  await expect(page.getByText(/The app cannot judge this attempt/)).toBeVisible();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();

  // The recognized character keeps its stroke order and the automatic check.
  await expect(page.locator('.glyph')).toHaveText('一');
  await expect(page.getByRole('img', { name: /Stroke order animation for 一/ })).toBeVisible();
  await page.getByRole('button', { name: 'Hide and try' }).click();
  await expect(page.getByText('one line')).toBeVisible();
  await drawLine(page, [
    [0.15, 0.5],
    [0.85, 0.5],
  ]);
  await page.getByRole('button', { name: 'Compare answer' }).click();
  await expect(page.getByText('This matches 一.')).toBeVisible();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Session summary' })).toBeVisible();

  // Progress is shared: 一 learned in the custom deck is no longer unseen in the Standard deck.
  await page.goto('/#/collection');
  await expect(page.getByText(/Showing 1–2 of 2 matching characters/)).toBeVisible();
  await page.getByLabel('Deck').selectOption({ label: 'Standard (Jōyō)' });
  await expect(page.getByText(/Showing 1–120 of 2136 matching characters/)).toBeVisible();
  await page.getByLabel('Search characters').fill('一');
  const tile = page.getByRole('list', { name: 'Characters' }).getByRole('link');
  await expect(tile).toHaveCount(1);
  await expect(tile).not.toContainText('Unseen');

  // Deleting the deck keeps the progress: ☃ is now a character outside every deck.
  await page.goto('/#/decks');
  await page.getByRole('link', { name: 'Open and edit' }).click();
  await page.getByRole('button', { name: 'Delete deck…' }).click();
  await page.getByRole('button', { name: 'Yes, delete this deck' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Decks' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open and edit' })).toHaveCount(0);
  await page.goto('/#/collection');
  await page.getByLabel('Deck').selectOption({ label: 'Characters not in any deck' });
  await expect(page.getByText(/Showing 1–1 of 1 matching characters/)).toBeVisible();
  await expect(page.getByRole('link', { name: /☃/ })).toBeVisible();
});
