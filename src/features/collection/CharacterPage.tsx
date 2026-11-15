import { Lookalikes } from '../../components/Lookalikes';
import { StrokeOrder } from '../../components/StrokeOrder';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  useAllEvents,
  useAppServices,
  useCardState,
  useDeckEntriesForKanji,
  useDecks,
} from '../../app/useAppServices';
import { useNow } from '../../app/useNow';
import { Button } from '../../components/Button';
import { cardId as productionCardId, literalFromKanjiId } from '../../domain/ids';
import { kanjiIdSchema } from '../../domain/schemas';
import type { CharacterStatus } from '../../domain/session-types';
import { deriveCharacterStatus } from '../../domain/status';
import type { CardRecord, Grade, HintKey, ReviewEvent, UnixMs } from '../../domain/types';
import { formatDateTime, formatDueIn } from '../format';
import { characterStatusLabel } from './status';

const EVENT_KIND_LABELS: Readonly<Record<ReviewEvent['kind'], string>> = Object.freeze({
  scheduled: 'Scheduled review',
  rematch: 'Rematch',
  ambiguous: 'Ambiguity pause',
});

const GRADE_LABELS: Readonly<Record<Grade, string>> = Object.freeze({
  got: 'Got it',
  barely: 'Barely',
  missed: 'Missed',
});

const HINT_LABELS: Readonly<Record<HintKey, string>> = Object.freeze({
  mnemonic: 'mnemonic',
  component: 'component',
  'stroke-count': 'stroke count',
  'full-answer': 'full answer',
});

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dueText(card: CardRecord, now: UnixMs): string {
  if (card.suspended) {
    return 'Paused — due date unchanged';
  }
  if (card.dueAt <= now) {
    return `Due now (${formatDateTime(card.dueAt)})`;
  }
  return `${capitalize(formatDueIn(card.dueAt, now))} (${formatDateTime(card.dueAt)})`;
}

function gradeText(event: ReviewEvent): string {
  return event.grade === null ? 'Not graded' : GRADE_LABELS[event.grade];
}

function eventDetail(event: ReviewEvent): string {
  const parts = [
    formatDateTime(event.occurredAt),
    event.inputMode === 'drawing' ? 'Drawing' : 'Paper',
    event.assisted ? 'Assisted' : 'Unassisted',
  ];
  if (event.isFirstLearningCheck) {
    parts.push('First learning check');
  }
  if (event.hintKeysUsed.length > 0) {
    parts.push(`Hints: ${event.hintKeysUsed.map((hint) => HINT_LABELS[hint]).join(', ')}`);
  }
  return parts.join(' · ');
}

