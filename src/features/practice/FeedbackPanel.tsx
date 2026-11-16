import { useId, useMemo, useState } from 'react';

import { useKeyboardShortcuts } from '../../app/useKeyboardShortcuts';
import { AnswerGlyph } from '../../components/AnswerGlyph';
import { Button } from '../../components/Button';
import { CharacterFacts } from '../../components/CharacterFacts';
import { Lookalikes, type LookalikeItem } from '../../components/Lookalikes';
import { StrokeOrder } from '../../components/StrokeOrder';
import { UnrecognizedWarning } from '../../components/UnrecognizedWarning';
import { DrawingPad } from '../../components/DrawingPad';
import type { FeedbackPhase } from '../../domain/session-types';
import type { CheckerVerdict, Grade, KanjiId, StudyEntry, UnixMs } from '../../domain/types';
import { checkDrawing, suggestedGrade, type CheckResult } from '../../recognition/check';
import { useReferenceStrokes } from '../../recognition/useReferenceStrokes';
import type { GradePreview } from '../../services/review-service';
import { formatDueIn, formatInterval } from '../format';

interface FeedbackPanelProps {
  readonly phase: FeedbackPhase;
  readonly entry: StudyEntry;
  readonly busy: boolean;
  /** Characters of the deck outside the bundled stroke data, to check and compare against. */
  readonly extraReferenceIds?: readonly KanjiId[];
  /** Characters easily confused with this one, to compare it against. */
  readonly lookalikes?: readonly LookalikeItem[];
  readonly literalOf: (id: KanjiId) => string | undefined;
  /** When the character would come back after each grade; absent when grading does not reschedule it. */
  readonly gradePreview?: GradePreview | null | undefined;
  /** For a rematch: the review date already set, which no grade here changes. */
  readonly unchangedDue?: { readonly dueAt: UnixMs; readonly now: UnixMs } | undefined;
  readonly onGrade: (grade: Grade, checkerVerdict?: CheckerVerdict) => void;
  readonly onFlagAmbiguous: () => void;
}

const GRADE_LABELS: Readonly<Record<Grade, string>> = {
  got: 'Got it',
  barely: 'Barely',
  missed: 'Missed it',
};

const MARK_LEGEND = [
  { mark: 'order', color: '#b05a00', label: 'written out of order' },
  { mark: 'direction', color: '#1c5fa8', label: 'written backwards' },
  { mark: 'off', color: '#b3261e', label: 'out of place' },
] as const;

function strokes(count: number): string {
  return `${String(count)} ${count === 1 ? 'stroke' : 'strokes'}`;
}

interface VerdictText {
  readonly tone: 'good' | 'partial' | 'bad';
  readonly title: string;
  readonly detail: string;
}

function describeVerdict(
  result: CheckResult,
  literal: string,
  lookalike: string | undefined,
): VerdictText {
  const count = (mark: string) => result.marks.filter((value) => value === mark).length;
  switch (result.verdict) {
    case 'match':
      return {
        tone: 'good',
        title: `This matches ${literal}.`,
        detail: 'The shape, stroke count and stroke order are right.',
      };
    case 'order':
      return {
        tone: 'partial',
        title: 'Right shape, wrong stroke order.',
        detail: `${strokes(count('order'))} were not written in the standard order.`,
      };
    case 'direction':
      return {
        tone: 'partial',
        title: 'Right shape, wrong stroke direction.',
        detail: `${strokes(count('direction'))} ran in the opposite direction to the standard one.`,
      };
    case 'stroke-count':
      return result.shapeClose
        ? {
            tone: 'partial',
            title: 'Right shape, different stroke count.',
            detail: `You used ${strokes(result.drawnStrokes)}; the standard form has ${String(result.expectedStrokes)}. Some strokes were joined or split.`,
          }
        : {
            tone: 'bad',
            title: 'The stroke count is off.',
            detail: `You drew ${strokes(result.drawnStrokes)}; ${literal} has ${String(result.expectedStrokes)}.`,
          };
    case 'lookalike':
      return {
        tone: 'bad',
        title:
          lookalike === undefined
            ? 'This looks like a different character.'
            : `This looks more like ${lookalike}.`,
        detail: `Compare your drawing with ${literal} above.`,
      };
    default:
      return {
        tone: 'bad',
        title: `This does not match ${literal}.`,
        detail: `${String(count('off'))} of ${strokes(result.drawnStrokes)} are out of place.`,
      };
  }
}

