import Dexie from 'dexie';
import { afterEach } from 'vitest';

import type { IdSource } from '../../src/domain/ids';
import type { SessionRecord } from '../../src/domain/session-types';
import type { Grade } from '../../src/domain/types';
import { initializeFsrsAdapter } from '../../src/scheduler/fsrs-adapter';
import { createBackupService } from '../../src/services/backup-service';
import { createDeckService } from '../../src/services/deck-service';
import { DraftSaveQueue } from '../../src/services/draft-save-queue';
import { createReviewService } from '../../src/services/review-service';
import { createSessionService } from '../../src/services/session-service';
import { createSettingsService } from '../../src/services/settings-service';
import { createSyncEngine } from '../../src/services/sync/sync-engine';
import { createDatabase, initializeDatabase } from '../../src/storage/database';
import { createStorageRepositories } from '../../src/storage/repositories';
import {
  catalogEntry,
  createTestCatalog,
  fixtureStrokeLookup,
  MutableClock,
} from './service-fixtures';

/**
 * Whole devices for tests that need the real scheduler: each has its own database, clock and
 * IDs. Importing this file registers the clean-up of every database it opens.
 */
export const DAY = 86_400_000;
const opened: { readonly name: string; readonly database: Dexie }[] = [];

afterEach(async () => {
  for (const item of opened.splice(0)) {
    item.database.close();
    await Dexie.delete(item.name);
  }
});

/** One device: its own database, clock and IDs, signed in to `userId`. */
export async function device(label: string, userId = 'user-1') {
  const name = `sync-${label}-${crypto.randomUUID()}`;
  const database = createDatabase(name);
  await initializeDatabase(database);
  opened.push({ name, database });
  let counter = 0;
  const ids: IdSource = {
    next: () => {
      counter += 1;
      return `${label}-${String(counter)}`;
    },
  };
  const clock = new MutableClock();
  const catalog = createTestCatalog([catalogEntry(0), catalogEntry(1), catalogEntry(2)]);
  const scheduler = await initializeFsrsAdapter();
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
  const reviews = createReviewService({ database, scheduler, clock, ids, draftQueue });
  const decks = createDeckService({
    database,
    catalog,
    clock,
    ids,
    strokeLookup: fixtureStrokeLookup,
  });
  const backup = createBackupService({ database, catalog, clock, ids });
  const settings = createSettingsService({ database, scheduler, clock });
  const engine = createSyncEngine({ database, scheduler, clock, ids });
  await engine.link(userId);
  return { database, clock, sessions, reviews, decks, backup, engine, settings, scheduler };
}

export type Device = Awaited<ReturnType<typeof device>>;

/** Answers the next exercise of the open session and returns the session afterwards. */
export async function answerNext(current: Device, grade: Grade = 'got'): Promise<SessionRecord> {
  let session = await current.sessions.startOrResumeSession();
  if (session.status !== 'active') {
    return session;
  }
  // `true` accepts a rematch that comes sooner than usual when nothing else is left.
  session = (await current.sessions.openNextItem(session.id, session.revision, true)).session;
  if (session.phase.kind === 'introduction') {
    session = await current.sessions.hideIntroduction(session.id, session.revision);
  }
  if (session.phase.kind !== 'prompt') {
    return session;
  }
  session = await current.sessions.saveDraft(session.id, session.revision, {
    strokes: [[{ x: 0.5, y: 0.5 }]],
  });
  session = await current.sessions.revealAnswer(session.id, session.revision, 'compare');
  if (session.phase.kind !== 'feedback') {
    throw new Error('The exercise did not reach feedback.');
  }
  session = (
    await current.reviews.commitGrade({
      sessionId: session.id,
      attemptId: session.phase.draft.id,
      expectedRevision: session.revision,
      expectedCardVersion: session.phase.expectedCardVersion,
      grade,
    })
  ).session;
  if (session.phase.kind === 'repair') {
    session = await current.sessions.finishRepair(session.id, session.revision);
  }
  return session;
}

/** Works through a whole session: every planned exercise, answered with `grade`. */
export async function practice(current: Device, grade: Grade = 'got'): Promise<SessionRecord> {
  let session = await answerNext(current, grade);
  while (session.status === 'active') {
    current.clock.value += 1_000;
    session = await answerNext(current, grade);
  }
  return session;
}
