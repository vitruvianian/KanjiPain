import { useState, type SyntheticEvent } from 'react';

import { useAppServices, useSyncStatus } from '../../app/useAppServices';
import { Button } from '../../components/Button';
import { formatDateTime } from '../format';

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : 'That did not work. Check the connection and try again.';
}

function SignInForm({ notice }: { readonly notice: string | undefined }) {
  const { sync } = useAppServices();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const submitEmail = (event: SyntheticEvent) => {
    event.preventDefault();
    void run(async () => {
      await sync.sendEmailCode(email);
      setCodeSentTo(email.trim());
      setCode('');
    });
  };

  const submitCode = (event: SyntheticEvent) => {
    event.preventDefault();
    if (codeSentTo !== null) {
      void run(() => sync.verifyEmailCode(codeSentTo, code));
    }
  };

  return (
    <>
      <p>
        Sign in to keep the same progress and custom decks on every device. Without an account
        everything stays in this browser, exactly as before.
      </p>
      <p className="muted">
        Signing in uploads the progress already on this device and merges it with the account’s.
        Drawings are never uploaded.
      </p>
      {notice === undefined ? null : (
        <div className="banner banner--notice" role="status">
          <p>{notice}</p>
        </div>
      )}
      {error === null ? null : (
        <div className="banner banner--error" role="alert">
          <p>{error}</p>
        </div>
      )}

      <div className="account-options">
        <div>
          <h3>Google</h3>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              void run(() => sync.signInWithGoogle());
            }}
          >
            Continue with Google
          </Button>
        </div>

        <div>
          <h3>Email code</h3>
          {codeSentTo === null ? (
            <form className="account-form" onSubmit={submitEmail}>
              <label className="field">
                <span>Email address</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => {
                    setEmail(event.currentTarget.value);
                  }}
                />
              </label>
              <Button type="submit" disabled={busy || email.trim() === ''}>
                {busy ? 'Sending…' : 'Email me a code'}
              </Button>
            </form>
          ) : (
            <form className="account-form" onSubmit={submitCode}>
              <label className="field">
                <span>Code sent to {codeSentTo}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(event) => {
                    setCode(event.currentTarget.value);
                  }}
                />
              </label>
              <div className="button-row">
                <Button type="submit" variant="primary" disabled={busy || code.trim() === ''}>
                  {busy ? 'Checking…' : 'Sign in'}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setCodeSentTo(null);
                    setError(null);
                  }}
                >
                  Use another address
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

/** Sign-in and sync status. Renders nothing in builds that have no sync server. */
export function AccountPanel() {
  const { sync } = useAppServices();
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'replace' | 'delete' | null>(null);

  if (status.kind === 'unavailable') {
    return null;
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirming(null);
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const signOutButton = (
    <Button
      disabled={busy}
      onClick={() => {
        void run(() => sync.signOut());
      }}
    >
      Sign out
    </Button>
  );
  const actionError =
    error === null ? null : (
      <div className="banner banner--error" role="alert">
        <p>{error}</p>
      </div>
    );

  return (
    <section className="panel" aria-labelledby="account-title">
      <h2 id="account-title">Account and sync</h2>

      {status.kind === 'loading' ? <p role="status">Checking for a saved sign-in…</p> : null}

      {status.kind === 'signed-out' ? <SignInForm notice={status.notice} /> : null}

      {status.kind === 'not-invited' ? (
        <>
          <p>
            {status.email ?? 'This account'} has not been invited to sync yet. Ask the person who
            runs this copy of KanjiPain to add the address, then sign in again. Your progress stays
            in this browser meanwhile.
          </p>
          {actionError}
          {signOutButton}
        </>
      ) : null}

      {status.kind === 'other-account' ? (
        <>
          <p>
            This device holds progress from a different account than{' '}
            {status.email ?? 'the one you signed in with'}. Two accounts are never merged.
          </p>
          {actionError}
          {confirming === 'replace' ? (
            <>
              <p>
                Replacing removes every card, review and custom deck on this device and downloads
                the signed-in account’s. Export a backup first if you may want this progress again.
              </p>
              <div className="button-row">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => {
                    void run(() => sync.replaceLocalData());
                  }}
                >
                  {busy ? 'Replacing…' : 'Replace this device’s progress'}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setConfirming(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="button-row">
              <Button
                disabled={busy}
                onClick={() => {
                  setConfirming('replace');
                }}
              >
                Use this account here…
              </Button>
              {signOutButton}
            </div>
          )}
        </>
      ) : null}

      {status.kind === 'signed-in' ? (
        <>
          <p>
            Signed in{status.email === null ? '' : ` as ${status.email}`}. Progress and custom decks
            sync in the background whenever there is a connection; practice never waits for it.
          </p>
          <p className="muted" role="status" data-testid="sync-status">
            {status.activity === 'syncing'
              ? 'Syncing…'
              : status.lastSyncedAt === null
                ? 'Not synced yet.'
                : `Last synced ${formatDateTime(status.lastSyncedAt)}.`}
          </p>
          {status.error === undefined ? null : (
            <div className="banner banner--error" role="alert">
              <p>{status.error}</p>
            </div>
          )}
          {actionError}
          {confirming === 'delete' ? (
            <>
              <p>
                This deletes the account’s cloud copy and signs this device out. Progress stays on
                this device; other devices keep what they hold and are signed out when they next
                sync.
              </p>
              <div className="button-row">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => {
                    void run(() => sync.deleteCloudCopy());
                  }}
                >
                  {busy ? 'Deleting…' : 'Delete the cloud copy'}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setConfirming(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="button-row">
              <Button
                disabled={busy || status.activity === 'syncing'}
                onClick={() => {
                  void run(() => sync.syncNow());
                }}
              >
                Sync now
              </Button>
              {signOutButton}
              <Button
                disabled={busy}
                onClick={() => {
                  setConfirming('delete');
                }}
              >
                Delete cloud copy…
              </Button>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
