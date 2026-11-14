import { cardRecordSchema } from '../domain/schemas';
import type { CardRecord } from '../domain/types';
import type { KanjiPainDatabase } from '../storage/database';
import { InvalidPersistedDataError, mapStorageError, StaleRevisionError } from '../storage/errors';

export interface ContentIssueServiceDependencies {
  readonly database: KanjiPainDatabase;
}

export class ContentIssueService {
  readonly #database: KanjiPainDatabase;

  constructor({ database }: ContentIssueServiceDependencies) {
    this.#database = database;
  }

  async resumePausedCard(cardId: string, expectedCardVersion: number): Promise<CardRecord> {
    try {
      return await this.#database.transaction('rw', this.#database.cards, async () => {
        const row = await this.#database.cards.get(cardId);
        if (row === undefined) {
          throw new InvalidPersistedDataError('card');
        }
        const card = cardRecordSchema.parse(row);
        if (card.version !== expectedCardVersion) {
          throw new StaleRevisionError(expectedCardVersion, card.version);
        }
        if (!card.suspended) {
          return card;
        }
        const resumed: CardRecord = {
          ...card,
          suspended: false,
          version: card.version + 1,
        };
        await this.#database.cards.put(resumed);
        return resumed;
      });
    } catch (error) {
      throw mapStorageError(error, 'resuming a paused card');
    }
  }
}

export function createContentIssueService(
  dependencies: ContentIssueServiceDependencies,
): ContentIssueService {
  return new ContentIssueService(dependencies);
}
