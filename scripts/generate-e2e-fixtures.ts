import 'fake-indexeddb/auto';

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';

import type { Clock } from '../src/domain/clock';
import type { IdSource } from '../src/domain/ids';
import type { SessionRecord } from '../src/domain/session-types';
import { initializeFsrsAdapter } from '../src/scheduler/fsrs-adapter';
import { createBackupService } from '../src/services/backup-service';
import { loadBundledCatalog, type CatalogRepository } from '../src/services/catalog';
import { DraftSaveQueue } from '../src/services/draft-save-queue';
import { createReviewService, type ReviewService } from '../src/services/review-service';
import { createSessionService, type SessionService } from '../src/services/session-service';
import {
  createDatabase,
  initializeDatabase,
  type KanjiPainDatabase,
} from '../src/storage/database';
import { createStorageRepositories } from '../src/storage/repositories';

const FIXTURE_TIME = Date.UTC(2020, 0, 1, 12, 0, 0);
const OUTPUT_DIRECTORY = resolve('e2e/fixtures');
// Fixture local-day keys must be identical on every maintainer's machine.
process.env.TZ = 'UTC';

class FixedClock implements Clock {
  now(): number {
    return FIXTURE_TIME;
  }
}

class SequentialIdSource implements IdSource {
  #next = 1;

  next(): string {
    const value = `fixture-${String(this.#next)}`;
    this.#next += 1;
    return value;
  }
}

interface FixtureHarness {
  readonly database: KanjiPainDatabase;
  readonly sessions: SessionService;
  readonly reviews: ReviewService;
  readonly catalog: CatalogRepository;
  readonly backup: ReturnType<typeof createBackupService>;
}

async function createHarness(name: string): Promise<FixtureHarness> {
  const catalog = loadBundledCatalog();
  const scheduler = await initializeFsrsAdapter();
  const database = createDatabase(name);
  await initializeDatabase(database);
  const storage = createStorageRepositories(database);
  const draftQueue = new DraftSaveQueue();
  const clock = new FixedClock();
  const ids = new SequentialIdSource();
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
  const backup = createBackupService({ database, catalog, clock });
  return { database, sessions, reviews, catalog, backup };
}

async function openIntroduction(harness: FixtureHarness, session: SessionRecord) {
  const opened = await harness.sessions.openNextItem(session.id, session.revision);
  if (opened.session.phase.kind !== 'introduction') {
    throw new Error('Fixture expected a new-character introduction.');
  }
  return opened.session;
}

async function revealIntroduction(harness: FixtureHarness, session: SessionRecord) {
  const prompt = await harness.sessions.hideIntroduction(session.id, session.revision);
  if (prompt.phase.kind !== 'prompt') {
    throw new Error('Fixture expected a prompt.');
  }
  const saved = await harness.sessions.saveDraft(prompt.id, prompt.revision, {
    strokes: [[{ x: 0.3, y: 0.4 }]],
  });
  const feedback = await harness.sessions.revealAnswer(saved.id, saved.revision, 'compare');
  if (feedback.phase.kind !== 'feedback') {
    throw new Error('Fixture expected feedback.');
  }
  return feedback;
}

async function gradeIntroduction(
  harness: FixtureHarness,
  session: SessionRecord,
  grade: 'got' | 'missed',
): Promise<SessionRecord> {
  const introduction = await openIntroduction(harness, session);
  const feedback = await revealIntroduction(harness, introduction);
  if (feedback.phase.kind !== 'feedback') {
    throw new Error('Fixture expected feedback.');
  }
  const result = await harness.reviews.commitGrade({
    sessionId: feedback.id,
    attemptId: feedback.phase.draft.id,
    expectedRevision: feedback.revision,
    expectedCardVersion: feedback.phase.expectedCardVersion,
    grade,
  });
  return result.session;
}

async function pauseIntroduction(
  harness: FixtureHarness,
  session: SessionRecord,
): Promise<SessionRecord> {
  const introduction = await openIntroduction(harness, session);
  const feedback = await revealIntroduction(harness, introduction);
  if (feedback.phase.kind !== 'feedback') {
    throw new Error('Fixture expected feedback.');
  }
  const flagged = await harness.reviews.flagAmbiguous({
    sessionId: feedback.id,
    attemptId: feedback.phase.draft.id,
    expectedRevision: feedback.revision,
    expectedCardVersion: feedback.phase.expectedCardVersion,
  });
  const next = await harness.sessions.openNextItem(flagged.session.id, flagged.session.revision);
  return next.session;
}

async function applyExportSettings(harness: FixtureHarness): Promise<void> {
  await harness.database.settings.update('user', {
    dailyNewLimit: 0,
    inputMode: 'drawing',
    onboardingCompleted: true,
  });
}

async function writeBackup(harness: FixtureHarness, filename: string): Promise<void> {
  const json = await harness.backup.exportJson();
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const outputPath = join(OUTPUT_DIRECTORY, filename);
  const options = await resolveConfig(outputPath);
  await writeFile(outputPath, await format(json, { ...options, parser: 'json' }), 'utf8');
  harness.database.close();
}

async function buildProgressBackup(): Promise<void> {
  const harness = await createHarness(`kanjipain-fixture-progress-${String(Date.now())}`);
  await harness.database.settings.update('user', {
    dailyNewLimit: 5,
    onboardingCompleted: true,
  });

  let session = await harness.sessions.startOrResumeSession();
  for (let index = 0; index < 4; index += 1) {
    session = await gradeIntroduction(harness, session, 'got');
  }
  await harness.sessions.finishSession(session.id, session.revision);

  session = await harness.sessions.startOrResumeSession();
  await pauseIntroduction(harness, session);

  const cards = await harness.database.cards.toArray();
  const paused = cards.find(
    (card) => harness.catalog.byId(card.kanjiId)?.literal === '大' && card.suspended,
  );
  if (paused === undefined) {
    throw new Error('Fixture failed to create a paused card.');
  }

  await applyExportSettings(harness);
  await writeBackup(harness, 'progress-backup.json');
}

async function buildSingleDueBackup(): Promise<void> {
  const harness = await createHarness(`kanjipain-fixture-single-${String(Date.now())}`);
  await harness.database.settings.update('user', {
    dailyNewLimit: 1,
    onboardingCompleted: true,
  });

  const session = await harness.sessions.startOrResumeSession();
  const graded = await gradeIntroduction(harness, session, 'got');
  await harness.sessions.finishSession(graded.id, graded.revision);

  await applyExportSettings(harness);
  await writeBackup(harness, 'single-due-backup.json');
}

await buildProgressBackup();
await buildSingleDueBackup();
console.log(`Wrote E2E backups to ${OUTPUT_DIRECTORY}`);
