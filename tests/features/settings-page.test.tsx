import Dexie from 'dexie';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

import { AppProviders } from '../../src/app/AppProviders';
import { SettingsPage } from '../../src/features/settings/SettingsPage';

const names = new Set<string>();

afterEach(async () => {
  cleanup();
  Reflect.deleteProperty(navigator, 'storage');
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  await Promise.all([...names].map((name) => Dexie.delete(name)));
  names.clear();
});

it('keeps save confirmation after live preferences refresh and reloads stored values', async () => {
  const name = `settings-page-${crypto.randomUUID()}`;
  names.add(name);
  const user = userEvent.setup();
  function mount() {
    return render(
      <AppProviders databaseName={name}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </AppProviders>,
    );
  }
  const first = mount();
  await user.selectOptions(await screen.findByLabelText('New characters per day'), '2');
  await user.click(screen.getByRole('radio', { name: 'Paper beside the screen' }));
  await user.click(screen.getByRole('button', { name: 'Save preferences' }));
  expect(await screen.findByText(/Preferences saved/)).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save preferences' })).toBeDisabled(),
  );
  expect(screen.getByText(/Preferences saved/)).toBeInTheDocument();

  first.unmount();
  mount();
  expect(await screen.findByLabelText('New characters per day')).toHaveValue('2');
  expect(screen.getByRole('radio', { name: 'Paper beside the screen' })).toBeChecked();
});

function mountSettings() {
  const name = `settings-page-${crypto.randomUUID()}`;
  names.add(name);
  return render(
    <AppProviders databaseName={name}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </AppProviders>,
  );
}

it('switches the colour theme and remembers it on this device', async () => {
  const user = userEvent.setup();
  mountSettings();
  expect(await screen.findByRole('radio', { name: 'Match the system' })).toBeChecked();

  await user.click(screen.getByRole('radio', { name: 'Light' }));
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(window.localStorage.getItem('kanjipain-theme')).toBe('light');

  await user.click(screen.getByRole('radio', { name: 'Match the system' }));
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(window.localStorage.getItem('kanjipain-theme')).toBeNull();
});

it('shows whether storage is persistent and asks for it on request', async () => {
  const user = userEvent.setup();
  let granted = false;
  const persist = vi.fn(() => {
    granted = true;
    return Promise.resolve(true);
  });
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { persisted: () => Promise.resolve(granted), persist },
  });
  mountSettings();

  expect(await screen.findByText('Persistent storage: off.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Ask the browser to keep my data' }));
  expect(persist).toHaveBeenCalledOnce();
  expect(await screen.findByText('Persistent storage: on.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Ask the browser/ })).not.toBeInTheDocument();
});

it('shows when the last backup was exported', async () => {
  mountSettings();
  expect(await screen.findByTestId('last-backup')).toHaveTextContent(
    'No backup exported from this browser yet.',
  );
});

it('explains each review pace with real intervals and saves the choice', async () => {
  const user = userEvent.setup();
  mountSettings();

  const pace = await screen.findByLabelText('Review pace');
  expect(pace).toHaveValue('frequent');
  expect(screen.getByTestId('pace-example')).toHaveTextContent(/returns after: 1d → \d+d → /);

  await user.selectOptions(pace, 'relaxed');
  expect(screen.getByTestId('pace-example')).toHaveTextContent(/returns after: 5d → \d+d → /);

  await user.click(screen.getByRole('button', { name: 'Save preferences' }));
  expect(
    await screen.findByText(/new pace moved the next review of 0 learned characters/),
  ).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('Review pace')).toHaveValue('relaxed'));
});
