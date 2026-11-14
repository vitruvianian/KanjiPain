import type { KanjiId, Skill } from './types';

export interface IdSource {
  next(): string;
}

export const systemIdSource: IdSource = {
  next: () => crypto.randomUUID(),
};

export function kanjiIdFromLiteral(literal: string): KanjiId {
  const codePoints = Array.from(literal);

  if (codePoints.length !== 1) {
    throw new Error('A kanji ID requires exactly one Unicode code point.');
  }

  const codePoint = codePoints[0]?.codePointAt(0);

  if (codePoint === undefined) {
    throw new Error('A kanji ID cannot be created from an empty literal.');
  }

  return `k-${codePoint.toString(16).padStart(4, '0')}`;
}

export function cardId(kanjiId: KanjiId, skill: Skill = 'production'): string {
  return `${kanjiId}:${skill}`;
}
