import { z } from 'zod';

import { serializedFsrsCardSchema, serializedFsrsLogSchema } from '../scheduler/serialization';

const nonBlankStringSchema = z.string().trim().min(1);
const recordIdSchema = nonBlankStringSchema;
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const unixMsSchema = nonNegativeIntegerSchema;
export const localDayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const kanjiIdSchema = z.string().regex(/^k-[0-9a-f]{4,6}$/);
export const skillSchema = z.literal('production');
export const gradeSchema = z.enum(['got', 'barely', 'missed']);
export const checkerVerdictSchema = z.enum([
  'match',
  'order',
  'direction',
  'stroke-count',
  'lookalike',
  'mismatch',
]);
export const inputModeSchema = z.enum(['drawing', 'paper']);
export const hintKeySchema = z.enum(['mnemonic', 'component', 'stroke-count', 'full-answer']);
export const sessionItemStatusSchema = z.enum(['pending', 'done', 'skipped']);

export const kanjiEntrySchema = z
  .strictObject({
    id: kanjiIdSchema,
    literal: z.string().refine((literal) => Array.from(literal).length === 1, {
      message: 'A kanji literal must contain exactly one Unicode code point.',
    }),
    grade: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(8),
    ]),
    meanings: z.array(nonBlankStringSchema).min(1),
    onReadings: z.array(nonBlankStringSchema),
    kunReadings: z.array(nonBlankStringSchema),
    strokeCount: positiveIntegerSchema,
    frequencyRank: positiveIntegerSchema.nullable(),
    curriculumOrder: z.number().int().min(0).max(2_135),
  })
  .superRefine((entry, context) => {
    if (entry.onReadings.length + entry.kunReadings.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['onReadings'],
        message: 'A catalog entry needs at least one Japanese reading.',
      });
    }
  });

export const catalogManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  datasetVersion: sha256Schema,
  entryCount: positiveIntegerSchema,
  generatedAt: unixMsSchema,
  catalogSha256: sha256Schema,
  teachingNotesSha256: sha256Schema,
  source: z.strictObject({
    name: z.literal('KANJIDIC2'),
    downloadUrl: z.url(),
    documentationUrl: z.url(),
    licenseUrl: z.url(),
    license: z.literal('CC BY-SA 4.0'),
    retrievedAt: unixMsSchema,
    upstreamDate: nonBlankStringSchema.nullable(),
    inputSha256: sha256Schema,
  }),
});

export const teachingNoteSchema = z
  .strictObject({
    promptOverride: z
      .strictObject({
        meaningCue: nonBlankStringSchema,
        readingCues: z.array(nonBlankStringSchema).min(1),
      })
      .optional(),
    mnemonicHint: nonBlankStringSchema.optional(),
    componentHint: nonBlankStringSchema.optional(),
    source: nonBlankStringSchema,
    reviewer: nonBlankStringSchema,
    reviewedAt: unixMsSchema.optional(),
  })
  .refine(
    (note) =>
      note.promptOverride !== undefined ||
      note.mnemonicHint !== undefined ||
      note.componentHint !== undefined,
    { message: 'A teaching note must contain reviewed teaching content.' },
  );

export const teachingNotesSchema = z.record(kanjiIdSchema, teachingNoteSchema);

export const settingsRecordSchema = z.strictObject({
  id: z.literal('user'),
  dailyNewLimit: z.number().int().min(0).max(10),
  inputMode: inputModeSchema,
  onboardingCompleted: z.boolean(),
});

export const cardRecordSchema = z.strictObject({
  id: nonBlankStringSchema,
  kanjiId: kanjiIdSchema,
  skill: skillSchema,
  introducedAt: unixMsSchema,
  introducedLocalDay: localDayKeySchema,
  introducedInSessionId: recordIdSchema,
  dueAt: unixMsSchema,
  schedulerState: serializedFsrsCardSchema,
  scheduledReviewCount: nonNegativeIntegerSchema,
  suspended: z.boolean(),
  version: nonNegativeIntegerSchema,
});

const normalizedCoordinateSchema = z.number().min(0).max(1);

export const pointSchema = z.strictObject({
  x: normalizedCoordinateSchema,
  y: normalizedCoordinateSchema,
  p: z.number().min(0).max(1).optional(),
  t: nonNegativeIntegerSchema.optional(),
});

export const strokeSchema = z.array(pointSchema).min(1).max(20_000);

const strokesSchema = z
  .array(strokeSchema)
  .max(100)
  .superRefine((strokes, context) => {
    const pointCount = strokes.reduce((total, stroke) => total + stroke.length, 0);

    if (pointCount > 20_000) {
      context.addIssue({
        code: 'custom',
        message: 'An attempt cannot contain more than 20,000 points.',
      });
    }
  });

const attemptDraftShape = {
  id: recordIdSchema,
  itemId: recordIdSchema,
  startedAt: unixMsSchema,
  inputMode: inputModeSchema,
  strokes: strokesSchema,
  paperAttemptConfirmed: z.boolean(),
  hintKeysUsed: z.array(hintKeySchema),
  surrendered: z.boolean(),
};

export const attemptDraftSchema = z.strictObject({
  ...attemptDraftShape,
  revealedAt: unixMsSchema.nullable(),
});

export const unrevealedAttemptDraftSchema = z.strictObject({
  ...attemptDraftShape,
  revealedAt: z.null(),
});

export const revealedAttemptDraftSchema = z.strictObject({
  ...attemptDraftShape,
  revealedAt: unixMsSchema,
});

export const productionPromptSchema = z.strictObject({
  kanjiId: kanjiIdSchema,
  meaningCue: nonBlankStringSchema,
  readingCues: z.array(nonBlankStringSchema).min(1),
  hints: z.array(
    z.strictObject({
      key: z.enum(['mnemonic', 'component', 'stroke-count']),
      text: nonBlankStringSchema,
    }),
  ),
});

