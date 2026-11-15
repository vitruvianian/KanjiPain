import { describe, expect, it } from 'vitest';

import teachingNotes from '../../src/data/teaching-notes.json';
import {
  kanjiEntrySchema,
  pointSchema,
  sessionPhaseSchema,
  settingsRecordSchema,
  teachingNotesSchema,
} from '../../src/domain/schemas';

const validKanjiEntry = {
  id: 'k-6e56',
  literal: '湖',
  grade: 3,
  meanings: ['lake'],
  onReadings: ['コ'],
  kunReadings: ['みずうみ'],
  strokeCount: 12,
  frequencyRank: 1_344,
  curriculumOrder: 500,
};

describe('settingsRecordSchema', () => {
  const baseSettings = {
    id: 'user',
    dailyNewLimit: 5,
    inputMode: 'drawing',
    onboardingCompleted: false,
  };

  it('accepts the inclusive daily-new limits', () => {
    expect(settingsRecordSchema.safeParse({ ...baseSettings, dailyNewLimit: 0 }).success).toBe(
      true,
    );
    expect(settingsRecordSchema.safeParse({ ...baseSettings, dailyNewLimit: 10 }).success).toBe(
      true,
    );
  });

  it.each([-1, 11, 2.5])('rejects an invalid daily-new limit: %s', (dailyNewLimit) => {
    expect(settingsRecordSchema.safeParse({ ...baseSettings, dailyNewLimit }).success).toBe(false);
  });
});

describe('kanjiEntrySchema', () => {
  it('accepts a structurally valid entry', () => {
    expect(kanjiEntrySchema.safeParse(validKanjiEntry).success).toBe(true);
  });

  it('rejects entries without meanings', () => {
    expect(kanjiEntrySchema.safeParse({ ...validKanjiEntry, meanings: [] }).success).toBe(false);
  });

  it('rejects entries without any Japanese reading', () => {
    expect(
      kanjiEntrySchema.safeParse({
        ...validKanjiEntry,
        onReadings: [],
        kunReadings: [],
      }).success,
    ).toBe(false);
  });

  it('rejects a grade outside the Jōyō grade set', () => {
    expect(kanjiEntrySchema.safeParse({ ...validKanjiEntry, grade: 7 }).success).toBe(false);
  });
});

describe('pointSchema', () => {
  it('accepts normalized finite coordinates, including boundaries', () => {
    expect(pointSchema.safeParse({ x: 0, y: 1 }).success).toBe(true);
  });

  it.each([
    { x: -0.01, y: 0.5 },
    { x: 1.01, y: 0.5 },
    { x: Number.NaN, y: 0.5 },
    { x: Number.POSITIVE_INFINITY, y: 0.5 },
  ])('rejects a non-normalized point: $x, $y', (point) => {
    expect(pointSchema.safeParse(point).success).toBe(false);
  });
});

describe('session phase schemas', () => {
  it('keeps the summary phase free of editable draft state', () => {
    expect(sessionPhaseSchema.safeParse({ kind: 'summary' }).success).toBe(true);
    expect(sessionPhaseSchema.safeParse({ kind: 'summary', draft: {} }).success).toBe(false);
  });

  it('does not allow a revealed draft to return to the prompt phase', () => {
    const prompt = {
      kind: 'prompt',
      itemId: 'item-1',
      cardId: 'k-6e56:production',
      expectedCardVersion: 0,
      draft: {
        id: 'attempt-1',
        itemId: 'item-1',
        startedAt: 1_800_000_000_000,
        inputMode: 'drawing',
        strokes: [],
        paperAttemptConfirmed: false,
        hintKeysUsed: [],
        surrendered: false,
        revealedAt: 1_800_000_001_000,
      },
    };

    expect(sessionPhaseSchema.safeParse(prompt).success).toBe(false);
    expect(
      sessionPhaseSchema.safeParse({
        ...prompt,
        draft: { ...prompt.draft, revealedAt: null },
      }).success,
    ).toBe(true);
  });

  it('requires a revealed timestamp in feedback', () => {
    const feedback = {
      kind: 'feedback',
      itemId: 'item-1',
      cardId: 'k-6e56:production',
      expectedCardVersion: 0,
      draft: {
        id: 'attempt-1',
        itemId: 'item-1',
        startedAt: 1_800_000_000_000,
        inputMode: 'drawing',
        strokes: [[{ x: 0.5, y: 0.5 }]],
        paperAttemptConfirmed: false,
        hintKeysUsed: [],
        surrendered: false,
        revealedAt: null,
      },
    };

    expect(sessionPhaseSchema.safeParse(feedback).success).toBe(false);
    expect(
      sessionPhaseSchema.safeParse({
        ...feedback,
        draft: { ...feedback.draft, revealedAt: 1_800_000_001_000 },
      }).success,
    ).toBe(true);
  });
});

describe('teachingNotesSchema', () => {
  it('accepts the bundled teaching-notes file', () => {
    expect(Object.keys(teachingNotesSchema.parse(teachingNotes))).toHaveLength(6);
  });

  it('requires provenance for a curated note', () => {
    expect(
      teachingNotesSchema.safeParse({
        'k-6e56': {
          mnemonicHint: 'Water beside an old moon.',
        },
      }).success,
    ).toBe(false);
  });
});
