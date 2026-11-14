import Dexie from 'dexie';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { AppProviders } from '../../src/app/AppProviders';
import { PracticePage } from '../../src/features/practice/PracticePage';
import { SummaryPage } from '../../src/features/practice/SummaryPage';
import { loadBundledCatalog } from '../../src/services/catalog';
import { createDatabase, initializeDatabase } from '../../src/storage/database';

const databaseNames = new Set<string>();
const catalog = loadBundledCatalog();

function databaseName(label: string): string {
  const name = `kanjipain-practice-${label}-${crypto.randomUUID()}`;
  databaseNames.add(name);
  return name;
}

function renderPractice(name: string) {
  return render(
    <AppProviders databaseName={name}>
      <MemoryRouter initialEntries={['/practice']}>
        <Routes>
          <Route path="/practice" element={<PracticePage />} />
          <Route path="/sessions/:id" element={<SummaryPage />} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

function firstEntry() {
  const entry = catalog.all[0];
  if (entry === undefined) {
    throw new Error('The bundled catalog is empty.');
  }
  return entry;
}

afterEach(async () => {
  cleanup();
  await Promise.all([...databaseNames].map((name) => Dexie.delete(name)));
  databaseNames.clear();
});

describe('practice route', () => {
  it('introduces a character, accepts a paper attempt, grades it, and summarizes', async () => {
    const entry = firstEntry();
    const user = userEvent.setup();
    renderPractice(databaseName('flow'));

    expect(await screen.findByRole('heading', { name: 'Meet the character' })).toBeInTheDocument();
    expect(screen.getByText(entry.literal)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide and try' }));
    expect(
      await screen.findByRole('heading', { name: 'Write the kanji for:' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(entry.literal)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Write on paper' }));
    await user.click(screen.getByRole('checkbox', { name: 'I wrote it on paper' }));
    await user.click(screen.getByRole('button', { name: 'Compare answer' }));

    expect(await screen.findByRole('heading', { name: 'The character was' })).toBeInTheDocument();
    expect(screen.getByText(entry.literal)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));

    expect(
      await screen.findByRole('heading', { name: 'Meet the character' }, { timeout: 3000 }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Finish session' }));

    expect(await screen.findByRole('heading', { name: 'Session summary' })).toBeInTheDocument();
    expect(screen.getByText('Partial session')).toBeInTheDocument();
    expect(screen.getByText('New characters introduced')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to the Dojo' })).toBeInTheDocument();
  });

  it('keeps hints across input changes and requires an assisted miss before repair', async () => {
    const entry = firstEntry();
    const user = userEvent.setup();
    renderPractice(databaseName('hints'));

    await screen.findByRole('heading', { name: 'Meet the character' });
    await user.click(screen.getByRole('button', { name: 'Hide and try' }));
    await screen.findByRole('heading', { name: 'Write the kanji for:' });

    await user.click(screen.getByRole('button', { name: 'Give me a foothold' }));
    const hint = await screen.findByText(`Stroke count: ${String(entry.strokeCount)}`);
    expect(hint).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Write on paper' }));
    expect(screen.getByText(`Stroke count: ${String(entry.strokeCount)}`)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'I wrote it on paper' }));
    await user.click(screen.getByRole('button', { name: 'Compare answer' }));

    expect(await screen.findByText(/Assisted recall/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue — practice again' }));

    expect(
      await screen.findByRole('heading', { name: 'Look closely, then try once more' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByRole('heading', { name: 'Meet the character' }, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it('keeps the revealed answer after a reload', async () => {
    const name = databaseName('reload');
    const entry = firstEntry();
    const user = userEvent.setup();
    const first = renderPractice(name);

    await screen.findByRole('heading', { name: 'Meet the character' });
    await user.click(screen.getByRole('button', { name: 'Hide and try' }));
    await screen.findByRole('heading', { name: 'Write the kanji for:' });
    await user.click(screen.getByRole('radio', { name: 'Write on paper' }));
    await user.click(screen.getByRole('checkbox', { name: 'I wrote it on paper' }));
    await user.click(screen.getByRole('button', { name: 'Compare answer' }));
    await screen.findByRole('heading', { name: 'The character was' });

    first.unmount();
    renderPractice(name);

    expect(
      await screen.findByRole('heading', { name: 'The character was' }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(entry.literal)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument();
  });

  it('persists the repair target toggle through a route remount without another grade', async () => {
    const name = databaseName('repair');
    const user = userEvent.setup();
    const first = renderPractice(name);

    await screen.findByRole('heading', { name: 'Meet the character' });
    await user.click(screen.getByRole('button', { name: 'Hide and try' }));
    await screen.findByRole('heading', { name: 'Write the kanji for:' });
    await user.click(screen.getByRole('button', { name: "I don't know" }));
    await user.click(await screen.findByRole('button', { name: 'Continue — practice again' }));
    await user.click(await screen.findByRole('button', { name: 'Hide it and draw once more' }));
    expect(await screen.findByRole('img', { name: 'Repair drawing area' })).toBeInTheDocument();

    first.unmount();
    renderPractice(name);
    expect(await screen.findByRole('img', { name: 'Repair drawing area' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show the answer' }));
    expect(await screen.findByText(firstEntry().literal)).toBeInTheDocument();

    const database = createDatabase(name);
    expect(await database.events.count()).toBe(1);
    const card = await database.cards.toCollection().first();
    expect(card?.scheduledReviewCount).toBe(1);
    database.close();
  });

  it('finishes automatically after a primary miss and both short rematches are missed', async () => {
    const name = databaseName('bounded-short-rematch');
    const database = createDatabase(name);
    await initializeDatabase(database);
    await database.settings.update('user', { dailyNewLimit: 1 });
    database.close();
    const user = userEvent.setup();
    renderPractice(name);
    await user.click(await screen.findByRole('button', { name: 'Hide and try' }));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await user.click(await screen.findByRole('button', { name: "I don't know" }));
      await user.click(await screen.findByRole('button', { name: 'Continue — practice again' }));
      await user.click(await screen.findByRole('button', { name: /^Continue$/ }));
      if (attempt < 2) {
        await user.click(await screen.findByRole('button', { name: 'Practice it now' }));
      }
    }

    expect(await screen.findByRole('heading', { name: 'Session summary' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Practice it now' })).not.toBeInTheDocument();
  });

  it('allows surrender without a drawing and reloads canonical state after a stale write', async () => {
    const name = databaseName('stale');
    const user = userEvent.setup();
    renderPractice(name);

    await screen.findByRole('heading', { name: 'Meet the character' });
    await user.click(screen.getByRole('button', { name: 'Hide and try' }));
    await screen.findByRole('heading', { name: 'Write the kanji for:' });

    const external = createDatabase(name);
    const sessions = await external.sessions.toArray();
    const active = sessions[0];
    if (active === undefined) {
      throw new Error('Expected an active session.');
    }
    await external.sessions.update(active.id, { revision: active.revision + 1 });
    external.close();

    await user.click(screen.getByRole('button', { name: 'Give me a foothold' }));
    expect(
      await screen.findByText(/progress changed in another tab/i, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Stroke count:/)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: "I don't know" })).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: "I don't know" }));
    expect(await screen.findByText(/Assisted recall/i)).toBeInTheDocument();
  });
});
