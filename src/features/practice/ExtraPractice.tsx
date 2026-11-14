import { Link } from 'react-router-dom';

import { useActiveDeck, useAllCards } from '../../app/useAppServices';
import { EXTRA_NEW_COUNT, PRIMARY_SESSION_LIMIT } from '../../domain/queue';

interface ExtraPracticeProps {
  /** Heading level to fit the page it is placed on. */
  readonly headingLevel?: 2 | 3;
}

/**
 * Extra sessions beyond the schedule and the daily new-character limit. Each can be started
 * again as soon as it ends, as many times as the learner wants.
 */
export function ExtraPractice({ headingLevel = 2 }: ExtraPracticeProps) {
  const deck = useActiveDeck();
  const cards = useAllCards();
  if (cards === undefined || deck === undefined) return null;

  // Extra sessions draw on the active deck only, like regular ones.
  const inDeck = cards.filter((card) => deck.byId(card.kanjiId) !== undefined);
  const practicable = new Set(deck.practicable.map((entry) => entry.id));
  const unseen = practicable.size - inDeck.filter((card) => practicable.has(card.kanjiId)).length;
  const learned = inDeck.filter((card) => !card.suspended && practicable.has(card.kanjiId)).length;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const newBatch = Math.min(EXTRA_NEW_COUNT, unseen);
  const reviewBatch = Math.min(PRIMARY_SESSION_LIMIT, learned);

  return (
    <section className="extra-practice" aria-labelledby="extra-practice-title">
      <Heading id="extra-practice-title">Keep going</Heading>
      <p className="muted">
        Extra sessions aren&apos;t held back by your daily limit, and you can start another whenever
        one ends.
      </p>
      <div className="button-row">
        {newBatch === 0 ? null : (
          <Link className="button" to="/practice?mode=extra-new">
            Learn {String(newBatch)} more new {newBatch === 1 ? 'character' : 'characters'}
          </Link>
        )}
        {reviewBatch === 0 ? null : (
          <Link className="button" to="/practice?mode=review-ahead">
            Review {String(reviewBatch)} learned {reviewBatch === 1 ? 'character' : 'characters'}{' '}
            ahead
          </Link>
        )}
      </div>
      {reviewBatch === 0 ? null : (
        <p className="muted">
          Reviewing ahead picks the characters due soonest, even if they are not due yet, and
          updates their schedule. An early review counts for less than one on time, so the next
          interval grows less.
        </p>
      )}
    </section>
  );
}
