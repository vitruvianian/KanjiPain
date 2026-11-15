import { systemClock, type Clock } from '../domain/clock';
import { settingsRecordSchema } from '../domain/schemas';
import { reconcileActiveSession, rescheduleCard } from '../domain/sync-merge';
import type {
  CardRecord,
  InputMode,
  ReviewEvent,
  ReviewPace,
  SettingsRecord,
} from '../domain/types';
import type { SchedulerAdapter } from '../scheduler/types';
import type { KanjiPainDatabase } from '../storage/database';
import { InvalidPersistedDataError, mapStorageError } from '../storage/errors';

export interface SettingsPatch {
  readonly dailyNewLimit?: number;
  readonly inputMode?: InputMode;
  readonly onboardingCompleted?: boolean;
}

export interface ReviewPaceChange {
  readonly settings: SettingsRecord;
  /** How many learned characters had their next review moved. */
  readonly rescheduled: number;
}

export interface SettingsServiceDependencies {
  readonly database: KanjiPainDatabase;
  /** Needed to change the review pace; other settings work without it. */
  readonly scheduler?: SchedulerAdapter;
  readonly clock?: Clock;
}

export class SettingsService {
  readonly #database: KanjiPainDatabase;
  readonly #scheduler: SchedulerAdapter | undefined;
  readonly #clock: Clock;

  constructor({ database, scheduler, clock = systemClock }: SettingsServiceDependencies) {
    this.#database = database;
    this.#scheduler = scheduler;
    this.#clock = clock;
  }

  /**
   * Changes how soon characters come back, and moves the next review of every character
   * already learned to where the new pace puts it. Review history and what the scheduler
   * knows about each character stay as they are; only the dates move. Paused characters
   * keep their dates. All of it happens in one transaction.
   */
  async setReviewPace(pace: ReviewPace): Promise<ReviewPaceChange> {
    const scheduler = this.#scheduler;
    if (scheduler === undefined) {
      throw new Error('The review pace cannot be changed without a scheduler.');
    }
    const now = this.#clock.now();
    try {
      return await this.#database.transaction(
        'rw',
        this.#database.settings,
        this.#database.cards,
        this.#database.events,
        this.#database.sessions,
        async () => {
          const row = await this.#database.settings.get('user');
          const result = settingsRecordSchema.safeParse({ ...row, reviewPace: pace });
          if (row === undefined || !result.success) {
            throw new InvalidPersistedDataError('settings', result.error);
          }
          if (row.reviewPace === pace) {
            return { settings: result.data, rescheduled: 0 };
          }
          await this.#database.settings.put(result.data);

          const eventsByCard = new Map<string, ReviewEvent[]>();
          for (const event of await this.#database.events.toArray()) {
            const list = eventsByCard.get(event.cardId);
            if (list === undefined) {
              eventsByCard.set(event.cardId, [event]);
            } else {
              list.push(event);
            }
          }
          const moved = new Map<string, CardRecord>();
          for (const card of await this.#database.cards.toArray()) {
            if (card.suspended) continue;
            const next = rescheduleCard(card, eventsByCard.get(card.id) ?? [], scheduler, pace);
            if (next !== card) {
              moved.set(card.id, next);
            }
          }
          await this.#database.cards.bulkPut([...moved.values()]);

          // An open session drops reviews that are no longer due and keeps the rest.
          const active = await this.#database.sessions.where('status').equals('active').first();
          if (active !== undefined) {
            const reconciled = reconcileActiveSession(active, moved, now);
            if (reconciled !== active) {
              await this.#database.sessions.put(reconciled);
            }
          }
          return { settings: result.data, rescheduled: moved.size };
        },
      );
    } catch (error) {
      throw mapStorageError(error, 'changing the review pace');
    }
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
