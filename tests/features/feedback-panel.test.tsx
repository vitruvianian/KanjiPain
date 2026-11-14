import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FeedbackPhase } from '../../src/domain/session-types';
import type { InputMode, Stroke } from '../../src/domain/types';
import { FeedbackPanel } from '../../src/features/practice/FeedbackPanel';
import { loadBundledCatalog } from '../../src/services/catalog';

afterEach(cleanup);

const catalog = loadBundledCatalog();
const one = (() => {
  const entry = catalog.byId('k-4e00');
  if (entry === undefined) throw new Error('一 is missing from the catalog.');
  return entry;
})();

const horizontal: Stroke[] = [
  [
    { x: 0.15, y: 0.5 },
    { x: 0.5, y: 0.49 },
    { x: 0.85, y: 0.5 },
  ],
];
const vertical: Stroke[] = [
  [
    { x: 0.5, y: 0.15 },
    { x: 0.5, y: 0.85 },
  ],
];

function phase(strokes: Stroke[], inputMode: InputMode = 'drawing'): FeedbackPhase {
  return {
    kind: 'feedback',
    itemId: 'item',
    cardId: 'card',
    expectedCardVersion: 0,
    draft: {
      id: 'attempt',
      itemId: 'item',
      startedAt: 1,
      inputMode,
      strokes,
      paperAttemptConfirmed: inputMode === 'paper',
      hintKeysUsed: [],
      surrendered: false,
      revealedAt: 2,
    },
  };
}

function renderPanel(feedback: FeedbackPhase) {
  const onGrade = vi.fn();
  render(
    <FeedbackPanel
      phase={feedback}
      entry={one}
      busy={false}
      literalOf={(id) => catalog.byId(id)?.literal}
      onGrade={onGrade}
      onFlagAmbiguous={vi.fn()}
    />,
  );
  return onGrade;
}

describe('FeedbackPanel handwriting check', () => {
  it('confirms a correct drawing, suggests the grade, and overlays the model', async () => {
    const user = userEvent.setup();
    const onGrade = renderPanel(phase(horizontal));

    expect(await screen.findByText('This matches 一.')).toBeInTheDocument();
    expect(screen.getByText(/Suggested grade: Got it/)).toBeInTheDocument();
    expect(screen.getByTestId('model-strokes').querySelectorAll('polyline')).toHaveLength(1);
    await user.click(screen.getByRole('checkbox', { name: /Show the correct strokes/ }));
    expect(screen.queryByTestId('model-strokes')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onGrade).toHaveBeenCalledExactlyOnceWith('got', 'match');
  });

  it('requires confirmation before grading a rejected drawing as correct', async () => {
    const user = userEvent.setup();
    const onGrade = renderPanel(phase(vertical));

    expect(await screen.findByText('This does not match 一.')).toBeInTheDocument();
    expect(screen.getByText(/Suggested grade: Missed it/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onGrade).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Barely' }));
    await user.click(screen.getByRole('button', { name: 'Yes, the checker is wrong' }));
    expect(onGrade).toHaveBeenCalledExactlyOnceWith('barely', 'mismatch');
  });

  it('accepts a miss on a rejected drawing without confirmation', async () => {
    const user = userEvent.setup();
    const onGrade = renderPanel(phase(vertical));
    await screen.findByText('This does not match 一.');
    await user.click(screen.getByRole('button', { name: 'Missed it' }));
    expect(onGrade).toHaveBeenCalledExactlyOnceWith('missed', 'mismatch');
  });

  it('leaves paper attempts to self-grading', async () => {
    const user = userEvent.setup();
    const onGrade = renderPanel(phase([], 'paper'));
    expect(screen.getByText(/The app cannot judge this attempt/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onGrade).toHaveBeenCalledExactlyOnceWith('got', undefined);
  });
});
