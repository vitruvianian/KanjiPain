import Dexie from 'dexie';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { AppProviders } from '../../src/app/AppProviders';
import { useAppServices, useSettings } from '../../src/app/useAppServices';
import { loadBundledCatalog } from '../../src/services/catalog';

const databaseNames = new Set<string>();

function databaseName(label: string): string {
  const name = `kanjipain-provider-${label}-${crypto.randomUUID()}`;
  databaseNames.add(name);
  return name;
}

function ReadyProbe() {
  const { catalog } = useAppServices();
  const settings = useSettings();

  return (
    <p>
      Ready: {String(catalog.all.length)} kanji, limit {String(settings?.dailyNewLimit ?? '…')}
    </p>
  );
}

afterEach(async () => {
  cleanup();
  await Promise.all([...databaseNames].map((name) => Dexie.delete(name)));
  databaseNames.clear();
});

describe('AppProviders', () => {
  it('waits for catalog and storage initialization before rendering children', async () => {
    render(
      <AppProviders databaseName={databaseName('ready')}>
        <ReadyProbe />
      </AppProviders>,
    );

    expect(screen.getByText(/validating the catalog and saved progress/i)).toBeInTheDocument();
    expect(await screen.findByText('Ready: 2136 kanji, limit 5')).toBeInTheDocument();
  });

  it('shows a blocking catalog error and retries startup', async () => {
    const catalog = loadBundledCatalog();
    let attempts = 0;
    const catalogLoader = () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('invalid catalog');
      }
      return catalog;
    };
    const user = userEvent.setup();

    render(
      <AppProviders databaseName={databaseName('retry')} catalogLoader={catalogLoader}>
        <ReadyProbe />
      </AppProviders>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /catalog or practice engine could not be loaded/i,
    );
    await user.click(screen.getByRole('button', { name: /retry startup/i }));

    expect(await screen.findByText('Ready: 2136 kanji, limit 5')).toBeInTheDocument();
    expect(attempts).toBe(2);
  });
});
