import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BackupActiveSessionError,
  BackupTooLargeError,
  BackupValidationError,
  MAX_BACKUP_BYTES,
  createBackupService,
} from '../../src/services/backup-service';
import type { ServiceHarness } from './service-fixtures';
import { catalogEntry, createHarness } from './service-fixtures';
import type { KanjiEntry } from '../../src/domain/types';
import type { SessionRecord } from '../../src/domain/session-types';
import { backupEnvelopeSchema } from '../../src/storage/backup-schema';

const databaseNames = new Set<string>();

function databaseName(label: string): string {
  const name = `kanjipain-backup-${label}-${crypto.randomUUID()}`;
  databaseNames.add(name);
  return name;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([...databaseNames].map((name) => Dexie.delete(name)));
  databaseNames.clear();
});

async function completeNewCardSession(
  harness: ServiceHarness,
  entry: KanjiEntry,
): Promise<SessionRecord> {
  await harness.database.settings.update('user', {
    dailyNewLimit: 1,
    onboardingCompleted: true,
  });
  const started = await harness.sessions.startOrResumeSession();
  const introduction = await harness.sessions.openNextItem(started.id, started.revision);
  if (introduction.session.phase.kind !== 'introduction') {
    throw new Error('Expected a new-character introduction.');
  }
  const prompt = await harness.sessions.hideIntroduction(
    introduction.session.id,
    introduction.session.revision,
  );
  if (prompt.phase.kind !== 'prompt') {
    throw new Error('Expected a prompt after hiding the introduction.');
  }
  const saved = await harness.sessions.saveDraft(prompt.id, prompt.revision, {
    strokes: [[{ x: 0.25, y: 0.5 }]],
  });
  const revealed = await harness.sessions.revealAnswer(saved.id, saved.revision, 'compare');
  if (revealed.phase.kind !== 'feedback') {
    throw new Error('Expected feedback after revealing the answer.');
  }
  const graded = await harness.reviews.commitGrade({
    sessionId: revealed.id,
    attemptId: revealed.phase.draft.id,
    expectedRevision: revealed.revision,
    expectedCardVersion: revealed.phase.expectedCardVersion,
    grade: 'got',
  });
  const finished = await harness.sessions.finishSession(graded.session.id, graded.session.revision);
  expect(finished.status).toBe('ended');
  expect(finished.primaryItems[0]?.kanjiId).toBe(entry.id);
  return finished;
}

async function completeAmbiguousSession(
  harness: ServiceHarness,
  entry: KanjiEntry,
): Promise<SessionRecord> {
  await harness.database.settings.update('user', {
    dailyNewLimit: 1,
    onboardingCompleted: true,
  });
  const started = await harness.sessions.startOrResumeSession();
  const introduction = await harness.sessions.openNextItem(started.id, started.revision);
  if (introduction.session.phase.kind !== 'introduction') {
    throw new Error('Expected a new-character introduction.');
  }
  const prompt = await harness.sessions.hideIntroduction(
    introduction.session.id,
    introduction.session.revision,
  );
  if (prompt.phase.kind !== 'prompt') {
    throw new Error('Expected a prompt after hiding the introduction.');
  }
  const saved = await harness.sessions.saveDraft(prompt.id, prompt.revision, {
    strokes: [[{ x: 0.25, y: 0.5 }]],
  });
  const revealed = await harness.sessions.revealAnswer(saved.id, saved.revision, 'compare');
  if (revealed.phase.kind !== 'feedback') {
    throw new Error('Expected feedback after revealing the answer.');
  }
  const flagged = await harness.reviews.flagAmbiguous({
    sessionId: revealed.id,
    attemptId: revealed.phase.draft.id,
    expectedRevision: revealed.revision,
    expectedCardVersion: revealed.phase.expectedCardVersion,
  });
  expect(flagged.issue.cardId).toBe(`${entry.id}:production`);
  const finished = await harness.sessions.finishSession(
    flagged.session.id,
    flagged.session.revision,
  );
  return finished;
}

