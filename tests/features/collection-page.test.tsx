import Dexie from 'dexie';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { AppProviders } from '../../src/app/AppProviders';
import { CharacterPage } from '../../src/features/collection/CharacterPage';
import { CollectionPage } from '../../src/features/collection/CollectionPage';

const databaseNames = new Set<string>();

function databaseName(label: string): string {
  const name = `kanjipain-collection-${label}-${crypto.randomUUID()}`;
  databaseNames.add(name);
  return name;
}

function renderAt(path: string) {
  const name = databaseName(path.replaceAll('/', '-'));
  render(
    <AppProviders databaseName={name}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/collection" element={<CollectionPage />} />
          <Route path="/kanji/:id" element={<CharacterPage />} />
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

describe('collection route', () => {
  it('searches all 2,136 characters and opens a stable character route', async () => {
    const user = userEvent.setup();
    renderAt('/collection');

    expect(await screen.findByRole('heading', { name: 'Collection' })).toBeInTheDocument();
    expect(
      await screen.findByText(/Showing 1–120 of 2136 matching characters/),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search characters'), '湖');
    const lakeLink = await screen.findByRole('link', { name: /湖/ });
    expect(lakeLink).toHaveAttribute('href', '/kanji/k-6e56');
    await user.click(lakeLink);

    // The loading state shows the glyph too, so wait for the loaded page before the heading.
    expect(await screen.findByText('lake')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '湖' })).toBeInTheDocument();
    expect(screen.getByText('コ')).toBeInTheDocument();
    expect(screen.getByText('みずうみ')).toBeInTheDocument();
    expect(screen.getByText(/Not introduced yet/)).toBeInTheDocument();
    expect(screen.getByText('No review events yet.')).toBeInTheDocument();
  });

  it('paginates the full catalog at 120 characters per page', async () => {
    const user = userEvent.setup();
    renderAt('/collection');

    const grid = await screen.findByRole('list', { name: 'Characters' });
    expect(within(grid).getAllByRole('link')).toHaveLength(120);
    expect(screen.getByText('Page 1 of 18')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Page 2 of 18')).toBeInTheDocument();
    expect(screen.getByText(/Showing 121–240 of 2136 matching characters/)).toBeInTheDocument();
  });

  it('shows a clear empty state when a filter matches nothing', async () => {
    const user = userEvent.setup();
    renderAt('/collection');

    await screen.findByRole('list', { name: 'Characters' });
    await user.selectOptions(screen.getByLabelText('Filter by progress'), 'due');

    expect(await screen.findByRole('heading', { name: 'No characters match' })).toBeInTheDocument();
    expect(screen.getByText('No matching characters')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(await screen.findByText(/Showing 1–120 of 2136/)).toBeInTheDocument();
  });

  it('explains an unknown character address', async () => {
    renderAt('/kanji/k-ffff');

    expect(await screen.findByRole('heading', { name: 'Character not found' })).toBeInTheDocument();
    expect(screen.getByText(/stable ASCII IDs/)).toBeInTheDocument();
  });
});
