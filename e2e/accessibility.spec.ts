import { expect, test } from './test';

import manifest from '../src/data/catalog-manifest.json' with { type: 'json' };

test('skip navigation moves focus to the main landmark with a visible focus indicator', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to KanjiPain' })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  const outline = await skip.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe('none');

  await page.keyboard.press('Enter');
  await expect
    .poll(async () => page.evaluate(() => document.activeElement?.id ?? ''))
    .toBe('main-content');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
});

test('sources page records attribution, dataset hashes, font license, and app version', async ({
  page,
  request,
}) => {
  await page.goto('/#/sources');
  await expect(page.getByRole('heading', { name: 'Sources & licenses' })).toBeVisible();
  await expect(
    page.getByText(/Electronic Dictionary Research and Development Group/),
  ).toBeVisible();
  await expect(page.getByText(/James William Breen and EDRDG/)).toBeVisible();
  await expect(page.getByText('CC BY-SA 4.0').first()).toBeVisible();

  const download = page.getByRole('link', { name: 'KANJIDIC2 download' });
  await expect(download).toHaveAttribute('href', 'https://www.edrdg.org/kanjidic/kanjidic2.xml.gz');
  await expect(
    page.getByRole('link', { name: 'KANJIDIC2 documentation', exact: true }),
  ).toHaveAttribute('href', 'https://www.edrdg.org/wiki/KANJIDIC_Project.html');
  await expect(page.getByRole('link', { name: 'EDRDG dictionary license' })).toHaveAttribute(
    'href',
    'https://www.edrdg.org/edrdg/licence.html',
  );

  for (const hash of [
    manifest.datasetVersion,
    manifest.catalogSha256,
    manifest.teachingNotesSha256,
    manifest.source.inputSha256,
  ]) {
    await expect(page.getByText(hash, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('2,136 Jōyō characters')).toBeVisible();
  await expect(page.getByText('Transformation notice')).toBeVisible();
  await expect(page.getByText(/selects entries whose KANJIDIC2 grade is 1–6 or 8/)).toBeVisible();

  await expect(page.getByText('Noto Sans JP').first()).toBeVisible();
  await expect(page.getByText(/SIL Open Font License 1.1/)).toBeVisible();
  await expect(page.getByText('Application version:')).toBeVisible();
  await expect(page.getByText('0.1.0', { exact: true })).toBeVisible();

  const licenseLinks = page.getByRole('link', {
    name: /Bundled (KANJIDIC2 documentation|EDRDG license|Noto Sans JP license) copy|Bundled Noto Sans JP license/,
  });
  await expect(licenseLinks).toHaveCount(3);
  for (const href of [
    '/licenses/kanjidic2-documentation.html',
    '/licenses/kanjidic2-license.html',
    '/licenses/noto-sans-jp-license.txt',
  ]) {
    const response = await request.get(href);
    expect(response.status()).toBe(200);
  }
});

test('Japanese text uses the bundled Noto Sans JP face and the page stays phone-width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/#/sources');
  const sample = page.locator('.japanese-sample');
  await expect(sample).toHaveAttribute('lang', 'ja');
  await expect(sample).toHaveText('漢字を書いて覚える');

  const fontFamily = await sample.evaluate((element) => getComputedStyle(element).fontFamily);
  expect(fontFamily).toContain('Noto Sans JP');
  expect(await page.evaluate(() => document.fonts.check('16px "Noto Sans JP"', '漢字'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);

  await page.goto('/#/collection');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await page.goto('/#/kanji/k-6e56');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});

test('footer links to sources on every non-practice screen only', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByRole('link', { name: 'Sources & licenses' })).toBeVisible();
  await page.getByRole('link', { name: 'Sources & licenses' }).click();
  await expect(page.getByRole('heading', { name: 'Sources & licenses' })).toBeVisible();

  await page.goto('/#/practice');
  await expect(page.getByRole('contentinfo')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sources & licenses' })).toHaveCount(0);
});