export const contentIssueSchema = z.strictObject({
  id: recordIdSchema,
  cardId: recordIdSchema,
  eventId: recordIdSchema,
  reason: z.literal('ambiguous-prompt'),
  createdAt: unixMsSchema,
  datasetVersion: sha256Schema,
});

export const reviewEventSchema = z
  .strictObject({
    id: recordIdSchema,
    sessionId: recordIdSchema,
    cardId: recordIdSchema,
    itemId: recordIdSchema,
    kind: z.enum(['scheduled', 'rematch', 'ambiguous']),
    isFirstLearningCheck: z.boolean(),
    grade: gradeSchema.nullable(),
    assisted: z.boolean(),
    hintKeysUsed: z.array(hintKeySchema),
    inputMode: inputModeSchema,
    occurredAt: unixMsSchema,
    durationMs: nonNegativeIntegerSchema,
    beforeVersion: nonNegativeIntegerSchema,
    afterVersion: nonNegativeIntegerSchema,
    schedulerLog: serializedFsrsLogSchema.nullable(),
    datasetVersion: sha256Schema,
    checkerVerdict: checkerVerdictSchema.optional(),
  })
  .superRefine((event, context) => {
    if (event.kind === 'ambiguous' && event.grade !== null) {
      context.addIssue({
        code: 'custom',
        path: ['grade'],
        message: 'An ambiguous event cannot have a grade.',
      });
    }

    if (event.kind !== 'ambiguous' && event.grade === null) {
      context.addIssue({
        code: 'custom',
        path: ['grade'],
        message: 'A graded event requires a grade.',
      });
    }

    if (event.kind !== 'scheduled' && event.schedulerLog !== null) {
      context.addIssue({
        code: 'custom',
        path: ['schedulerLog'],
        message: 'Only scheduled events can contain a scheduler log.',
      });
    }

    if (event.kind === 'scheduled' && event.schedulerLog === null) {
      context.addIssue({
        code: 'custom',
        path: ['schedulerLog'],
        message: 'A scheduled event requires a scheduler log.',
      });
    }
  });

export const primarySessionItemSchema = z.strictObject({
  id: recordIdSchema,
  cardId: recordIdSchema,
  kanjiId: kanjiIdSchema,
  origin: z.enum(['due', 'new']),
  status: sessionItemStatusSchema,
  expectedCardVersion: nonNegativeIntegerSchema.nullable(),
});

export const gapCompletionSchema = z.strictObject({
  cardId: recordIdSchema,
  eventId: recordIdSchema,
});

export const rematchSessionItemSchema = z.strictObject({
  id: recordIdSchema,
  cardId: recordIdSchema,
  ordinal: z.union([z.literal(1), z.literal(2)]),
  afterOtherCompletions: z.array(gapCompletionSchema),
  status: sessionItemStatusSchema,
  expectedCardVersion: nonNegativeIntegerSchema.nullable(),
});

const activeItemShape = {
  itemId: recordIdSchema,
  cardId: recordIdSchema,
};

export const sessionPhaseSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('selecting'),
  }),
  z.strictObject({
    kind: z.literal('introduction'),
    ...activeItemShape,
    kanjiId: kanjiIdSchema,
  }),
  z.strictObject({
    kind: z.literal('prompt'),
    ...activeItemShape,
    expectedCardVersion: nonNegativeIntegerSchema,
    draft: unrevealedAttemptDraftSchema,
  }),
  z.strictObject({
    kind: z.literal('feedback'),
    ...activeItemShape,
    expectedCardVersion: nonNegativeIntegerSchema,
    draft: revealedAttemptDraftSchema,
  }),
  z.strictObject({
    kind: z.literal('repair'),
    ...activeItemShape,
    committedEventId: recordIdSchema,
    targetHidden: z.boolean(),
    practiceStrokes: strokesSchema,
  }),
  z.strictObject({
    kind: z.literal('summary'),
  }),
]);

export const sessionRecordSchema = z
  .strictObject({
    id: recordIdSchema,
    status: z.enum(['active', 'completed', 'ended']),
    revision: nonNegativeIntegerSchema,
    startedAt: unixMsSchema,
    endedAt: unixMsSchema.nullable(),
    startedLocalDay: localDayKeySchema,
    datasetVersion: sha256Schema,
    primaryLimit: z.literal(20),
    primaryItems: z.array(primarySessionItemSchema).max(20),
    rematchItems: z.array(rematchSessionItemSchema).max(40),
    phase: sessionPhaseSchema,
    completedEventIds: z.array(recordIdSchema).max(60),
  })
  .superRefine((session, context) => {
    const isFinished = session.status !== 'active';

    if (isFinished !== (session.endedAt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['endedAt'],
        message: 'Only completed or ended sessions have an end timestamp.',
      });
    }

    if (isFinished !== (session.phase.kind === 'summary')) {
      context.addIssue({
        code: 'custom',
        path: ['phase'],
        message: 'Finished sessions must be in the summary phase.',
      });
    }
  });

/**
 * These schemas validate individual record structure and within-record invariants.
 * Catalog membership, ID relationships, uniqueness, and cross-record references are
 * intentionally validated by the catalog importer or backup service in later checkpoints.
 */
export const structuralSchemas = {
  kanjiEntry: kanjiEntrySchema,
  catalogManifest: catalogManifestSchema,
  teachingNotes: teachingNotesSchema,
  settings: settingsRecordSchema,
  card: cardRecordSchema,
  attempt: attemptDraftSchema,
  reviewEvent: reviewEventSchema,
  contentIssue: contentIssueSchema,
  session: sessionRecordSchema,
};
