import Dexie from 'dexie';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { AppProviders } from '../../src/app/AppProviders';
import { AccountPanel } from '../../src/features/settings/AccountPanel';
import { MemoryRemoteStore } from '../../src/services/sync/memory-remote';
import type { SyncBackend, SyncUser } from '../../src/services/sync/remote-store';

const databaseNames = new Set<string>();

function databaseName(): string {
  const name = `kanjipain-account-${crypto.randomUUID()}`;
  databaseNames.add(name);
  return name;
}

afterEach(async () => {
  cleanup();
  await Promise.all([...databaseNames].map((name) => Dexie.delete(name)));
  databaseNames.clear();
});

function fakeBackend(cloud: MemoryRemoteStore): SyncBackend {
  let user: SyncUser | null = null;
  return {
    remote: cloud,
    currentUser: () => Promise.resolve(user),
    onUserChange: () => () => undefined,
    isInvited: () => Promise.resolve(true),
    signInWithGoogle: () => Promise.resolve(),
    sendEmailCode: () => Promise.resolve(),
    verifyEmailCode(email, code) {
      if (code !== '123456') {
        return Promise.reject(new Error('That code is not right.'));
      }
      user = { id: 'user-1', email };
      return Promise.resolve();
    },
    signOut() {
      user = null;
      return Promise.resolve();
    },
  };
}

describe('account panel', () => {
  it('is absent when the build has no sync server', async () => {
    render(
      <AppProviders databaseName={databaseName()} syncBackendLoader={null}>
        <p>Ready</p>
        <AccountPanel />
      </AppProviders>,
    );

    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /account and sync/i })).not.toBeInTheDocument();
  });

  it('signs in with an emailed code, syncs, and signs out', async () => {
    const cloud = new MemoryRemoteStore();
    const backend = fakeBackend(cloud);
    const loader = () => Promise.resolve(backend);
    const user = userEvent.setup();
    render(
      <AppProviders databaseName={databaseName()} syncBackendLoader={loader}>
        <AccountPanel />
      </AppProviders>,
    );

    await user.type(await screen.findByLabelText(/email address/i), 'learner@example.com');
    await user.click(screen.getByRole('button', { name: /email me a code/i }));

    const codeField = await screen.findByLabelText(/code sent to learner@example.com/i);
    await user.type(codeField, '000000');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not right.');

    await user.clear(codeField);
    await user.type(codeField, '123456');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText(/signed in as learner@example.com/i)).toBeInTheDocument();
    expect(await screen.findByText(/last synced/i)).toBeInTheDocument();
    expect(cloud.count('settings')).toBe(1);

    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(await screen.findByLabelText(/email address/i)).toBeInTheDocument();
  });
});
