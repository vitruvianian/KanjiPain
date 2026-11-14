import { expect, test } from './test';

import { importBackup } from './helpers';

test('loads the real 2,136-character catalog, searches before paging, and pages at 120', async ({
  page,
}) => {
  await page.goto('/#/collection');
  await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible();
  await expect(page.getByText(/Browse all 2,136 Jōyō characters/)).toBeVisible();
  await expect(page.getByText(/Showing 1–120 of 2136 matching characters/)).toBeVisible();
  await expect(page.getByText('Page 1 of 18')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Characters' }).getByRole('link')).toHaveCount(120);

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Page 2 of 18')).toBeVisible();
  await expect(page.getByText(/Showing 121–240 of 2136 matching characters/)).toBeVisible();

  const search = page.getByLabel('Search characters');
  await search.fill('eat');
  await expect(page.getByText(/matching characters/)).toContainText(/Showing 1–/);
  await expect(page.getByRole('link', { name: /食/ })).toBeVisible();

  await search.fill('湖');
  await expect(page.getByText(/Showing 1–1 of 1 matching characters/)).toBeVisible();
  const lake = page.getByRole('link', { name: /湖/ });
  await expect(lake).toHaveAttribute('href', '#/kanji/k-6e56');

  for (const query of ['lake', 'みずうみ', 'ミズウミ']) {
    await search.fill(query);
    await expect(page.getByRole('link', { name: /湖/ })).toBeVisible();
  }

  await page.getByRole('link', { name: /湖/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: '湖' })).toBeVisible();
  await expect(page.getByText('lake')).toBeVisible();
  await expect(page.getByText('コ')).toBeVisible();
  await expect(page.getByText('みずうみ')).toBeVisible();
  await expect(page.getByText(/Not introduced yet/)).toBeVisible();
  await expect(page.getByText('No review events yet.')).toBeVisible();

  await page.goto('/#/collection');
  await search.fill('not-a-real-meaning');
  await expect(page.getByRole('heading', { name: 'No characters match' })).toBeVisible();
  await expect(page.getByText('No matching characters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search and filters' }).click();
  await expect(page.getByText(/Showing 1–120 of 2136/)).toBeVisible();
});

test('reflects imported progress through status filters and character details', async ({
  page,
}) => {
  await importBackup(page, 'progress-backup.json');
  await page.goto('/#/collection');

  await page.getByLabel('Filter by progress').selectOption('due');
  await expect(page.getByText(/Showing 1–4 of 4 matching characters/)).toBeVisible();
  const dueLinks = page.getByRole('list', { name: 'Characters' }).getByRole('link');
  await expect(dueLinks).toHaveCount(4);
  await expect(dueLinks.first()).toContainText('Due');

  await page.getByLabel('Filter by progress').selectOption('paused');
  await expect(page.getByText(/Showing 1–1 of 1 matching characters/)).toBeVisible();
  const paused = page.getByRole('list', { name: 'Characters' }).getByRole('link');
  await expect(paused).toHaveCount(1);
  await expect(paused).toContainText('大');
  await expect(paused).toContainText('Paused');

  await page.getByLabel('Filter by progress').selectOption('unseen');
  await expect(page.getByText(/of 2131 matching characters/)).toBeVisible();

  await page.goto('/#/kanji/k-65e5');
  await expect(page.getByRole('heading', { level: 1, name: '日' })).toBeVisible();
  await expect(page.getByText('Developing')).toBeVisible();
  await expect(page.getByText(/Due now/)).toBeVisible();
  await expect(page.getByText('Scheduled reviews', { exact: true })).toBeVisible();
  await expect(page.getByText('Scheduled review', { exact: true })).toBeVisible();
  await expect(page.getByText('Got it')).toBeVisible();
  await expect(page.getByText(/Drawing · Unassisted/)).toBeVisible();

  await page.goto('/#/kanji/k-5927');
  await expect(page.getByRole('heading', { level: 1, name: '大' })).toBeVisible();
  await expect(page.getByText(/This card is paused after an ambiguous prompt/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume this character' })).toBeVisible();
});

test('unknown character addresses and empty states stay explicit', async ({ page }) => {
  await page.goto('/#/kanji/k-ffff');
  await expect(page.getByRole('heading', { name: 'Character not found' })).toBeVisible();
  await expect(page.getByText(/stable ASCII IDs/)).toBeVisible();
  await page.getByRole('link', { name: 'Return to the collection' }).click();
  await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible();
});
