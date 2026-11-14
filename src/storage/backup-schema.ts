import { z } from 'zod';

import {
  cardRecordSchema,
  contentIssueSchema,
  reviewEventSchema,
  sessionRecordSchema,
  settingsRecordSchema,
  unixMsSchema,
} from '../domain/schemas';
import { FSRS_ADAPTER_VERSION, FSRS_MODEL, FSRS_PACKAGE_VERSION } from '../scheduler/types';

export const BACKUP_FORMAT = 'kanjipain-backup';
export const BACKUP_VERSION = 1;

export const backupSchedulerMetadataSchema = z.strictObject({
  adapterVersion: z.literal(FSRS_ADAPTER_VERSION),
  packageVersion: z.literal(FSRS_PACKAGE_VERSION),
  model: z.literal(FSRS_MODEL),
});

export const backupEnvelopeSchema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: unixMsSchema,
  datasetVersion: z.string().regex(/^[0-9a-f]{64}$/),
  scheduler: backupSchedulerMetadataSchema,
  cards: z.array(cardRecordSchema),
  events: z.array(reviewEventSchema),
  sessions: z.array(sessionRecordSchema),
  settings: settingsRecordSchema,
  contentIssues: z.array(contentIssueSchema),
});

export type BackupEnvelopeV1 = z.infer<typeof backupEnvelopeSchema>;

export interface BackupCounts {
  readonly cards: number;
  readonly events: number;
  readonly sessions: number;
  readonly contentIssues: number;
}

export function countBackupRecords(envelope: BackupEnvelopeV1): BackupCounts {
  return Object.freeze({
    cards: envelope.cards.length,
    events: envelope.events.length,
    sessions: envelope.sessions.length,
    contentIssues: envelope.contentIssues.length,
  });
}
