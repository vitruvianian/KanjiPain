import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useActiveDeck, useAppServices, useDecks } from '../../app/useAppServices';

/** Chooses the deck that sessions, the Dojo and the Collection use. */
export function DeckSwitcher() {
  const { decks: deckService } = useAppServices();
  const decks = useDecks();
  const active = useActiveDeck();
  const [error, setError] = useState<string | null>(null);

  if (decks === undefined || active === undefined) {
    return null;
  }

  const change = async (deckId: string) => {
    setError(null);
    try {
      await deckService.setActiveDeck(deckId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The deck could not be changed.');
    }
  };

  return (
    <div className="deck-switcher">
      <label className="field">
        <span>Active deck</span>
        <select
          value={active.deck.id}
          onChange={(event) => {
            void change(event.currentTarget.value);
          }}
        >
          {decks.map((deck) => (
            <option key={deck.id} value={deck.id}>
              {deck.name} ({deck.entryCount.toLocaleString('en')})
            </option>
          ))}
        </select>
      </label>
      <Link to="/decks">Manage decks</Link>
      {error === null ? null : (
        <div className="banner banner--error" role="alert">
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}
