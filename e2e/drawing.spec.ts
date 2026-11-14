import type { Page } from '@playwright/test';

import { expect, test } from './test';

async function surfaceBounds(page: Page) {
  const bounds = await page.getByRole('img', { name: 'Kanji drawing area' }).boundingBox();
  if (bounds === null) throw new Error('Drawing surface unavailable.');
  return bounds;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser-fixture/index.html');
});

test('mouse capture commits on release, clamps outside points, and supports undo/clear/freeze', async ({
  page,
}) => {
  const bounds = await surfaceBounds(page);
  await page.mouse.move(bounds.x + bounds.width / 4, bounds.y + bounds.height / 4);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width + 30, bounds.y + bounds.height / 2, { steps: 5 });
  await expect(page.getByTestId('strokes')).toHaveText('[]');
  await page.mouse.up();
  await expect(page.getByTestId('completed-strokes').locator('path')).toHaveCount(1);
  await expect(page.getByTestId('strokes')).toContainText('"x":1');
  await page.mouse.click(bounds.x + 50, bounds.y + 50);
  await expect(page.getByTestId('completed-strokes').locator('circle')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('completed-strokes').locator('circle')).toHaveCount(0);
  const snapshot = await page.getByTestId('strokes').textContent();
  await page.getByRole('button', { name: 'Freeze', exact: true }).click();
  await page.mouse.click(bounds.x + 40, bounds.y + 40);
  await expect(page.getByTestId('strokes')).toHaveText(snapshot ?? '');
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Unfreeze', exact: true }).click();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByTestId('strokes')).toHaveText('[]');
});

test('normalized drawing retains proportions at 360px without page overflow', async ({ page }) => {
  const bounds = await surfaceBounds(page);
  await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.75);
  await page.mouse.up();
  const path = page.getByTestId('completed-strokes').locator('path');
  const saved = JSON.parse((await page.getByTestId('strokes').textContent()) ?? '[]') as {
    x: number;
    y: number;
  }[][];
  expect(saved[0]?.map(({ x, y }) => [x, y])).toEqual([
    [0.25, 0.25],
    [0.75, 0.75],
  ]);
  const outline = await path.getAttribute('d');
  expect(outline).toMatch(/^M[\d.]+ [\d.]+ Q.+Z$/);
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(path).toHaveAttribute('d', outline ?? '');
  const resized = await surfaceBounds(page);
  expect(resized.width).toBeLessThanOrEqual(328);
  expect(resized.width).toBe(resized.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});

test('touch capture suppresses canvas scrolling and cancellation discards only the partial stroke', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 360, height: 500 });
  const bounds = await surfaceBounds(page);
  const cdp = await context.newCDPSession(page);
  const point = { x: bounds.x + 40, y: bounds.y + 40, id: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...point, y: point.y + 80 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByTestId('completed-strokes').locator('path')).toHaveCount(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const saved = await page.getByTestId('strokes').textContent();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...point, x: point.x + 80 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(page.getByTestId('strokes')).toHaveText(saved ?? '');
  await expect(page.locator('svg path')).toHaveCount(1);
});

test('pen pointer drawing uses the same captured stroke path', async ({ page, context }) => {
  const bounds = await surfaceBounds(page);
  const cdp = await context.newCDPSession(page);
  const position = { x: bounds.x + 60, y: bounds.y + 60, pointerType: 'pen' as const };
  await cdp.send('Input.dispatchMouseEvent', {
    ...position,
    type: 'mousePressed',
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    ...position,
    x: position.x + 80,
    type: 'mouseMoved',
    buttons: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    ...position,
    x: position.x + 80,
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
  });
  await expect(page.getByTestId('completed-strokes').locator('path')).toHaveCount(1);
});

test('ignores a second touch while one stroke owns pointer capture', async ({ page, context }) => {
  const bounds = await surfaceBounds(page);
  const cdp = await context.newCDPSession(page);
  const first = { x: bounds.x + 40, y: bounds.y + 40, id: 1 };
  const second = { x: bounds.x + 120, y: bounds.y + 120, id: 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, second] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [first, { ...second, x: second.x + 80 }],
  });
  await expect(page.getByTestId('strokes')).toHaveText('[]');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByTestId('completed-strokes').locator('circle')).toHaveCount(1);
  await expect(page.getByTestId('completed-strokes').locator('path')).toHaveCount(0);
});

test('bounds committed gestures at 100 strokes and 20,000 points', async ({ page }) => {
  await page.getByRole('button', { name: 'Load near stroke limit' }).click();
  await page.getByRole('img').scrollIntoViewIfNeeded();
  let bounds = await surfaceBounds(page);
  await page.mouse.click(bounds.x + 40, bounds.y + 40);
  await page.mouse.click(bounds.x + 80, bounds.y + 80);
  await expect(page.getByTestId('completed-strokes').locator('circle')).toHaveCount(100);
  await expect(page.getByRole('status')).toContainText('Drawing limit reached');
  await page.getByRole('button', { name: 'Load near point limit' }).click();
  await page.getByRole('img').scrollIntoViewIfNeeded();
  bounds = await surfaceBounds(page);
  await page.mouse.move(bounds.x + 40, bounds.y + 40);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 100, bounds.y + 100, { steps: 5 });
  await page.mouse.up();
  const serialized = await page.getByTestId('strokes').textContent();
  const points = (serialized?.match(/"x":/g) ?? []).length;
  expect(points).toBe(20_000);
  await expect(page.getByRole('status')).toContainText('Drawing limit reached');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('status')).toBeEmpty();
});

test('paper mode and modal dialog work with the keyboard, restoring focus on Escape', async ({
  page,
}) => {
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name: 'Paper mode', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name: 'I wrote it on paper' })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox', { name: 'I wrote it on paper' })).toBeChecked();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Input help' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeFocused();
});
