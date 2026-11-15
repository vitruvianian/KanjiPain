import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useAppServices, useBackupStatus, useSyncStatus } from '../../app/useAppServices';
import { Button } from '../../components/Button';
import { formatDate } from '../format';

/** The date of the last backup, and a nudge to export another after many reviews. */
export function BackupStatusPanel() {
  const { backup } = useAppServices();
  const status = useBackupStatus();
  const [busy, setBusy] = useState(false);
  // A signed-in account already holds a copy, so the nudge to export would be wrong.
  const synced = useSyncStatus().kind === 'signed-in';
  if (status === undefined) return null;

  const reviews = status.reviewsSinceExport;
  return (
    <div className="backup-status">
      {status.reminderDue && !synced ? (
        <div className="banner banner--warning" role="status">
          <p>
            <strong>Time for a backup.</strong>{' '}
            {status.lastExportAt === null
              ? `You have done ${String(reviews)} reviews and have not exported a backup yet.`
              : `You have done ${String(reviews)} reviews since your last backup.`}{' '}
            Progress lives only in this browser, and clearing site data would erase it.
          </p>
          <div className="button-row">
            <Link className="button button--primary" to="/settings">
              Export a backup
            </Link>
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void backup.dismissReminder().finally(() => {
                  setBusy(false);
                });
              }}
            >
              Remind me later
            </Button>
          </div>
        </div>
      ) : null}
      <p className="muted">
        {status.lastExportAt === null
          ? 'No backup exported from this browser yet.'
          : `Last backup: ${formatDate(status.lastExportAt)}.`}{' '}
        {synced ? 'Progress also syncs with your account. ' : null}
        <Link to="/settings">Backups in Settings</Link>
      </p>
    </div>
  );
}
