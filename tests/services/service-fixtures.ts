import { vi } from 'vitest';

import type { Clock } from '../../src/domain/clock';
import type { IdSource } from '../../src/domain/ids';
import type { CatalogManifest, CardRecord, KanjiEntry } from '../../src/domain/types';
import type { StrokeLookup } from '../../src/recognition/load';
import type { SchedulerAdapter } from '../../src/scheduler/types';
import type { CatalogRepository } from '../../src/services/catalog';
import { createDeckService, type DeckService } from '../../src/services/deck-service';
import { DraftSaveQueue } from '../../src/services/draft-save-queue';
import { createReviewService, type ReviewService } from '../../src/services/review-service';
import { createSessionService, type SessionService } from '../../src/services/session-service';
import {
  createDatabase,
  initializeDatabase,
  type KanjiPainDatabase,
} from '../../src/storage/database';
import { createStorageRepositories } from '../../src/storage/repositories';
import { schedulerLog, schedulerState } from '../domain/domain-fixtures';

export const NOW = new Date(2027, 0, 15, 12).getTime();
export const DATASET_VERSION = 'c'.repeat(64);

export class MutableClock implements Clock {
  value = NOW;

  now(): number {
    return this.value;
  }
}

export class SequentialIds implements IdSource {
  #next = 1;

  next(): string {
    const value = `id-${String(this.#next)}`;
    this.#next += 1;
    return value;
  }
}

export function catalogEntry(index: number): KanjiEntry {
  const codePoint = 0x4e00 + index;
  return {
    id: `k-${codePoint.toString(16)}`,
    literal: String.fromCodePoint(codePoint),
    grade: 1,
    meanings: [`meaning ${String(index)}`],
    onReadings: [`オン${String(index)}`],
    kunReadings: [`くん${String(index)}`],
    strokeCount: index + 1,
    frequencyRank: index + 1,
    curriculumOrder: index,
  };
}

const manifest: CatalogManifest = {
  schemaVersion: 1,
  datasetVersion: DATASET_VERSION,
  entryCount: 1,
  generatedAt: NOW,
  catalogSha256: '1'.repeat(64),
  teachingNotesSha256: '2'.repeat(64),
  source: {
    name: 'KANJIDIC2',
    downloadUrl: 'https://example.com/data',
    documentationUrl: 'https://example.com/docs',
    licenseUrl: 'https://example.com/license',
    license: 'CC BY-SA 4.0',
    retrievedAt: NOW,
    upstreamDate: null,
    inputSha256: '3'.repeat(64),
  },
};

export function createTestCatalog(
  entries: readonly KanjiEntry[],
  lookalikes: Readonly<Record<string, readonly string[]>> = {},
): CatalogRepository {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return {
    all: entries,
    orderedIds: entries.map((entry) => entry.id),
    manifest: { ...manifest, entryCount: entries.length },
    teachingNotes: {},
    byId: (id) => byId.get(id),
    lookalikes: (id) => lookalikes[id] ?? [],
  };
}

export function createMockScheduler(): SchedulerAdapter & {
  create: ReturnType<typeof vi.fn<SchedulerAdapter['create']>>;
  review: ReturnType<typeof vi.fn<SchedulerAdapter['review']>>;
} {
  const create = vi.fn<SchedulerAdapter['create']>(({ cardId, now }) => ({
    card: {
      ...schedulerState,
      card: {
        ...schedulerState.card,
        cardId,
        state: 0,
        scheduleStatus: 'new',
        dueAt: now,
        lastReviewAt: null,
        reps: 0,
      },
    },
    dueAt: now,
  }));
  const review = vi.fn<SchedulerAdapter['review']>(({ card, grade, now }) => {
    const dueAt = now + (grade === 'missed' ? 60_000 : 86_400_000);
    return {
      card: {
        ...card,
        card: {
          ...card.card,
          state: grade === 'missed' ? 1 : 2,
          scheduleStatus: grade === 'missed' ? 'learning' : 'review',
          dueAt,
          lastReviewAt: now,
          reps: card.card.reps + 1,
        },
      },
      log: {
        ...schedulerLog,
        revlog: {
          ...schedulerLog.revlog,
          cardId: card.card.cardId,
          reviewTime: now,
          rating: grade === 'got' ? 3 : grade === 'barely' ? 2 : 1,
        },
      },
      dueAt,
    };
  });
  return { create, review };
}

export function dueCard(entry: KanjiEntry, overrides: Partial<CardRecord> = {}): CardRecord {
  const id = `${entry.id}:production`;
  return {
    id,
    kanjiId: entry.id,
    skill: 'production',
    introducedAt: NOW - 10_000,
    introducedLocalDay: '2027-01-14',
    introducedInSessionId: 'older-session',
    dueAt: NOW,
    schedulerState: {
      ...schedulerState,
      card: { ...schedulerState.card, cardId: id, dueAt: NOW },
    },
    scheduledReviewCount: 1,
    suspended: false,
    version: 0,
    ...overrides,
  };
}

/**
 * A small stand-in for the KanjiVG stroke data: every character in the main CJK block is
 * "recognized", with a stroke count derived from its code point; nothing else is.
 */
export const fixtureStrokeLookup: StrokeLookup = (ids) =>
  Promise.resolve(
    new Map(
      ids.flatMap((id): [string, number][] => {
        const codePoint = Number.parseInt(id.slice(2), 16);
        return codePoint >= 0x4e00 && codePoint <= 0x9fff ? [[id, (codePoint % 20) + 1]] : [];
      }),
    ),
  );

export interface ServiceHarness {
  readonly decks: DeckService;
  readonly database: KanjiPainDatabase;
  readonly clock: MutableClock;
  readonly ids: SequentialIds;
  readonly scheduler: ReturnType<typeof createMockScheduler>;
  readonly sessions: SessionService;
  readonly reviews: ReviewService;
  readonly catalog: CatalogRepository;
}

export async function createHarness(
  databaseName: string,
  entries: readonly KanjiEntry[] = [catalogEntry(0)],
  lookalikes: Readonly<Record<string, readonly string[]>> = {},
): Promise<ServiceHarness> {
  const database = createDatabase(databaseName);
  await initializeDatabase(database);
  const clock = new MutableClock();
  const ids = new SequentialIds();
  const scheduler = createMockScheduler();
  const catalog = createTestCatalog(entries, lookalikes);
  const storage = createStorageRepositories(database);
  const draftQueue = new DraftSaveQueue();
  const sessions = createSessionService({
    database,
    storage,
    catalog,
    scheduler,
    clock,
    ids,
    draftQueue,
  });
  const reviews = createReviewService({
    database,
    scheduler,
    clock,
    ids,
    draftQueue,
  });
  const decks = createDeckService({
    database,
    catalog,
    clock,
    ids,
    strokeLookup: fixtureStrokeLookup,
  });
  return { database, clock, ids, scheduler, sessions, reviews, catalog, decks };
}

export async function openDuePrompt(harness: ServiceHarness, entry = catalogEntry(0)) {
  await harness.database.settings.update('user', { dailyNewLimit: 0 });
  await harness.database.cards.put(dueCard(entry));
  const started = await harness.sessions.startOrResumeSession();
  const opened = await harness.sessions.openNextItem(started.id, started.revision);
  return opened.session;
}

export async function revealDrawnPrompt(harness: ServiceHarness) {
  const opened = await openDuePrompt(harness);
  const saved = await harness.sessions.saveDraft(opened.id, opened.revision, {
    strokes: [[{ x: 0.5, y: 0.5 }]],
  });
  return harness.sessions.revealAnswer(saved.id, saved.revision, 'compare');
}