export function FeedbackPanel({
  phase,
  entry,
  busy,
  extraReferenceIds,
  lookalikes = [],
  literalOf,
  gradePreview,
  unchangedDue,
  onGrade,
  onFlagAmbiguous,
}: FeedbackPanelProps) {
  const intervalId = useId();
  const { draft } = phase;
  const assisted = draft.surrendered || draft.hintKeysUsed.length > 0;
  const references = useReferenceStrokes(extraReferenceIds);
  const [showModel, setShowModel] = useState(true);
  const [override, setOverride] = useState<Grade | null>(null);
  const [strokeOrderChoice, setStrokeOrderChoice] = useState<boolean | null>(null);

  const drawn = draft.inputMode === 'drawing' && draft.strokes.length > 0;
  const check = useMemo(
    () =>
      drawn && typeof references === 'object'
        ? checkDrawing(draft.strokes, entry.id, references, {
            alternateStrokeCount: entry.strokeCount ?? undefined,
          })
        : null,
    [drawn, draft.strokes, entry.id, entry.strokeCount, references],
  );
  // No stroke data for this character: no verdict, overlay or suggested grade.
  const unrecognized = typeof references === 'object' && !references.has(entry.id);
  const suggestion = check === null ? null : suggestedGrade(check);
  // The way to write the character is open after anything but a correct drawing; a learner
  // who got it right can still ask for it.
  const strokeOrderOpen =
    strokeOrderChoice ?? !(drawn && (references === 'loading' || check?.verdict === 'match'));
  const verdict =
    check === null
      ? null
      : describeVerdict(
          check,
          entry.literal,
          check.lookalikeId === null ? undefined : literalOf(check.lookalikeId),
        );
  const legend = MARK_LEGEND.filter(({ mark }) => check?.marks.includes(mark) === true);

  const gradeKey = (grade: Grade) =>
    busy || assisted || override !== null
      ? undefined
      : () => {
          choose(grade);
        };
  useKeyboardShortcuts({
    '1': gradeKey('got'),
    '2': gradeKey('barely'),
    '3': gradeKey('missed'),
    enter:
      busy || !assisted
        ? undefined
        : () => {
            onGrade('missed', check?.verdict);
          },
    escape:
      override === null
        ? undefined
        : () => {
            setOverride(null);
          },
  });

  function choose(grade: Grade) {
    // Grading a rejected drawing as correct has to be a deliberate act.
    if (suggestion === 'missed' && grade !== 'missed') {
      setOverride(grade);
      return;
    }
    onGrade(grade, check?.verdict);
  }

  return (
    <section className="exercise-panel" aria-labelledby="feedback-title">
      <p className="eyebrow">Compare honestly</p>
      <h2 id="feedback-title">The character was</h2>
      <AnswerGlyph kanjiId={entry.id} literal={entry.literal} />
      <CharacterFacts entry={entry} />
      <Lookalikes items={lookalikes} />

      <div className="feedback-layout">
        <div>
          <h3>Your attempt</h3>
          {draft.inputMode === 'drawing' ? (
            <>
              <DrawingPad
                strokes={draft.strokes}
                onStrokesChange={() => undefined}
                readOnly
                label="Your submitted drawing"
                marks={check?.marks}
                guide={check !== null && showModel ? check.guide : undefined}
              />
              {check === null ? null : (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={showModel}
                    onChange={(event) => {
                      setShowModel(event.target.checked);
                    }}
                  />
                  Show the correct strokes over my drawing
                </label>
              )}
              {legend.length === 0 ? null : (
                <ul className="mark-legend">
                  {legend.map(({ mark, color, label }) => (
                    <li key={mark}>
                      <span style={{ background: color }} aria-hidden="true" />
                      {label}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="attempt-note">
              You confirmed a paper attempt. Compare it with the character above.
            </p>
          )}
          {unrecognized ? null : (
            <>
              <h3>How to write it</h3>
              {strokeOrderOpen ? (
                <StrokeOrder key={entry.id} kanjiId={entry.id} literal={entry.literal} />
              ) : null}
              <Button
                aria-expanded={strokeOrderOpen}
                onClick={() => {
                  setStrokeOrderChoice(!strokeOrderOpen);
                }}
              >
                {strokeOrderOpen ? 'Hide the stroke order' : 'Show the stroke order'}
              </Button>
            </>
          )}
        </div>
        <div>
          <h3>How did it go?</h3>
          {verdict === null ? null : (
            <div className={`check-verdict check-verdict--${verdict.tone}`} role="status">
              <p>
                <strong>{verdict.title}</strong>
              </p>
              <p>{verdict.detail}</p>
            </div>
          )}
          {unrecognized ? <UnrecognizedWarning /> : null}
          {drawn && references === 'loading' ? (
            <p className="muted" role="status">
              Checking your drawing…
            </p>
          ) : null}
          {assisted ? (
            <>
              <p className="assistance-note">
                Assisted recall — we&apos;ll practice this again. A hint or a reveal means this
                attempt counts as a miss.
                {gradePreview == null
                  ? ''
                  : gradePreview.dueAt.missed <= gradePreview.now
                    ? ' It stays due and returns in your next session.'
                    : ` Its next review will be ${formatDueIn(gradePreview.dueAt.missed, gradePreview.now)}.`}
              </p>
              <Button
                variant="primary"
                disabled={busy}
                aria-keyshortcuts="Enter"
                onClick={() => {
                  onGrade('missed', check?.verdict);
                }}
              >
                Continue — practice again
              </Button>
            </>
          ) : override !== null ? (
            <div className="banner banner--notice" role="alertdialog" aria-label="Confirm grade">
              <p>
                The checker did not accept this drawing as <span lang="ja">{entry.literal}</span>.
                Grade it &ldquo;{GRADE_LABELS[override]}&rdquo; anyway?
              </p>
              <div className="button-row">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => {
                    onGrade(override, check?.verdict);
                  }}
                >
                  Yes, the checker is wrong
                </Button>
                <Button
                  disabled={busy}
                  aria-keyshortcuts="Escape"
                  onClick={() => {
                    setOverride(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p>
                {suggestion === null
                  ? 'The app cannot judge this attempt. Compare the shape yourself and grade honestly.'
                  : `Suggested grade: ${GRADE_LABELS[suggestion]}. The checker can be wrong — the grade is your call.`}
              </p>
              <div className="button-row">
                {(['got', 'barely', 'missed'] as const).map((grade, index) => (
                  <Button
                    key={grade}
                    {...(grade === (suggestion ?? 'got') ? { variant: 'primary' as const } : {})}
                    disabled={busy}
                    aria-keyshortcuts={String(index + 1)}
                    aria-describedby={gradePreview == null ? undefined : `${intervalId}-${grade}`}
                    className={gradePreview == null ? '' : 'button--grade'}
                    onClick={() => {
                      choose(grade);
                    }}
                  >
                    {GRADE_LABELS[grade]}
                    {gradePreview == null ? null : (
                      // Kept out of the button's name; screen readers get a sentence instead.
                      <span className="grade-interval" aria-hidden="true">
                        {formatInterval(gradePreview.dueAt[grade] - gradePreview.now)}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
              {gradePreview == null ? null : (
                <>
                  {(['got', 'barely', 'missed'] as const).map((grade) => (
                    <span key={grade} id={`${intervalId}-${grade}`} hidden>
                      Next review {formatDueIn(gradePreview.dueAt[grade], gradePreview.now)}.
                    </span>
                  ))}
                  <p className="muted">
                    Under each grade: how long until this character comes back if you choose it.
                  </p>
                </>
              )}
              <p className="muted shortcut-hint">
                Keyboard: <kbd>1</kbd> Got it, <kbd>2</kbd> Barely, <kbd>3</kbd> Missed it.
              </p>
            </>
          )}
          {unchangedDue === undefined ? null : (
            <p className="muted">
              This is a rematch, so no grade changes the schedule: the next review stays{' '}
              {unchangedDue.dueAt <= unchangedDue.now
                ? 'due now'
                : formatDueIn(unchangedDue.dueAt, unchangedDue.now)}
              .
            </p>
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
