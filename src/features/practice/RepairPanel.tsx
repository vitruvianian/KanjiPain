import { useState } from 'react';

import { Button } from '../../components/Button';
import { DrawingPad } from '../../components/DrawingPad';
import { StrokeOrder } from '../../components/StrokeOrder';
import type { RepairPhase } from '../../domain/session-types';
import type { Stroke, StudyEntry } from '../../domain/types';
import type { DraftChange } from '../../services/session-service';

interface RepairPanelProps {
  readonly phase: RepairPhase;
  readonly entry: StudyEntry;
  readonly busy: boolean;
  readonly onSaveDraft: (change: DraftChange) => void;
  readonly onFinishRepair: () => void;
}

export function RepairPanel({ phase, entry, busy, onSaveDraft, onFinishRepair }: RepairPanelProps) {
  const [strokes, setStrokes] = useState<Stroke[]>(phase.practiceStrokes);
  const readings = entry.readings ?? entry.onReadings;

  return (
    <section className="exercise-panel" aria-labelledby="repair-title">
      <p className="eyebrow">Repair</p>
      <h2 id="repair-title">Look closely, then try once more</h2>
      <p>
        This repair is unscored and does not change your schedule. It is a chance to study the shape
        while it is fresh.
      </p>

      {phase.targetHidden ? (
        <>
          <p className="muted">
            The answer is hidden. Redraw it from memory, then reveal the character to compare.
          </p>
          <DrawingPad
            strokes={strokes}
            onStrokesChange={(next) => {
              setStrokes(next);
              onSaveDraft({ practiceStrokes: next });
            }}
            label="Repair drawing area"
          />
          <Button
            disabled={busy}
            onClick={() => {
              onSaveDraft({ targetHidden: false, practiceStrokes: strokes });
            }}
          >
            Show the answer
          </Button>
        </>
      ) : (
        <>
          <p className="glyph" lang="ja">
            {entry.literal}
          </p>
          <p>
            {entry.meanings.join(', ')}
            {entry.meanings.length > 0 && readings.length > 0 ? ' · ' : null}
            <span lang="ja">{readings.join('・')}</span>
          </p>
          <StrokeOrder key={entry.id} kanjiId={entry.id} literal={entry.literal} />
          <Button
            disabled={busy}
            onClick={() => {
              onSaveDraft({ targetHidden: true, practiceStrokes: [] });
            }}
          >
            Hide it and draw once more
          </Button>
        </>
      )}

      <div className="button-row">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            onFinishRepair();
          }}
        >
          Continue
        </Button>
      </div>
    </section>
  );
}
