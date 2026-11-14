import { settingsRecordSchema } from '../domain/schemas';
import type { InputMode, SettingsRecord } from '../domain/types';
import type { KanjiPainDatabase } from '../storage/database';
import { InvalidPersistedDataError, mapStorageError } from '../storage/errors';

export interface SettingsPatch {
  readonly dailyNewLimit?: number;
  readonly inputMode?: InputMode;
  readonly onboardingCompleted?: boolean;
}

export interface SettingsServiceDependencies {
  readonly database: KanjiPainDatabase;
}

export class SettingsService {
  readonly #database: KanjiPainDatabase;

  constructor({ database }: SettingsServiceDependencies) {
    this.#database = database;
  }

  async update(patch: SettingsPatch): Promise<SettingsRecord> {
    try {
      return await this.#database.transaction('rw', this.#database.settings, async () => {
        const row = await this.#database.settings.get('user');
        if (row === undefined) {
          throw new InvalidPersistedDataError('settings');
        }
        const result = settingsRecordSchema.safeParse({ ...row, ...patch });
        if (!result.success) {
          throw new InvalidPersistedDataError('settings', result.error);
        }
        const next = result.data;
        await this.#database.settings.put(next);
        return next;
      });
    } catch (error) {
      throw mapStorageError(error, 'updating settings');
    }
  }
}

export function createSettingsService(dependencies: SettingsServiceDependencies): SettingsService {
  return new SettingsService(dependencies);
}
