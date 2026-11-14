import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { Button } from '../../src/components/Button';
import { Dialog } from '../../src/components/Dialog';
import { DrawingPad } from '../../src/components/DrawingPad';
import { PaperInput } from '../../src/components/PaperInput';
import type { Stroke } from '../../src/domain/types';
import '../../src/styles/global.css';

export function InputFixture() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [frozen, setFrozen] = useState(false);
  const [paper, setPaper] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [dialog, setDialog] = useState(false);
  return (
    <main className="site-main">
      <h1>Input verification</h1>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={paper}
          onChange={(event) => {
            setPaper(event.target.checked);
          }}
        />
        Paper mode
      </label>
      {paper ? (
        <PaperInput confirmed={confirmed} onConfirmedChange={setConfirmed} readOnly={frozen} />
      ) : (
        <DrawingPad strokes={strokes} onStrokesChange={setStrokes} readOnly={frozen} />
      )}
      <Button
        onClick={() => {
          setFrozen(!frozen);
        }}
      >
        {frozen ? 'Unfreeze' : 'Freeze'}
      </Button>
      <Button
        onClick={() => {
          setDialog(true);
        }}
      >
        Help
      </Button>
      <Dialog
        open={dialog}
        title="Input help"
        onClose={() => {
          setDialog(false);
        }}
      >
        <p>Draw or confirm a paper attempt.</p>
      </Dialog>
      <Button
        onClick={() => {
          setStrokes([Array.from({ length: 19_999 }, () => ({ x: 0.5, y: 0.5 }))]);
        }}
      >
        Load near point limit
      </Button>
      <Button
        onClick={() => {
          setStrokes(Array.from({ length: 99 }, () => [{ x: 0.5, y: 0.5 }]));
        }}
      >
        Load near stroke limit
      </Button>
      <output data-testid="strokes" hidden>
        {JSON.stringify(strokes)}
      </output>
    </main>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Fixture root missing.');
createRoot(root).render(<InputFixture />);
