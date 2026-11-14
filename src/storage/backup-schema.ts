import { z } from 'zod';

import {
  cardRecordSchema,
  contentIssueSchema,
  deckEntryRecordSchema,
  deckRecordSchema,
  reviewEventSchema,
  sessionRecordSchema,
  settingsRecordSchema,
  unixMsSchema,
} from '../domain/schemas';
import { FSRS_ADAPTER_VERSION, FSRS_MODEL, FSRS_PACKAGE_VERSION } from '../scheduler/types';

export const BACKUP_FORMAT = 'kanjipain-backup';
/** Version 2 added custom decks. Version 1 files are still accepted. */
export const BACKUP_VERSION = 2;

export const backupSchedulerMetadataSchema = z.strictObject({
  adapterVersion: z.literal(FSRS_ADAPTER_VERSION),
  packageVersion: z.literal(FSRS_PACKAGE_VERSION),
  model: z.literal(FSRS_MODEL),
});

const progressShape = {
  exportedAt: unixMsSchema,
  datasetVersion: z.string().regex(/^[0-9a-f]{64}$/),
  scheduler: backupSchedulerMetadataSchema,
  cards: z.array(cardRecordSchema),
  events: z.array(reviewEventSchema),
  sessions: z.array(sessionRecordSchema),
  settings: settingsRecordSchema,
  contentIssues: z.array(contentIssueSchema),
};

/** Backups written before decks existed: progress in the Standard deck only. */
export const backupEnvelopeV1Schema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(1),
  ...progressShape,
});

export const backupEnvelopeSchema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  ...progressShape,
  decks: z.array(deckRecordSchema),
  deckEntries: z.array(deckEntryRecordSchema),
});

export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;

export interface BackupCounts {
  readonly cards: number;
  readonly events: number;
  readonly sessions: number;
  readonly contentIssues: number;
  readonly decks: number;
  readonly deckEntries: number;
}

export function countBackupRecords(envelope: BackupEnvelope): BackupCounts {
  return Object.freeze({
    cards: envelope.cards.length,
    events: envelope.events.length,
    sessions: envelope.sessions.length,
    contentIssues: envelope.contentIssues.length,
    decks: envelope.decks.length,
    deckEntries: envelope.deckEntries.length,
  });
}