function ReadingGroup({
  title,
  readings,
}: {
  readonly title: string;
  readonly readings: readonly string[];
}) {
  return (
    <div>
      <dt>{title}</dt>
      <dd>
        {readings.length === 0 ? (
          <span className="muted">None recorded</span>
        ) : (
          <ul className="reading-list">
            {readings.map((reading) => (
              <li key={reading} lang="ja">
                {reading}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

function ProgressDetails({
  card,
  status,
  now,
}: {
  readonly card: CardRecord;
  readonly status: CharacterStatus;
  readonly now: UnixMs;
}) {
  return (
    <dl className="character-facts">
      <div>
        <dt>Status</dt>
        <dd>{characterStatusLabel(status)}</dd>
      </div>
      <div>
        <dt>Next review</dt>
        <dd>{dueText(card, now)}</dd>
      </div>
      <div>
        <dt>Scheduler state</dt>
        <dd>{card.schedulerState.card.scheduleStatus}</dd>
      </div>
      <div>
        <dt>Introduced</dt>
        <dd>{formatDateTime(card.introducedAt)}</dd>
      </div>
      <div>
        <dt>Scheduled reviews</dt>
        <dd>{String(card.scheduledReviewCount)}</dd>
      </div>
      <div>
        <dt>FSRS repetitions / lapses</dt>
        <dd>
          {String(card.schedulerState.card.reps)} / {String(card.schedulerState.card.lapses)}
        </dd>
      </div>
    </dl>
  );
}

export function CharacterPage() {
  const { id } = useParams();
  const { catalog, contentIssues, decks: deckService } = useAppServices();
  const kanjiId = id !== undefined && kanjiIdSchema.safeParse(id).success ? id : undefined;
  // A character can come from the dictionary, from custom decks, or from both.
  const entry = kanjiId === undefined ? undefined : catalog.byId(kanjiId);
  const customEntries = useDeckEntriesForKanji(kanjiId ?? '');
  const decks = useDecks();
  const cardState = useCardState(kanjiId === undefined ? '' : productionCardId(kanjiId));
  const card = cardState ?? undefined;
  const events = useAllEvents();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [targetDeckId, setTargetDeckId] = useState('');

  const loading =
    events === undefined ||
    customEntries === undefined ||
    decks === undefined ||
    cardState === undefined;
  const known = entry !== undefined || (customEntries?.length ?? 0) > 0 || card !== undefined;

  if (kanjiId === undefined || (!loading && !known)) {
    return (
      <section className="panel">
        <h1>Character not found</h1>
        <p>
          No character in your decks uses the address <code>{id ?? '(missing)'}</code>. Character
          links use stable ASCII IDs, not page positions.
        </p>
        <Link to="/collection">Return to the collection</Link>
      </section>
    );
  }

  const literal = entry?.literal ?? literalFromKanjiId(kanjiId);

  if (loading) {
    return (
      <section className="panel" aria-busy="true">
        <h1 lang="ja">{literal}</h1>
        <p role="status">Loading review history…</p>
      </section>
    );
  }

  const deckNames = new Map(decks.map((deck) => [deck.id, deck.name]));
  const memberDeckIds = new Set(customEntries.map((custom) => custom.deckId));
  const addableDecks = decks.filter(
    (deck) => deck.kind === 'custom' && !memberDeckIds.has(deck.id),
  );
  const firstCustom = customEntries[0];

  const addToDeck = async () => {
    const deckId = targetDeckId === '' ? addableDecks[0]?.id : targetDeckId;
    if (deckId === undefined) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await deckService.addFromStandard(deckId, [kanjiId]);
      setNotice(
        `Added to ${deckNames.get(deckId) ?? 'the deck'} with its dictionary meanings and readings. You can change them in the deck.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The character could not be added.');
    } finally {
      setBusy(false);
    }
  };

  const history = card === undefined ? [] : events.filter((event) => event.cardId === card.id);
  const recent = [...history]
    .sort((left, right) => right.occurredAt - left.occurredAt || left.id.localeCompare(right.id))
    .slice(0, 20);
  const status = deriveCharacterStatus(card, history, now);

  const resume = async () => {
    if (card === undefined) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await contentIssues.resumePausedCard(card.id, card.version);
      setNotice('Pause cleared. The character keeps its existing due date.');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The pause could not be cleared. Reload and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="character-shell">
      <p className="breadcrumb">
        <Link to="/collection">Collection</Link> / <span lang="ja">{literal}</span>
      </p>

      {entry === undefined ? (
        <section className="panel character-hero" aria-labelledby="character-title">
          <p className="eyebrow">Custom character</p>
          <h1 id="character-title">
            <span lang="ja">{literal}</span>
          </h1>
          <p className="character-meanings">
            {firstCustom === undefined || firstCustom.meanings.length === 0
              ? 'No meaning recorded'
              : firstCustom.meanings.join('; ')}
          </p>
          <p className="muted">
            This character is not in the Jōyō dictionary data. What is shown comes from your own
            decks.
          </p>
        </section>
      ) : (
        <section className="panel character-hero" aria-labelledby="character-title">
          <p className="eyebrow">
            Grade {entry.grade === 8 ? '8 (additional Jōyō)' : String(entry.grade)}
          </p>
          <h1 id="character-title">
            <span lang="ja">{entry.literal}</span>
          </h1>
          <p className="character-meanings">{entry.meanings.join('; ')}</p>

          <dl className="character-facts">
            <ReadingGroup title="On readings (音読み)" readings={entry.onReadings} />
            <ReadingGroup title="Kun readings (訓読み)" readings={entry.kunReadings} />
            <div>
              <dt>Stroke count</dt>
              <dd>{String(entry.strokeCount)}</dd>
            </div>
            <div>
              <dt>Frequency rank</dt>
              <dd>
                {entry.frequencyRank === null ? 'Not ranked' : `#${String(entry.frequencyRank)}`}
              </dd>
            </div>
            <div>
              <dt>Jōyō curriculum order</dt>
              <dd>#{String(entry.curriculumOrder + 1)}</dd>
            </div>
          </dl>

          <p className="muted reading-note">
            Readings are shown exactly as stored. A period (.) separates a stem from okurigana that
            are written in kana, as in <span lang="ja">た.べる</span>. A hyphen (-) marks an affix
            boundary. These marks are structural, not extra sounds.
          </p>
        </section>
      )}

      <section className="panel" aria-labelledby="decks-title">
        <h2 id="decks-title">Decks</h2>
        {entry === undefined && customEntries.length === 0 ? (
          <p>
            This character is not in any deck, so sessions will not show it. Its progress and
            history are kept, and return if you add it to a deck again.
          </p>
        ) : (
          <ul className="deck-memberships">
            {entry === undefined ? null : (
              <li>
                <strong>{deckNames.get('standard') ?? 'Standard'}</strong>
                <span className="muted"> — dictionary meanings and readings, shown above.</span>
              </li>
            )}
            {customEntries.map((custom) => (
              <li key={custom.id}>
                <Link to={`/decks/${custom.deckId}`}>
                  {deckNames.get(custom.deckId) ?? 'Custom deck'}
                </Link>
                <span className="muted">
                  {' — '}
                  {custom.meanings.length === 0 ? 'no meaning' : custom.meanings.join(', ')}
                  {custom.readingCues.length === 0 ? null : (
                    <>
                      {' · '}
                      <span lang="ja">{custom.readingCues.join('・')}</span>
                    </>
                  )}
                </span>
                {custom.note === undefined ? null : <p className="muted">Note: {custom.note}</p>}
              </li>
            ))}
          </ul>
        )}
        {entry === undefined || addableDecks.length === 0 ? null : (
          <div className="deck-add">
            <label className="field">
              <span>Add to a custom deck</span>
              <select
                value={targetDeckId === '' ? (addableDecks[0]?.id ?? '') : targetDeckId}
                onChange={(event) => {
                  setTargetDeckId(event.currentTarget.value);
                }}
              >
                {addableDecks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={busy}
              onClick={() => {
                void addToDeck();
              }}
            >
              Add to deck
            </Button>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="stroke-order-title">
        <h2 id="stroke-order-title">How to write it</h2>
        <StrokeOrder key={kanjiId} kanjiId={kanjiId} literal={literal} />
        <Lookalikes
          linked
          items={catalog.lookalikes(kanjiId).map((id) => ({
            id,
            literal: catalog.byId(id)?.literal ?? id,
            meaning: catalog.byId(id)?.meanings.slice(0, 3).join(', '),
          }))}
        />
      </section>

      <section className="panel" aria-labelledby="progress-title">
        <h2 id="progress-title">Progress</h2>
        {card === undefined ? (
          <p>
            Not introduced yet. This character has no card and will not enter a session until the
            planner selects it as new work.
          </p>
        ) : (
          <>
            <ProgressDetails card={card} status={status} now={now} />
            {status.paused ? (
              <div className="banner banner--notice">
                <p>
                  This card is paused after an ambiguous prompt. Resuming clears the pause without
                  changing its existing due date.
                </p>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => {
                    void resume();
                  }}
                >
                  {busy ? 'Resuming…' : 'Resume this character'}
                </Button>
              </div>
            ) : null}
          </>
        )}

        {notice === null ? null : (
          <div className="banner banner--notice" role="status">
            <p>{notice}</p>
          </div>
        )}
        {error === null ? null : (
          <div className="banner banner--error" role="alert">
            <p>{error}</p>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="history-title">
        <h2 id="history-title">Recent review events</h2>
        <p className="muted">
          The latest twenty recorded events for this character, newest first. Rematches and
          ambiguity pauses are listed separately from scheduled reviews.
        </p>
        {recent.length === 0 ? (
          <p>No review events yet.</p>
        ) : (
          <ol className="event-list">
            {recent.map((event) => (
              <li key={event.id} className="event">
                <div className="event__heading">
                  <span className="event__kind">{EVENT_KIND_LABELS[event.kind]}</span>
                  <span className={`event__grade event__grade--${event.grade ?? 'none'}`}>
                    {gradeText(event)}
                  </span>
                </div>
                <p className="muted">{eventDetail(event)}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
