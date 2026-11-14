import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAllCards, useAllEvents, useAppServices } from '../../app/useAppServices';
import { useNow } from '../../app/useNow';
import { Button } from '../../components/Button';
import { deriveCharacterStatus } from '../../domain/status';
import type { CharacterStatus } from '../../domain/session-types';
import type { CardRecord, KanjiEntry, ReviewEvent, UnixMs } from '../../domain/types';
import {
  characterStatusLabel,
  collectionFilterLabel,
  COLLECTION_FILTERS,
  isCollectionFilter,
  matchesCollectionFilter,
  type CollectionFilter,
} from './status';
import { searchEntries } from './search';

export const COLLECTION_PAGE_SIZE = 120;

interface CollectionItem {
  readonly entry: KanjiEntry;
  readonly status: CharacterStatus;
}

function groupEventsByCard(events: readonly ReviewEvent[]): Map<string, ReviewEvent[]> {
  const grouped = new Map<string, ReviewEvent[]>();
  for (const event of events) {
    const existing = grouped.get(event.cardId);
    if (existing === undefined) {
      grouped.set(event.cardId, [event]);
    } else {
      existing.push(event);
    }
  }
  return grouped;
}

function statusFor(
  entry: KanjiEntry,
  cardsByKanjiId: ReadonlyMap<string, CardRecord>,
  eventsByCardId: ReadonlyMap<string, readonly ReviewEvent[]>,
  now: UnixMs,
): CharacterStatus {
  const card = cardsByKanjiId.get(entry.id);
  const history = card === undefined ? [] : (eventsByCardId.get(card.id) ?? []);
  return deriveCharacterStatus(card, history, now);
}

function tileClass(status: CharacterStatus): string {
  const classes = ['character-tile', `character-tile--${status.learning}`];
  if (status.due) {
    classes.push('character-tile--due');
  }
  if (status.paused) {
    classes.push('character-tile--paused');
  }
  return classes.join(' ');
}

export function CollectionPage() {
  const { catalog } = useAppServices();
  const cards = useAllCards();
  const events = useAllEvents();
  const now = useNow();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CollectionFilter>('all');
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);

  if (cards === undefined || events === undefined) {
    return (
      <section className="panel" aria-busy="true">
        <h1>Collection</h1>
        <p role="status">Loading your saved progress…</p>
      </section>
    );
  }

  const cardsByKanjiId = new Map(cards.map((card) => [card.kanjiId, card]));
  const eventsByCardId = groupEventsByCard(events);
  const results: CollectionItem[] = searchEntries(catalog.all, deferredSearch)
    .map((entry) => ({
      entry,
      status: statusFor(entry, cardsByKanjiId, eventsByCardId, now),
    }))
    .filter((item) => matchesCollectionFilter(item.status, filter));

  const totalPages = Math.max(1, Math.ceil(results.length / COLLECTION_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * COLLECTION_PAGE_SIZE;
  const visible = results.slice(startIndex, startIndex + COLLECTION_PAGE_SIZE);
  const endIndex = startIndex + visible.length;

  return (
    <div className="collection-shell">
      <section className="panel collection-intro" aria-labelledby="collection-title">
        <p className="eyebrow">The wall</p>
        <h1 id="collection-title">Collection</h1>
        <p>
          Browse all {catalog.all.length.toLocaleString()} Jōyō characters. Browsing never
          introduces a character or changes its schedule.
        </p>
        <div className="collection-toolbar">
          <label className="field">
            <span>Search characters</span>
            <input
              type="search"
              value={search}
              placeholder="Kanji, English meaning, or kana reading"
              onChange={(event) => {
                setSearch(event.currentTarget.value);
                setPage(1);
              }}
            />
          </label>
          <label className="field">
            <span>Filter by progress</span>
            <select
              value={filter}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (isCollectionFilter(value)) {
                  setFilter(value);
                }
                setPage(1);
              }}
            >
              {COLLECTION_FILTERS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {collectionFilterLabel(candidate)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted collection-hint">
          Kana search ignores katakana/hiragana differences. The “Due now” and “Paused” filters are
          overlays, so they can include characters in any learning state.
        </p>
      </section>

      <p className="collection-count" role="status" aria-live="polite">
        {results.length === 0
          ? 'No matching characters'
          : `Showing ${String(startIndex + 1)}–${String(endIndex)} of ${String(results.length)} matching characters`}
      </p>

      {visible.length === 0 ? (
        <section className="panel">
          <h2>No characters match</h2>
          <p>Try a different meaning, reading, or literal, or clear the progress filter.</p>
          <Button
            onClick={() => {
              setSearch('');
              setFilter('all');
              setPage(1);
            }}
          >
            Clear search and filters
          </Button>
        </section>
      ) : (
        <ol className="collection-grid" aria-label="Characters">
          {visible.map(({ entry, status }) => {
            const statusText = characterStatusLabel(status);
            const label = `${entry.literal}, ${entry.meanings.join(', ')}. ${statusText}.`;
            return (
              <li key={entry.id}>
                <Link className={tileClass(status)} to={`/kanji/${entry.id}`} title={label}>
                  <span className="character-tile__literal" lang="ja">
                    {entry.literal}
                  </span>
                  <span className="character-tile__meaning">{entry.meanings[0] ?? '—'}</span>
                  <span className="character-tile__status">{statusText}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      <nav className="pagination" aria-label="Collection pages">
        <Button
          disabled={currentPage <= 1}
          onClick={() => {
            setPage(currentPage - 1);
          }}
        >
          Previous page
        </Button>
        <p>
          Page {String(currentPage)} of {String(totalPages)}
        </p>
        <Button
          disabled={currentPage >= totalPages}
          onClick={() => {
            setPage(currentPage + 1);
          }}
        >
          Next page
        </Button>
      </nav>
    </div>
  );
}
