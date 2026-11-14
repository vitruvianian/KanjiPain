import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import { createSettingsService } from '../../src/services/settings-service';
import { createDatabase, initializeDatabase } from '../../src/storage/database';
import { InvalidPersistedDataError } from '../../src/storage/errors';
import { catalogEntry, dueCard } from './service-fixtures';

const databaseNames = new Set<string>();

function databaseName(label: string): string {
  const name = `kanjipain-settings-${label}-${crypto.randomUUID()}`;
  databaseNames.add(name);
  return name;
}

afterEach(async () => {
  await Promise.all([...databaseNames].map((name) => Dexie.delete(name)));
  databaseNames.clear();
});

describe('settings service', () => {
  it('persists preferences without touching cards', async () => {
    const name = databaseName('update');
    const database = createDatabase(name);
    await initializeDatabase(database);
    const entry = catalogEntry(0);
    await database.cards.add(dueCard(entry));

    const settings = createSettingsService({ database });
    const updated = await settings.update({ dailyNewLimit: 8, inputMode: 'paper' });

    expect(updated).toMatchObject({
      dailyNewLimit: 8,
      inputMode: 'paper',
      onboardingCompleted: false,
    });
    expect(await database.settings.get('user')).toEqual(updated);
    expect(await database.cards.count()).toBe(1);
    database.close();
  });

  it('keeps onboarding completed once it is set', async () => {
    const name = databaseName('onboarding');
    const database = createDatabase(name);
    await initializeDatabase(database);
    const settings = createSettingsService({ database });

    await settings.update({ onboardingCompleted: true });
    const updated = await settings.update({ dailyNewLimit: 2 });

    expect(updated.onboardingCompleted).toBe(true);
    database.close();
  });

  it('rejects settings outside the schema', async () => {
    const name = databaseName('invalid');
    const database = createDatabase(name);
    await initializeDatabase(database);
    const settings = createSettingsService({ database });

    await expect(settings.update({ dailyNewLimit: 99 })).rejects.toBeInstanceOf(
      InvalidPersistedDataError,
    );
    expect((await database.settings.get('user'))?.dailyNewLimit).toBe(5);
    database.close();
  });

  it('changes limits without resetting the day’s introduction count', async () => {
    const name = databaseName('introductions');
    const database = createDatabase(name);
    await initializeDatabase(database);
    const day = '2027-01-15';
    await database.cards.bulkAdd([
      dueCard(catalogEntry(0), { introducedLocalDay: day }),
      dueCard(catalogEntry(1), { introducedLocalDay: day }),
    ]);

    const settings = createSettingsService({ database });
    await settings.update({ dailyNewLimit: 9 });

    expect(await database.cards.where('introducedLocalDay').equals(day).count()).toBe(2);
    expect(await database.cards.count()).toBe(2);
    database.close();
  });
});
