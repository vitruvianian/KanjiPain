import { useState } from 'react';

import { Button } from '../../components/Button';
import { DrawingPad } from '../../components/DrawingPad';
import { PaperInput } from '../../components/PaperInput';
import { buildPrompt } from '../../domain/prompts';
import type { PromptPhase } from '../../domain/session-types';
import type { InputMode, KanjiEntry, Stroke, TeachingNote } from '../../domain/types';
import type { DraftChange } from '../../services/session-service';

interface PromptPanelProps {
  readonly phase: PromptPhase;
  readonly entry: KanjiEntry;
  readonly note?: TeachingNote;
  readonly busy: boolean;
  readonly onSaveDraft: (change: DraftChange) => void;
  readonly onRequestHint: () => void;
  readonly onReveal: (reason: 'compare' | 'surrender') => void;
}

export function PromptPanel({
  phase,
  entry,
  note,
  busy,
  onSaveDraft,
  onRequestHint,
  onReveal,
}: PromptPanelProps) {
  const { draft } = phase;
  const [strokes, setStrokes] = useState<Stroke[]>(draft.strokes);
  const [paperConfirmed, setPaperConfirmed] = useState(draft.paperAttemptConfirmed);
  const [inputMode, setInputMode] = useState<InputMode>(draft.inputMode);
  const prompt = buildPrompt(entry, note);
  const allHintKeys = [...prompt.hints.map((hint) => hint.key), 'full-answer' as const];
  const moreHints = allHintKeys.some((key) => !draft.hintKeysUsed.includes(key));
  const hasAttempt = strokes.length > 0 || paperConfirmed;

  function changeMode(mode: InputMode) {
    setInputMode(mode);
    onSaveDraft({ inputMode: mode });
  }

  return (
    <section className="exercise-panel" aria-labelledby="prompt-title">
      <p className="eyebrow">Write from memory</p>
      <h2 id="prompt-title">Write the kanji for:</h2>
      <p className="prompt-meaning">{prompt.meaningCue}</p>
      <p className="prompt-readings">
        Reading cues: <span lang="ja">{prompt.readingCues.join('・')}</span>
      </p>

      <fieldset className="mode-switch">
        <legend>Input mode</legend>
        <label>
          <input
            type="radio"
            name="input-mode"
            value="drawing"
            checked={inputMode === 'drawing'}
            disabled={busy}
            onChange={() => {
              changeMode('drawing');
            }}
          />
          Draw here
        </label>
        <label>
          <input
            type="radio"
            name="input-mode"
            value="paper"
            checked={inputMode === 'paper'}
            disabled={busy}
            onChange={() => {
              changeMode('paper');
            }}
          />
          Write on paper
        </label>
      </fieldset>

      {inputMode === 'drawing' ? (
        <DrawingPad
          strokes={strokes}
          onStrokesChange={(next) => {
            setStrokes(next);
            onSaveDraft({ strokes: next });
          }}
        />
      ) : (
        <PaperInput
          confirmed={paperConfirmed}
          onConfirmedChange={(confirmed) => {
            setPaperConfirmed(confirmed);
            onSaveDraft({ paperAttemptConfirmed: confirmed });
          }}
        />
      )}

      {draft.hintKeysUsed.length === 0 ? null : (
        <div className="hint-list" aria-label="Requested hints">
          <p className="hint-warning">A hint marks this attempt as assisted.</p>
          {prompt.hints
            .filter((hint) => draft.hintKeysUsed.includes(hint.key))
            .map((hint) => (
              <p key={hint.key} className="hint">
                {hint.text}
              </p>
            ))}
        </div>
      )}

      <p className="muted">
        {hasAttempt
          ? 'Compare when you are ready to see the character.'
          : 'Draw at least one stroke or confirm a paper attempt before comparing.'}
      </p>

      <div className="button-row">
        <Button
          variant="primary"
          disabled={busy || !hasAttempt}
          onClick={() => {
            onReveal('compare');
          }}
        >
          Compare answer
        </Button>
        <Button
          disabled={busy || !moreHints}
          onClick={() => {
            onRequestHint();
          }}
        >
          Give me a foothold
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            onReveal('surrender');
          }}
        >
          I don&apos;t know
        </Button>
      </div>
      <p className="muted">
        &ldquo;I don&apos;t know&rdquo; reveals the answer and records this attempt as a miss. It
        needs no drawing.
      </p>
    </section>
  );
}
