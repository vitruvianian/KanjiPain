import Dexie from 'dexie';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';

import { AppProviders } from '../../src/app/AppProviders';
import { SettingsPage } from '../../src/features/settings/SettingsPage';

const names = new Set<string>();

afterEach(async () => {
  cleanup();
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
