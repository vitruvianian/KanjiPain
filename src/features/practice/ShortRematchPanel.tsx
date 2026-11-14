import { Button } from '../../components/Button';

interface ShortRematchPanelProps {
  readonly busy: boolean;
  readonly onAccept: () => void;
  readonly onFinish: () => void;
}

export function ShortRematchPanel({ busy, onAccept, onFinish }: ShortRematchPanelProps) {
  return (
    <section className="exercise-panel" aria-labelledby="short-rematch-title">
      <p className="eyebrow">Keep it close</p>
      <h2 id="short-rematch-title">Short rematch — less spacing this time</h2>
      <p>
        A character you missed is ready to return, but there are no other exercises left to put
        between repetitions.
      </p>
      <p>Practice it now, or finish and let a later session bring it back.</p>
      <div className="button-row">
        <Button variant="primary" disabled={busy} onClick={onAccept}>
          Practice it now
        </Button>
        <Button disabled={busy} onClick={onFinish}>
          Finish session
        </Button>
      </div>
    </section>
  );
}
