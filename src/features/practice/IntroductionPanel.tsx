import { Button } from '../../components/Button';
import { StrokeOrder } from '../../components/StrokeOrder';
import type { KanjiEntry, TeachingNote } from '../../domain/types';

interface IntroductionPanelProps {
  readonly entry: KanjiEntry;
  readonly note?: TeachingNote;
  readonly busy: boolean;
  readonly onHide: () => void;
}

function readingsText(readings: readonly string[]): string {
  return readings.length === 0 ? 'None listed' : readings.join('・');
}

export function IntroductionPanel({ entry, note, busy, onHide }: IntroductionPanelProps) {
  return (
    <section className="exercise-panel" aria-labelledby="introduction-title">
      <p className="eyebrow">New character</p>
      <h2 id="introduction-title">Meet the character</h2>
      <p className="glyph" lang="ja">
        {entry.literal}
      </p>
      <dl className="character-facts">
        <div>
          <dt>Meanings</dt>
          <dd>{entry.meanings.join(', ')}</dd>
        </div>
        <div>
          <dt>On readings</dt>
          <dd lang="ja">{readingsText(entry.onReadings)}</dd>
        </div>
        <div>
          <dt>Kun readings</dt>
          <dd lang="ja">{readingsText(entry.kunReadings)}</dd>
        </div>
        <div>
          <dt>Strokes</dt>
          <dd>{String(entry.strokeCount)}</dd>
        </div>
      </dl>
      {note?.mnemonicHint === undefined ? null : (
        <p className="teaching-note">
          <strong>Mnemonic:</strong> {note.mnemonicHint}
        </p>
      )}
      {note?.componentHint === undefined ? null : (
        <p className="teaching-note">
          <strong>Component cue:</strong> {note.componentHint}
        </p>
      )}
      <h3>How to write it</h3>
      <StrokeOrder key={entry.id} kanjiId={entry.id} literal={entry.literal} />
      <p>
        Study the shape and the stroke order now. Next you will hide it and write it from memory.
      </p>
      <Button variant="primary" onClick={onHide} disabled={busy}>
        Hide and try
      </Button>
    </section>
  );
}
