import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useAppServices, useSessions, useSettings } from '../../app/useAppServices';
import { Button } from '../../components/Button';
import { localDayKey } from '../../domain/date';
import type { InputMode, SettingsRecord } from '../../domain/types';
import { MAX_BACKUP_BYTES, type BackupPreview } from '../../services/backup-service';
import { DeckSwitcher } from '../decks/DeckSwitcher';
import { formatDateTime } from '../format';
import { ImportPreview } from './ImportPreview';

const NEW_LIMIT_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

function PreferencesForm({
  current,
  notice,
  onNotice,
}: {
  readonly current: SettingsRecord;
  readonly notice: string | null;
  readonly onNotice: (notice: string | null) => void;
}) {
  const { settings: settingsService } = useAppServices();
  const [dailyNewLimit, setDailyNewLimit] = useState(current.dailyNewLimit);
  const [inputMode, setInputMode] = useState<InputMode>(current.inputMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = dailyNewLimit !== current.dailyNewLimit || inputMode !== current.inputMode;

  const save = async () => {
    setBusy(true);
    setError(null);
    onNotice(null);
    try {
      await settingsService.update({ dailyNewLimit, inputMode });
      onNotice('Preferences saved. Cards, schedules, and today’s introductions were unchanged.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Preferences could not be saved. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="preferences-title">
      <h2 id="preferences-title">Practice preferences</h2>
      <p>
        The daily limit controls how many unseen characters may be introduced on a local calendar
        day. It never deletes cards or changes existing due dates.
      </p>

      <div className="settings-fields">
        <label className="field">
          <span>New characters per day</span>
          <select
            value={String(dailyNewLimit)}
            onChange={(event) => {
              setDailyNewLimit(Number(event.currentTarget.value));
              onNotice(null);
            }}
          >
            {NEW_LIMIT_OPTIONS.map((option) => (
              <option key={option} value={String(option)}>
                {String(option)}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="mode-switch">
          <legend>Default input for new attempts</legend>
          <label>
            <input
              type="radio"
              name="default-input-mode"
              value="drawing"
              checked={inputMode === 'drawing'}
              onChange={() => {
                setInputMode('drawing');
                onNotice(null);
              }}
            />
            Drawing pad
          </label>
          <label>
            <input
              type="radio"
              name="default-input-mode"
              value="paper"
              checked={inputMode === 'paper'}
              onChange={() => {
                setInputMode('paper');
                onNotice(null);
              }}
            />
            Paper beside the screen
          </label>
        </fieldset>
      </div>

      <p className="muted">
        A limit of 0 pauses new introductions. Due reviews continue normally. Existing active
        sessions keep their planned items.
      </p>

      {error === null ? null : (
        <div className="banner banner--error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {notice === null ? null : (
        <div className="banner banner--notice" role="status">
          <p>{notice}</p>
        </div>
      )}

      <Button
        variant="primary"
        disabled={busy || !dirty}
        onClick={() => {
          void save();
        }}
      >
        {busy ? 'Saving…' : 'Save preferences'}
      </Button>
    </section>
  );
}

function BackupPanel({ activeSessionId }: { readonly activeSessionId: string | undefined }) {
  const { backup } = useAppServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [previewText, setPreviewText] = useState('');

  const exportCurrent = async () => {
    setBusy(true);
    setError(null);
    try {
      const json = await backup.exportJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `kanjipain-backup-${localDayKey(Date.now())}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1_000);
      setNotice('Backup exported. Keep the downloaded JSON file somewhere safe.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The backup could not be exported.');
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = async (file: File) => {
    setError(null);
    setNotice(null);
    setPreview(null);
    setPreviewText('');
    if (file.size > MAX_BACKUP_BYTES) {
      setError('That file is larger than 25 MiB and cannot be imported.');
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const validated = await backup.previewImport(text);
      setPreview(validated);
      setPreviewText(text);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The backup could not be validated.');
    } finally {
      setBusy(false);
    }
  };

  const replaceProgress = async () => {
    if (previewText === '') {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const restored = await backup.replaceWithImport(previewText);
      setPreview(null);
      setPreviewText('');
      setNotice(
        `Backup restored: ${String(restored.counts.cards)} cards, ${String(restored.counts.events)} review events, ` +
          `${String(restored.counts.sessions)} sessions, ${String(restored.counts.contentIssues)} content issues, ` +
          `and ${String(restored.counts.decks)} custom decks.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The backup could not be restored. Current progress was preserved.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (activeSessionId !== undefined) {
    return (
      <section className="panel" aria-labelledby="backup-title">
        <h2 id="backup-title">Portable progress</h2>
        <p>
          Backup export and import are disabled while a practice session is active. This keeps
          restore semantics explicit and avoids replacing a session mid-attempt.
        </p>
        <Link className="button button--primary" to="/practice">
          Resume the active session
        </Link>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="backup-title">
      <h2 id="backup-title">Portable progress</h2>
      <p>
        Export a validated JSON backup of cards, schedules, review history, finished sessions,
        settings, content issues, and custom decks. Import replaces current progress in one
        transaction; it never merges two histories. Drawings are not included.
      </p>

      <div className="backup-actions">
        <div>
          <h3>Export</h3>
          <p className="muted">
            The file is a consistent snapshot taken in a read transaction. Keep it somewhere safe;
            it is not encrypted.
          </p>
          <Button
            disabled={busy}
            onClick={() => {
              void exportCurrent();
            }}
          >
            {busy ? 'Working…' : 'Export backup'}
          </Button>
        </div>

        <div>
          <h3>Import</h3>
          <p className="muted" id="import-help">
            Files are checked for size, JSON shape, scheduler compatibility, record relationships,
            and catalog membership before anything is written. Maximum size: 25 MiB.
          </p>
          <label className="file-input">
            <span>Choose a backup file</span>
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              aria-describedby="import-help"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file !== undefined) {
                  void chooseFile(file);
                }
              }}
            />
          </label>
        </div>
      </div>

      {error === null ? null : (
        <div className="banner banner--error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {notice === null ? null : (
        <div className="banner banner--notice" role="status">
          <p>{notice}</p>
        </div>
      )}

      {preview === null ? null : (
        <ImportPreview
          preview={preview}
          busy={busy}
          onConfirm={() => {
            void replaceProgress();
          }}
          onCancel={() => {
            setPreview(null);
            setPreviewText('');
          }}
          onExportCurrent={() => {
            void exportCurrent();
          }}
        />
      )}
    </section>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  const sessions = useSessions();
  // The keyed form resets when stored preferences change; keep save feedback outside it.
  const [preferencesNotice, setPreferencesNotice] = useState<string | null>(null);

  if (settings === undefined || sessions === undefined) {
    return (
      <section className="panel" aria-busy="true">
        <h1>Settings</h1>
        <p role="status">Loading your preferences…</p>
      </section>
    );
  }

  const activeSession = sessions.find((session) => session.status === 'active');

  return (
    <div className="settings-shell">
      <section className="panel" aria-labelledby="settings-title">
        <p className="eyebrow">Local-first configuration</p>
        <h1 id="settings-title">Settings</h1>
        <p>
          KanjiPain keeps all progress in this browser. Preferences affect future planning and
          attempts, never your saved history.
        </p>
      </section>

      <section className="panel" aria-labelledby="deck-setting-title">
        <h2 id="deck-setting-title">Deck</h2>
        <p>
          Sessions, the Dojo and the Collection use the active deck. Switching decks never changes
          progress: a character keeps one schedule in every deck that contains it.
        </p>
        <DeckSwitcher />
      </section>

      <PreferencesForm
        key={`${String(settings.dailyNewLimit)}:${settings.inputMode}`}
        current={settings}
        notice={preferencesNotice}
        onNotice={setPreferencesNotice}
      />
      <BackupPanel activeSessionId={activeSession?.id} />

      <section className="panel" aria-labelledby="storage-title">
        <h2 id="storage-title">Local storage</h2>
        <p>
          Cards, events, sessions, settings, content issues, and custom decks live in IndexedDB
          under the
          <code> kanjipain </code> database. Clearing site data or using a private window that is
          discarded will remove this progress.
        </p>
        <p className="muted">
          There is no account or server copy. Export a backup before clearing browser data, changing
          devices, or making large changes. Exported files are plain JSON and exclude the
          2,136-character catalog and every drawing.
        </p>
        {activeSession === undefined ? null : (
          <p className="muted">
            An active session started {formatDateTime(activeSession.startedAt)}. Finish or resume it
            before backing up or restoring.
          </p>
        )}
      </section>
    </div>
  );
}
