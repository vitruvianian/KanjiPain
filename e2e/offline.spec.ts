import { expect, test } from './test';

import { enterDojo } from './helpers';

test.use({ serviceWorkers: 'allow' });

test('once opened, the app starts again with no network', async ({ page, context }) => {
  await enterDojo(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Dojo', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Start practice' }).click();
  await expect(page.getByRole('heading', { name: 'Meet the character' })).toBeVisible();
  await expect(page.getByTestId('answer-glyph')).toBeVisible();
  await context.setOffline(false);
});

test('the app can be installed: manifest and icons are served', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).not.toBeNull();
  const manifest = (await (await request.get(href ?? '')).json()) as {
    name: string;
    icons: { src: string }[];
  };
  expect(manifest.name).toBe('KanjiPain');
  for (const icon of manifest.icons) {
    expect((await request.get(new URL(icon.src, new URL(href ?? '', page.url())).href)).ok()).toBe(
      true,
    );
  }
});
