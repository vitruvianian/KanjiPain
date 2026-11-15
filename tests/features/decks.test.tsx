import Dexie from 'dexie';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { AppProviders } from '../../src/app/AppProviders';
import { CharacterPage } from '../../src/features/collection/CharacterPage';
import { CollectionPage } from '../../src/features/collection/CollectionPage';
import { DeckPage } from '../../src/features/decks/DeckPage';
import { DecksPage } from '../../src/features/decks/DecksPage';
import { HomePage } from '../../src/features/home/HomePage';
import { PracticePage } from '../../src/features/practice/PracticePage';
import { SummaryPage } from '../../src/features/practice/SummaryPage';
import { createDatabase, initializeDatabase } from '../../src/storage/database';

const databaseNames = new Set<string>();

async function renderApp(path: string) {
  const name = `kanjipain-decks-${crypto.randomUUID()}`;
  databaseNames.add(name);
  const database = createDatabase(name);
  await initializeDatabase(database);
  await database.settings.update('user', { onboardingCompleted: true, dailyNewLimit: 1 });
  database.close();
  render(
    <AppProviders databaseName={name}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/decks" element={<DecksPage />} />
          <Route path="/decks/:id" element={<DeckPage />} />
          <Route path="/collection" element={<CollectionPage />} />
          <Route path="/kanji/:id" element={<CharacterPage />} />
          <Route path="/practice" element={<PracticePage />} />
          <Route path="/sessions/:id" element={<SummaryPage />} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

afterEach(async () => {
  cleanup();
  await Promise.all([...databaseNames].map((name) => Dexie.delete(name)));
  databaseNames.clear();
});

describe('custom decks', () => {
  it('shows the Standard deck as read-only, with a copy action instead of edit controls', async () => {
    await renderApp('/decks');

    const list = await screen.findByRole('list', { name: 'Decks' });
    expect(within(list).getByText(/2,136 characters · read-only/)).toBeInTheDocument();
    expect(within(list).getByText('Active')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Copy to a new deck' })).toBeInTheDocument();
    expect(within(list).queryByRole('link', { name: 'Open and edit' })).not.toBeInTheDocument();
  });

  it('creates a deck from pasted characters, warns about an unrecognized one, and practises it', async () => {
    const user = userEvent.setup();
    await renderApp('/decks');

    await user.type(await screen.findByLabelText('Deck name'), 'Pets');
    await user.click(screen.getByRole('button', { name: 'Create deck' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Pets' })).toBeInTheDocument();
    expect(screen.getByText(/This deck is empty/)).toBeInTheDocument();

    // ☃ has no stroke data; 猫 does.
    await user.type(screen.getByLabelText('Paste characters'), '☃猫');
    await user.click(screen.getByRole('button', { name: 'Preview pasted characters' }));

    const preview = await screen.findByRole('region', { name: 'Review this import' });
    expect(within(preview).getByText(/2 new characters/)).toBeInTheDocument();
    expect(within(preview).getByText(/1 character is not recognized/)).toBeInTheDocument();
    expect(
      within(preview).getByText(/stroke order and automatic checking are not available/),
    ).toBeInTheDocument();
    expect(within(preview).getByText('11 strokes')).toBeInTheDocument();
    await user.click(within(preview).getByRole('button', { name: 'Add 2 characters' }));

    expect(await screen.findByText('Import saved: 2 added, 0 merged.')).toBeInTheDocument();
    expect(await screen.findByText(/1 character without stroke data/)).toBeInTheDocument();
    expect(await screen.findByText(/2 characters need a meaning or reading/)).toBeInTheDocument();

    // A cue that gives the answer away is refused; a real one makes the entry practicable.
    await user.click(screen.getByRole('button', { name: 'Edit ☃' }));
    const editor = screen.getByRole('form', { name: 'Edit ☃' });
    await user.type(within(editor).getByLabelText(/Meanings/), 'the ☃');
    await user.click(within(editor).getByRole('button', { name: 'Save entry' }));
    expect(await screen.findByText(/contains the character itself/)).toBeInTheDocument();
    await user.clear(within(editor).getByLabelText(/Meanings/));
    await user.type(within(editor).getByLabelText(/Meanings/), 'snowman');
    await user.click(within(editor).getByRole('button', { name: 'Save entry' }));
    expect(await screen.findByText('Saved ☃.')).toBeInTheDocument();
    expect(await screen.findByText(/1 character needs a meaning or reading/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use this deck' }));
    await user.click(await screen.findByRole('link', { name: 'Practise in the Dojo' }));

    // The Dojo plans from the custom deck: only ☃ has a cue.
    expect(await screen.findByRole('combobox', { name: 'Active deck' })).toHaveDisplayValue(
      'Pets (2)',
    );
    expect(await screen.findByText(/1 character needs a meaning or reading/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Start practice' }));

    expect(await screen.findByRole('heading', { name: 'Meet the character' })).toBeInTheDocument();
    expect(screen.getByText('Pets ·')).toBeInTheDocument();
    expect(screen.getByText('☃')).toBeInTheDocument();
    expect(
      await screen.findByText(/Not recognized: stroke order and automatic checking/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide and try' }));
    // The introduction lists the meaning too, so wait for the prompt itself.
    expect(
      await screen.findByRole('heading', { name: 'Write the kanji for:' }),
    ).toBeInTheDocument();
    expect(screen.getByText('snowman')).toBeInTheDocument();
    expect(screen.queryByText(/Reading cues/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Write on paper' }));
    await user.click(screen.getByRole('checkbox', { name: 'I wrote it on paper' }));
    await user.click(screen.getByRole('button', { name: 'Compare answer' }));

    expect(await screen.findByRole('heading', { name: 'The character was' })).toBeInTheDocument();
    expect(
      await screen.findByText(/Not recognized: stroke order and automatic checking/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Suggested grade/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));

    expect(
      await screen.findByRole('heading', { name: 'Session summary' }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('☃')).toBeInTheDocument();
  });

  it('adds a Standard character to a custom deck and filters the Collection by deck', async () => {
    const user = userEvent.setup();
    await renderApp('/decks');
    await user.type(await screen.findByLabelText('Deck name'), 'Water');
    await user.click(screen.getByRole('button', { name: 'Create deck' }));
    await screen.findByRole('heading', { level: 1, name: 'Water' });
    cleanup();

    const name = [...databaseNames][0] ?? '';
    render(
      <AppProviders databaseName={name}>
        <MemoryRouter initialEntries={['/kanji/k-6e56']}>
          <Routes>
            <Route path="/collection" element={<CollectionPage />} />
            <Route path="/kanji/:id" element={<CharacterPage />} />
          </Routes>
        </MemoryRouter>
      </AppProviders>,
    );

    await user.click(await screen.findByRole('button', { name: 'Add to deck' }));
    expect(await screen.findByText(/Added to Water/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Water' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to deck' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Collection' }));
    expect(await screen.findByText(/Showing 1–120 of 2136/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Deck'), 'Water');
    expect(await screen.findByText(/Showing 1–1 of 1 matching characters/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /湖/ })).toBeInTheDocument();
  });
});
