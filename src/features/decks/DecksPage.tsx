import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useActiveDeck, useAppServices, useDecks } from '../../app/useAppServices';
import { Button } from '../../components/Button';
import { MAX_DECKS } from '../../domain/deck-import';
import { deckWarnings, plural } from './deck-warnings';

export function DecksPage() {
  const { decks: deckService } = useAppServices();
  const decks = useDecks();
  const active = useActiveDeck();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (decks === undefined || active === undefined) {
    return (
      <section className="panel" aria-busy="true">
        <h1>Decks</h1>
        <p role="status">Loading your decks…</p>
      </section>
    );
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That change could not be saved.');
    } finally {
      setBusy(false);
    }
  };
  const customCount = decks.filter((deck) => deck.kind === 'custom').length;

  return (
    <div className="decks-shell">
      <section className="panel" aria-labelledby="decks-title">
        <p className="eyebrow">What you practise</p>
        <h1 id="decks-title">Decks</h1>
        <p>
          Practice uses one deck at a time. The Standard deck holds the 2,136 Jōyō kanji and cannot
          be changed. Your own decks can hold any characters, with your own meanings and readings.
        </p>
        <p className="muted">
          Progress belongs to the character, not the deck: a character learned in one deck is
          learned in every deck that contains it, and deleting a deck never deletes progress.
        </p>
        {error === null ? null : (
          <div className="banner banner--error" role="alert">
            <p>{error}</p>
          </div>
        )}
      </section>

      <ul className="deck-list" aria-label="Decks">
        {decks.map((deck) => {
          const isActive = deck.id === active.deck.id;
          return (
            <li key={deck.id} className="panel deck-card">
              <h2>
                {deck.kind === 'custom' ? (
                  <Link to={`/decks/${deck.id}`}>{deck.name}</Link>
                ) : (
                  deck.name
                )}
                {isActive ? <span className="badge">Active</span> : null}
              </h2>
              <p>
                {plural(deck.entryCount, 'character', 'characters')}
                {deck.kind === 'standard' ? ' · read-only' : ''}
              </p>
              {deckWarnings(deck).map((warning) => (
                <p key={warning} className="deck-warning">
                  {warning}
                </p>
              ))}
              <div className="button-row">
                {isActive ? null : (
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => {
                      void run(async () => {
                        await deckService.setActiveDeck(deck.id);
                      });
                    }}
                  >
                    Use this deck
                  </Button>
                )}
                {deck.kind === 'custom' ? (
                  <Link className="button button--secondary" to={`/decks/${deck.id}`}>
                    Open and edit
                  </Link>
                ) : (
                  <>
                    <Button
                      disabled={busy || customCount >= MAX_DECKS}
                      onClick={() => {
                        void run(async () => {
                          const copy = await deckService.copyStandardDeck('Copy of Standard');
                          await navigate(`/decks/${copy.id}`);
                        });
                      }}
                    >
                      {busy ? 'Working…' : 'Copy to a new deck'}
                    </Button>
                    <Link className="button button--secondary" to="/collection">
                      Browse in the Collection
                    </Link>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <section className="panel" aria-labelledby="new-deck-title">
        <h2 id="new-deck-title">New deck</h2>
        <p className="muted">
          Create an empty deck, then paste characters or import a CSV, TSV or JSON file into it. You
          can keep up to {String(MAX_DECKS)} custom decks.
        </p>
        <form
          className="deck-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const deck = await deckService.createDeck(name);
              await navigate(`/decks/${deck.id}`);
            });
          }}
        >
          <label className="field">
            <span>Deck name</span>
            <input
              type="text"
              value={name}
              maxLength={80}
              onChange={(event) => {
                setName(event.currentTarget.value);
              }}
            />
          </label>
          <Button type="submit" variant="primary" disabled={busy || name.trim() === ''}>
            Create deck
          </Button>
        </form>
      </section>
    </div>
  );
}
