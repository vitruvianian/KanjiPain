import { describe, expect, it } from 'vitest';

import { buildPrompt, PromptTargetLeakError } from '../../src/domain/prompts';
import { entry } from './domain-fixtures';

describe('buildPrompt', () => {
  it('uses up to three meanings, kun-before-on readings, and only available hints', () => {
    const catalogEntry = {
      ...entry(0),
      meanings: ['one', 'single', 'individual', 'fourth meaning excluded'],
      kunReadings: ['ひと'],
      onReadings: ['イチ'],
      strokeCount: 1,
    };

    expect(buildPrompt(catalogEntry)).toEqual({
      kanjiId: catalogEntry.id,
      meaningCue: 'one, single, individual',
      readingCues: ['ひと', 'イチ'],
      hints: [{ key: 'stroke-count', text: 'Stroke count: 1' }],
    });
  });

  it('applies reviewed overrides and orders mnemonic, component, then stroke count', () => {
    const catalogEntry = entry(1);
    const prompt = buildPrompt(catalogEntry, {
      promptOverride: { meaningCue: 'a reviewed cue', readingCues: ['キュー'] },
      mnemonicHint: 'A reviewed mnemonic.',
      componentHint: 'A reviewed component cue.',
      source: 'editorial',
      reviewer: 'reviewer',
    });

    expect(prompt.meaningCue).toBe('a reviewed cue');
    expect(prompt.readingCues).toEqual(['キュー']);
    expect(prompt.hints.map((hint) => hint.key)).toEqual(['mnemonic', 'component', 'stroke-count']);
    expect(prompt.hints).not.toContainEqual(expect.objectContaining({ key: 'full-answer' }));
  });

  it.each(['meaning', 'reading', 'hint'] as const)(
    'rejects a target glyph leak in %s content',
    (location) => {
      const catalogEntry = entry(2);
      const note = {
        promptOverride: {
          meaningCue: location === 'meaning' ? `target ${catalogEntry.literal}` : 'safe',
          readingCues: location === 'reading' ? [catalogEntry.literal] : ['セーフ'],
        },
        mnemonicHint: location === 'hint' ? catalogEntry.literal : 'safe hint',
        source: 'editorial',
        reviewer: 'reviewer',
      };

      expect(() => buildPrompt(catalogEntry, note)).toThrow(PromptTargetLeakError);
    },
  );

  it('returns frozen prompt collections', () => {
    const prompt = buildPrompt(entry(3));

    expect(Object.isFrozen(prompt)).toBe(true);
    expect(Object.isFrozen(prompt.readingCues)).toBe(true);
    expect(Object.isFrozen(prompt.hints)).toBe(true);
  });
});
