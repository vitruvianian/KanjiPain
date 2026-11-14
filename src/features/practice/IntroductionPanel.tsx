import { Button } from '../../components/Button';
import { CharacterFacts } from '../../components/CharacterFacts';
import { StrokeOrder } from '../../components/StrokeOrder';
import type { StudyEntry, TeachingNote } from '../../domain/types';

interface IntroductionPanelProps {
  readonly entry: StudyEntry;
  readonly note?: TeachingNote;
  readonly busy: boolean;
  readonly onHide: () => void;
}

export function IntroductionPanel({ entry, note, busy, onHide }: IntroductionPanelProps) {
  const mnemonic = note?.mnemonicHint ?? entry.mnemonic;
  return (
    <section className="exercise-panel" aria-labelledby="introduction-title">
      <p className="eyebrow">New character</p>
      <h2 id="introduction-title">Meet the character</h2>
      <p className="glyph" lang="ja">
        {entry.literal}
      </p>
      <CharacterFacts entry={entry} />
      {mnemonic === undefined ? null : (
        <p className="teaching-note">
          <strong>Mnemonic:</strong> {mnemonic}
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
        {entry.strokeCount === null
          ? 'Study the shape now. Next you will hide it and write it from memory.'
          : 'Study the shape and the stroke order now. Next you will hide it and write it from memory.'}
      </p>
      <Button variant="primary" onClick={onHide} disabled={busy}>
        Hide and try
      </Button>
    </section>
  );
}
