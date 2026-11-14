import type { DeckListItem } from '../../services/deck-service';

export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en')} ${count === 1 ? one : many}`;
}

export function deckWarnings(deck: DeckListItem): string[] {
  const warnings: string[] = [];
  if (deck.unrecognizedCount > 0) {
    warnings.push(
      `${plural(deck.unrecognizedCount, 'character', 'characters')} without stroke data`,
    );
  }
  if (deck.withoutCueCount > 0) {
    warnings.push(
      `${plural(deck.withoutCueCount, 'character needs', 'characters need')} a meaning or reading`,
    );
  }
  return warnings;
}
