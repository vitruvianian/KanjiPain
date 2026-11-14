import { expect, test } from './test';

test('hash routes, active navigation, direct reload, and not-found work at 360px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to KanjiPain' })).toBeVisible();
  await page.getByRole('button', { name: 'Enter the Dojo' }).click();
  await expect(page.getByRole('heading', { name: 'Dojo', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Collection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Collection', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await page.goto('/#/practice');
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'KanjiPain home' })).toHaveCount(0);
  await page.goto('/#/not-a-route');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Return to the Dojo' }).click();
  await expect(page.getByRole('heading', { name: 'Dojo', exact: true })).toBeVisible();
});
