import { Button } from '../../components/Button';
import type { BackupPreview } from '../../services/backup-service';
import { formatDateTime } from '../format';

interface ImportPreviewProps {
  readonly preview: BackupPreview;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onExportCurrent: () => void;
}

export function ImportPreview({
  preview,
  busy,
  onConfirm,
  onCancel,
  onExportCurrent,
}: ImportPreviewProps) {
  return (
    <section className="panel import-preview" aria-labelledby="import-preview-title">
      <h3 id="import-preview-title">Review this backup</h3>
      <p>
        Exported {formatDateTime(preview.exportedAt)}. Importing replaces all current local
        progress; records are never merged.
      </p>

      <dl className="import-counts">
        <div>
          <dt>Cards</dt>
          <dd>{String(preview.counts.cards)}</dd>
        </div>
        <div>
          <dt>Review events</dt>
          <dd>{String(preview.counts.events)}</dd>
        </div>
        <div>
          <dt>Sessions</dt>
          <dd>{String(preview.counts.sessions)}</dd>
        </div>
        <div>
          <dt>Content issues</dt>
          <dd>{String(preview.counts.contentIssues)}</dd>
        </div>
        <div>
          <dt>Daily new limit</dt>
          <dd>{String(preview.settings.dailyNewLimit)}</dd>
        </div>
        <div>
          <dt>Input preference</dt>
          <dd>{preview.settings.inputMode === 'drawing' ? 'Drawing pad' : 'Paper'}</dd>
        </div>
      </dl>

      <p className="import-dataset">
        <span className="muted">Dataset version:</span>{' '}
        <code className="hash">{preview.datasetVersion}</code>
      </p>
      {preview.datasetVersionMatches ? null : (
        <div className="banner banner--notice">
          <p>
            This backup was created with a different catalog version. It is accepted because every
            recorded character exists in the current catalog. Each record keeps its original dataset
            metadata.
          </p>
        </div>
      )}

      <div className="banner banner--error">
        <p>
          <strong>
            This replaces your current cards, schedules, history, settings, and issues.
          </strong>{' '}
          Export current progress first if you may need it.
        </p>
      </div>

      <div className="button-row">
        <Button variant="primary" disabled={busy} onClick={onConfirm}>
          {busy ? 'Replacing progress…' : 'Replace current progress'}
        </Button>
        <Button disabled={busy} onClick={onExportCurrent}>
          Export current progress first
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          Cancel import
        </Button>
      </div>
    </section>
  );
}