function parseObject(json: string): Record<string, unknown> {
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object.');
  }
  return value as Record<string, unknown>;
}

function arrayField(object: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = object[key];
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${key} to be an array.`);
  }
  return value as Record<string, unknown>[];
}

describe('backup service', () => {
  it('round-trips cards, schedules, histories, sessions, settings, and issues into an empty database', async () => {
    const harness = await createHarness(databaseName('source'));
    await completeAmbiguousSession(harness, catalogEntry(0));
    const backup = createBackupService({
      database: harness.database,
      catalog: harness.catalog,
      clock: harness.clock,
    });
    const json = await backup.exportJson();
    expect(json).not.toContain('"strokes"');

    const preview = await backup.previewImport(json);
    expect(preview.counts).toEqual({ cards: 1, events: 1, sessions: 1, contentIssues: 1 });
    expect(preview.datasetVersionMatches).toBe(true);

    const before = {
      cards: await harness.database.cards.toArray(),
      events: await harness.database.events.toArray(),
      sessions: await harness.database.sessions.toArray(),
      settings: await harness.database.settings.toArray(),
      contentIssues: await harness.database.contentIssues.toArray(),
    };

    const targetName = databaseName('target');
    const target = await createHarness(targetName);
    const targetBackup = createBackupService({
      database: target.database,
      catalog: target.catalog,
      clock: target.clock,
    });
    await targetBackup.replaceWithImport(json);

    expect(await target.database.cards.toArray()).toEqual(before.cards);
    expect(await target.database.events.toArray()).toEqual(before.events);
    expect(await target.database.sessions.toArray()).toEqual(before.sessions);
    expect(await target.database.settings.toArray()).toEqual(before.settings);
    expect(await target.database.contentIssues.toArray()).toEqual(before.contentIssues);
    expect((await target.database.cards.toArray())[0]?.suspended).toBe(true);
  });

  it('allows a different catalog version when every recorded character exists', async () => {
    const harness = await createHarness(databaseName('version'));
    await completeNewCardSession(harness, catalogEntry(0));
    const backup = createBackupService({
      database: harness.database,
      catalog: harness.catalog,
      clock: harness.clock,
    });
    const object = parseObject(await backup.exportJson());
    object.datasetVersion = 'e'.repeat(64);

    const preview = await backup.previewImport(JSON.stringify(object));
    expect(preview.datasetVersionMatches).toBe(false);
    expect(preview.counts.cards).toBe(1);
  });

  it('rejects malformed JSON, unsupported versions, and unsupported schedulers', async () => {
    const harness = await createHarness(databaseName('malformed'));
    await completeNewCardSession(harness, catalogEntry(0));
    const backup = createBackupService({
      database: harness.database,
      catalog: harness.catalog,
      clock: harness.clock,
    });
    const json = await backup.exportJson();

    await expect(backup.previewImport('{')).rejects.toBeInstanceOf(BackupValidationError);

    const versionObject = parseObject(json);
    versionObject.version = 2;
    await expect(backup.previewImport(JSON.stringify(versionObject))).rejects.toThrow(
      /version 2 is not supported/i,
    );

    const schedulerObject = parseObject(json);
    const scheduler = schedulerObject.scheduler;
    if (typeof scheduler !== 'object' || scheduler === null) {
      throw new Error('Expected scheduler metadata.');
    }
    (scheduler as Record<string, unknown>).model = 'FSRS-6';
    await expect(backup.previewImport(JSON.stringify(schedulerObject))).rejects.toThrow(
      /unsupported scheduler/i,
    );
  });

  it('rejects unknown catalog IDs, duplicate events, and dangling references', async () => {
    const harness = await createHarness(databaseName('references'));
    await completeNewCardSession(harness, catalogEntry(0));
    const backup = createBackupService({
      database: harness.database,
      catalog: harness.catalog,
      clock: harness.clock,
    });
    const json = await backup.exportJson();

    const unknownObject = parseObject(json);
    const unknownCard = arrayField(unknownObject, 'cards')[0];
    if (unknownCard === undefined) {
      throw new Error('Expected a card.');
    }
    unknownCard.kanjiId = 'k-ffff';
    unknownCard.id = 'k-ffff:production';
    const state = unknownCard.schedulerState;
    if (typeof state === 'object' && state !== null) {
      const inner = (state as Record<string, unknown>).card;
      if (typeof inner === 'object' && inner !== null) {
        (inner as Record<string, unknown>).cardId = 'k-ffff:production';
      }
    }
    await expect(backup.previewImport(JSON.stringify(unknownObject))).rejects.toThrow(
      /outside the current catalog/i,
    );

    const duplicateObject = parseObject(json);
    const events = arrayField(duplicateObject, 'events');
    const firstEvent = events[0];
    if (firstEvent === undefined) {
      throw new Error('Expected an event.');
    }
    events.push({ ...firstEvent });
    await expect(backup.previewImport(JSON.stringify(duplicateObject))).rejects.toThrow(
      /duplicate review event/i,
    );

    const danglingObject = parseObject(json);
    const danglingEvent = arrayField(danglingObject, 'events')[0];
    if (danglingEvent === undefined) {
      throw new Error('Expected an event.');
    }
    danglingEvent.sessionId = 'missing-session';
    await expect(backup.previewImport(JSON.stringify(danglingObject))).rejects.toThrow(
      /missing session/i,
    );
  });

  it('rejects files over 25 MiB before parsing', async () => {
    const harness = await createHarness(databaseName('large'));
    const backup = createBackupService({
      database: harness.database,
      catalog: harness.catalog,
      clock: harness.clock,
    });

    await expect(backup.previewImport('x'.repeat(MAX_BACKUP_BYTES + 1))).rejects.toBeInstanceOf(
      BackupTooLargeError,
    );
  });

  it('rejects export and import while a session is active', async () => {
    const harness = await createHarness(databaseName('active'));
    const backup = createBackupService({
      database: harness.database,
      catalog: harness.catalog,
      clock: harness.clock,
    });
    await harness.sessions.startOrResumeSession();

    await expect(backup.createExport()).rejects.toBeInstanceOf(BackupActiveSessionError);
    await expect(backup.previewImport('{}')).rejects.toBeInstanceOf(BackupActiveSessionError);
  });

  it('keeps the previous database intact when the replace transaction fails', async () => {
    const harness = await createHarness(databaseName('rollback-source'));
    await completeNewCardSession(harness, catalogEntry(0));
    const sourceBackup = createBackupService({
      database: harness.database,
      catalog: harness.catalog,
      clock: harness.clock,
    });
    const json = await sourceBackup.exportJson();

    const target = await createHarness(databaseName('rollback-target'));
    const targetBackup = createBackupService({
      database: target.database,
      catalog: target.catalog,
      clock: target.clock,
    });
    await targetBackup.replaceWithImport(json);
    const before = {
      cards: await target.database.cards.toArray(),
      events: await target.database.events.toArray(),
      sessions: await target.database.sessions.toArray(),
      settings: await target.database.settings.toArray(),
    };

    vi.spyOn(target.database.cards, 'bulkAdd').mockRejectedValueOnce(
      new Error('simulated write failure'),
    );
    await expect(targetBackup.replaceWithImport(json)).rejects.toThrow(/storage failed/i);

    expect(await target.database.cards.toArray()).toEqual(before.cards);
    expect(await target.database.events.toArray()).toEqual(before.events);
    expect(await target.database.sessions.toArray()).toEqual(before.sessions);
    expect(await target.database.settings.toArray()).toEqual(before.settings);
  });

  it('parses its own export with the strict envelope schema', async () => {
    const harness = await createHarness(databaseName('self'));
    await completeNewCardSession(harness, catalogEntry(0));
    const backup = createBackupService({
      database: harness.database,
      catalog: harness.catalog,
      clock: harness.clock,
    });
    const json = await backup.exportJson();
    expect(backupEnvelopeSchema.parse(JSON.parse(json) as unknown).sessions).toHaveLength(1);
  });
});
