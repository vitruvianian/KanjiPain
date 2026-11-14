import type { StudyEntry } from '../domain/types';

function readingsText(readings: readonly string[]): string {
  return readings.length === 0 ? 'None listed' : readings.join('・');
}

/** A character's meanings, readings and stroke count, from the dictionary or a custom deck. */
export function CharacterFacts({ entry }: { readonly entry: StudyEntry }) {
  return (
    <>
      <dl className="character-facts">
        <div>
          <dt>Meanings</dt>
          <dd>{entry.meanings.length === 0 ? 'None listed' : entry.meanings.join(', ')}</dd>
        </div>
        {entry.readings === undefined ? (
          <>
            <div>
              <dt>On readings</dt>
              <dd lang="ja">{readingsText(entry.onReadings)}</dd>
            </div>
            <div>
              <dt>Kun readings</dt>
              <dd lang="ja">{readingsText(entry.kunReadings)}</dd>
            </div>
          </>
        ) : (
          <div>
            <dt>Readings</dt>
            <dd lang="ja">{readingsText(entry.readings)}</dd>
          </div>
        )}
        <div>
          <dt>Strokes</dt>
          <dd>{entry.strokeCount === null ? 'Unknown' : String(entry.strokeCount)}</dd>
        </div>
      </dl>
      {entry.note === undefined ? null : (
        <p className="teaching-note">
          <strong>Note:</strong> {entry.note}
        </p>
      )}
    </>
  );
}
