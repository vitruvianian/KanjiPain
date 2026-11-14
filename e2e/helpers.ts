import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import type { SessionRecord } from '../src/domain/session-types';
import { sessionRecordSchema } from '../src/domain/schemas';

export async function setDailyNewLimit(page: Page, limit: number): Promise<void> {
  await page.goto('/#/settings');
  await page.getByLabel('New characters per day').selectOption(String(limit));
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText(/Preferences saved/)).toBeVisible();
}

// Read-only test observation of committed data, never a production debug API.
export async function storedActiveSession(page: Page): Promise<SessionRecord | undefined> {
  const rows = await page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('kanjipain');
        open.onerror = () => {
          reject(new Error('Could not read the test database.', { cause: open.error }));
        };
        open.onsuccess = () => {
          const database = open.result;
          const transaction = database.transaction('sessions', 'readonly');
          const request = transaction.objectStore('sessions').getAll();
          transaction.oncomplete = () => {
            database.close();
            resolve(request.result);
          };
          transaction.onabort = () => {
            database.close();
            reject(new Error('Test database read aborted.', { cause: transaction.error }));
          };
        };
      }),
  );
  return sessionRecordSchema
    .array()
    .parse(rows)
    .find((session) => session.status === 'active');
}

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

export async function enterDojo(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to KanjiPain' })).toBeVisible();
  await page.getByRole('button', { name: 'Enter the Dojo' }).click();
  await expect(page.getByRole('heading', { name: 'Dojo', exact: true })).toBeVisible();
}

export async function importBackupFile(page: Page, filePath: string): Promise<void> {
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByLabel('Choose a backup file').setInputFiles(filePath);
  await expect(page.getByRole('heading', { name: 'Review this backup' })).toBeVisible();
  await page.getByRole('button', { name: 'Replace current progress' }).click();
  await expect(page.getByText(/Backup restored:/)).toBeVisible();
}

export async function importBackup(page: Page, fixtureName: string): Promise<void> {
  await importBackupFile(page, fixturePath(fixtureName));
}

export async function drawStroke(page: Page): Promise<void> {
  const surface = page.getByRole('img', { name: 'Kanji drawing area' });
  const bounds = await surface.boundingBox();
  if (bounds === null) {
    throw new Error('Drawing surface is unavailable.');
  }
  await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.7, {
    steps: 6,
  });
  await page.mouse.up();
}

export async function completePaperAttempt(page: Page): Promise<void> {
  await page.getByRole('radio', { name: 'Write on paper' }).check();
  await page.getByRole('checkbox', { name: 'I wrote it on paper' }).check();
  await page.getByRole('button', { name: 'Compare answer' }).click();
  await expect(page.getByRole('heading', { name: 'The character was' })).toBeVisible();
}

export async function gradeVisibleFeedback(
  page: Page,
  grade: 'Got it' | 'Barely' | 'Missed it',
): Promise<void> {
  const button = page.getByRole('button', { name: grade, exact: true });
  if (await button.isVisible()) {
    await button.click();
  } else {
    await page.getByRole('button', { name: 'Continue — practice again' }).click();
  }
  await expect(page.getByRole('heading', { name: 'The character was' })).not.toBeVisible();
}

/** Grades a deliberately wrong test drawing as correct, through the checker's confirmation. */
export async function gradeGotItDespiteChecker(page: Page): Promise<void> {
  await expect(page.getByText('Suggested grade: Missed it.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, the checker is wrong' }).click();
}

/** Draws straight segments through points given as fractions of the drawing area. */
export async function drawLine(
  page: Page,
  points: readonly (readonly [number, number])[],
): Promise<void> {
  const surface = page.getByRole('img', { name: 'Kanji drawing area' });
  // The pad can start below the fold; pointer input outside the viewport is dropped.
  await surface.scrollIntoViewIfNeeded();
  const bounds = await surface.boundingBox();
  const [first, ...rest] = points;
  if (bounds === null || first === undefined) {
    throw new Error('Drawing surface is unavailable.');
  }
  const at = ([x, y]: readonly [number, number]) =>
    [bounds.x + bounds.width * x, bounds.y + bounds.height * y] as const;
  await page.mouse.move(...at(first));
  await page.mouse.down();
  for (const point of rest) {
    await page.mouse.move(...at(point), { steps: 6 });
  }
  await page.mouse.up();
}
