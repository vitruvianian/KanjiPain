import Dexie from 'dexie';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '../src/App';
import { AppProviders } from '../src/app/AppProviders';

const databaseNames = new Set<string>();

function databaseName(label: string): string {
  const name = `kanjipain-app-${label}-${crypto.randomUUID()}`;
  databaseNames.add(name);
  return name;
}

afterEach(async () => {
  cleanup();
  await Promise.all([...databaseNames].map((name) => Dexie.delete(name)));
  databaseNames.clear();
});

describe('App', () => {
  it('shows onboarding once, then renders the Dojo and shared navigation', async () => {
    const name = databaseName('onboarding');
    const user = userEvent.setup();
    const first = render(
      <AppProviders databaseName={name}>
        <App />
      </AppProviders>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Welcome to KanjiPain' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByText(/make the effort count/i)).toBeInTheDocument();
    expect(screen.getByText(/stored only in this browser/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Enter the Dojo' }));
    expect(await screen.findByRole('heading', { name: 'Dojo' })).toBeInTheDocument();
    expect(screen.getByText(/A new session plans/)).toBeInTheDocument();

    first.unmount();
    render(
      <AppProviders databaseName={name}>
        <App />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Dojo' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome to KanjiPain' })).not.toBeInTheDocument();
  });
});
