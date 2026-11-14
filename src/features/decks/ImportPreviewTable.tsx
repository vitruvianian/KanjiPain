import { Button } from '../../components/Button';
import { UNRECOGNIZED_MESSAGE } from '../../components/UnrecognizedWarning';
import type { DeckImportPreview } from '../../services/deck-service';

interface ImportPreviewTableProps {
  readonly preview: DeckImportPreview;
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

const PREVIEW_ROW_LIMIT = 200;

/** What an import would do, shown before anything is written. */
export function ImportPreviewTable({
  preview,
  busy,
  onConfirm,
  onCancel,
}: ImportPreviewTableProps) {
  const added = preview.rows.filter((row) => row.status === 'new').length;
  const merged = preview.rows.length - added;
  const unrecognized = preview.rows.filter((row) => row.strokeCount === null).length;
  const shown = preview.rows.slice(0, PREVIEW_ROW_LIMIT);

  return (
    <section className="panel import-preview" aria-labelledby="deck-import-preview-title">
      <h3 id="deck-import-preview-title">Review this import</h3>
      <p>
        {String(added)} new {added === 1 ? 'character' : 'characters'}
        {merged === 0 ? '' : `, ${String(merged)} already in the deck (merged, not added twice)`}
        {preview.rejected.length === 0
          ? ''
          : `, ${String(preview.rejected.length)} that cannot be used`}
        . Nothing is saved until you confirm.
      </p>

      {unrecognized === 0 ? null : (
        <div className="banner banner--warning" role="note">
          <p>
            <strong>
              {String(unrecognized)} {unrecognized === 1 ? 'character is' : 'characters are'} not
              recognized.
            </strong>{' '}
            {UNRECOGNIZED_MESSAGE}
          </p>
        </div>
      )}

      {preview.rows.length === 0 ? null : (
        <div className="table-scroll">
          <table className="deck-table">
            <caption className="visually-hidden">Characters to import</caption>
            <thead>
              <tr>
                <th scope="col">Character</th>
                <th scope="col">Meanings</th>
                <th scope="col">Readings</th>
                <th scope="col">Stroke order</th>
                <th scope="col">Import</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.kanjiId} className={row.strokeCount === null ? 'row--warning' : ''}>
                  <th scope="row" lang="ja" className="deck-table__literal">
                    {row.draft.literal}
                  </th>
                  <td>{row.draft.meanings.join('; ') || '—'}</td>
                  <td lang="ja">{row.draft.readingCues.join('・') || '—'}</td>
                  <td>
                    {row.strokeCount === null ? (
                      <span className="deck-warning">Not recognized</span>
                    ) : (
                      `${String(row.strokeCount)} ${row.strokeCount === 1 ? 'stroke' : 'strokes'}`
                    )}
                  </td>
                  <td>{row.status === 'new' ? 'New' : 'Already in deck — merged'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview.rows.length > shown.length ? (
        <p className="muted">
          Showing the first {String(shown.length)} of {String(preview.rows.length)} characters.
        </p>
      ) : null}

      {preview.rejected.length === 0 ? null : (
        <>
          <h4>Rows that cannot be used</h4>
          <ul className="rejected-rows">
            {preview.rejected.slice(0, PREVIEW_ROW_LIMIT).map((row, index) => (
              <li key={`${String(row.line)}:${String(index)}`}>
                <span className="muted">Row {String(row.line)}:</span>{' '}
                <span lang="ja">{row.text === '' ? '(empty)' : row.text.slice(0, 60)}</span> —{' '}
                {row.reason}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="button-row">
        <Button variant="primary" disabled={busy || preview.rows.length === 0} onClick={onConfirm}>
          {busy
            ? 'Saving…'
            : `Add ${String(preview.rows.length)} ${preview.rows.length === 1 ? 'character' : 'characters'}`}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          Cancel import
        </Button>
      </div>
    </section>
  );
}
