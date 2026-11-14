import { Button } from '../../components/Button';
import { DrawingPad } from '../../components/DrawingPad';
import type { FeedbackPhase } from '../../domain/session-types';
import type { Grade, KanjiEntry } from '../../domain/types';

interface FeedbackPanelProps {
  readonly phase: FeedbackPhase;
  readonly entry: KanjiEntry;
  readonly busy: boolean;
  readonly onGrade: (grade: Grade) => void;
  readonly onFlagAmbiguous: () => void;
}

function readingsText(readings: readonly string[]): string {
  return readings.length === 0 ? 'None listed' : readings.join('・');
}

export function FeedbackPanel({
  phase,
  entry,
  busy,
  onGrade,
  onFlagAmbiguous,
}: FeedbackPanelProps) {
  const { draft } = phase;
  const assisted = draft.surrendered || draft.hintKeysUsed.length > 0;

  return (
    <section className="exercise-panel" aria-labelledby="feedback-title">
      <p className="eyebrow">Compare honestly</p>
      <h2 id="feedback-title">The character was</h2>
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

      <div className="feedback-layout">
        <div>
          <h3>Your attempt</h3>
          {draft.inputMode === 'drawing' ? (
            <DrawingPad
              strokes={draft.strokes}
              onStrokesChange={() => undefined}
              readOnly
              label="Your submitted drawing"
            />
          ) : (
            <p className="attempt-note">
              You confirmed a paper attempt. Compare it with the character above.
            </p>
          )}
        </div>
        <div>
          <h3>How did it go?</h3>
          {assisted ? (
            <>
              <p className="assistance-note">
                Assisted recall — we&apos;ll practice this again. A hint or a reveal means this
                attempt counts as a miss.
              </p>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  onGrade('missed');
                }}
              >
                Continue — practice again
              </Button>
            </>
          ) : (
            <>
              <p>
                The app cannot judge your handwriting. Compare the shape yourself and grade
                honestly.
              </p>
              <div className="button-row">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => {
                    onGrade('got');
                  }}
                >
                  Got it
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    onGrade('barely');
                  }}
                >
                  Barely
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    onGrade('missed');
                  }}
                >
                  Missed it
                </Button>
              </div>
            </>
          )}
          <p className="muted">
            Got it: correct without extra help. Barely: correct but hesitant. Missed it: wrong,
            incomplete, or assisted.
          </p>
          <Button
            disabled={busy}
            onClick={() => {
              onFlagAmbiguous();
            }}
          >
            This prompt is ambiguous
          </Button>
          <p className="muted">
            Use this when the cue points at more than one character. The card pauses instead of
            recording a failure.
          </p>
        </div>
      </div>
    </section>
  );
}
