import type { KanjiId, Skill } from './types';

export interface IdSource {
  next(): string;
}

/**
 * A random version 4 UUID. `crypto.randomUUID()` exists only in secure contexts (HTTPS or
 * localhost), so opening the dev server from a tablet over the local network would fail;
 * `crypto.getRandomValues()` is available everywhere and gives the same randomness.
 */
/** The parts of Web Crypto used here; also available in Node, where these IDs are made too. */
export interface RandomSource {
  getRandomValues(array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
  randomUUID?: (() => string) | undefined;
}

export function randomUuid(cryptoSource: RandomSource = globalThis.crypto): string {
  if (typeof cryptoSource.randomUUID === 'function') return cryptoSource.randomUUID();
  const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const systemIdSource: IdSource = {
  next: () => randomUuid(),
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
