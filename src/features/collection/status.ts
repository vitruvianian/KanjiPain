import type { CharacterLearningStatus, CharacterStatus } from '../../domain/session-types';

export const COLLECTION_FILTERS = [
  'all',
  'unseen',
  'introduced',
  'developing',
  'reliable',
  'due',
  'paused',
] as const;

export type CollectionFilter = (typeof COLLECTION_FILTERS)[number];

const FILTER_LABELS: Readonly<Record<CollectionFilter, string>> = Object.freeze({
  all: 'All characters',
  unseen: 'Unseen',
  introduced: 'Introduced',
  developing: 'Developing',
  reliable: 'Reliable',
  due: 'Due now',
  paused: 'Paused',
});

const LEARNING_LABELS: Readonly<Record<CharacterLearningStatus, string>> = Object.freeze({
  unseen: 'Unseen',
  introduced: 'Introduced',
  developing: 'Developing',
  reliable: 'Reliable',
});

export function collectionFilterLabel(filter: CollectionFilter): string {
  return FILTER_LABELS[filter];
}

export function learningStatusLabel(learning: CharacterLearningStatus): string {
  return LEARNING_LABELS[learning];
}

export function characterStatusLabel(status: CharacterStatus): string {
  const parts: string[] = [learningStatusLabel(status.learning)];
  if (status.due) {
    parts.push('Due');
  }
  if (status.paused) {
    parts.push('Paused');
  }
  return parts.join(' · ');
}

export function matchesCollectionFilter(
  status: CharacterStatus,
  filter: CollectionFilter,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'due':
      return status.due;
    case 'paused':
      return status.paused;
    default:
      return status.learning === filter;
  }
}

export function isCollectionFilter(value: string): value is CollectionFilter {
  return COLLECTION_FILTERS.some((filter) => filter === value);
}
