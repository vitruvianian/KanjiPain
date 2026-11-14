import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DrawingPad } from '../../src/components/DrawingPad';
import { PaperInput } from '../../src/components/PaperInput';
import type { Stroke } from '../../src/domain/types';

afterEach(cleanup);

const strokes: Stroke[] = [
  [{ x: 0.25, y: 0.75 }],
  [
    { x: 0.1, y: 0.2 },
    { x: 0.9, y: 0.8 },
  ],
];

describe('DrawingPad', () => {
  it('renders normalized dots and paths and emits only completed undo/clear changes', () => {
    const change = vi.fn();
    render(<DrawingPad strokes={strokes} onStrokesChange={change} />);
    const drawing = screen.getByTestId('completed-strokes');
    expect(drawing.querySelector('circle')).toHaveAttribute('cx', '250');
    expect(drawing.querySelectorAll('[data-stroke]')).toHaveLength(2);
    expect(drawing.querySelector('path')?.getAttribute('d')).toMatch(/^M[\d.]+ [\d.]+ Q.+Z$/);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(change).toHaveBeenLastCalledWith([strokes[0]]);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(change).toHaveBeenLastCalledWith([]);
    expect(strokes).toHaveLength(2);
  });

  it('undoes the last stroke with Ctrl+Z, but not while typing in a field', () => {
    const change = vi.fn();
    render(
      <>
        <input aria-label="note" />
        <DrawingPad strokes={strokes} onStrokesChange={change} />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText('note'), { key: 'z', ctrlKey: true });
    expect(change).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(change).toHaveBeenLastCalledWith([strokes[0]]);
  });

  it('freezes controls and ignores pointer input when readOnly', () => {
    const change = vi.fn();
    render(<DrawingPad strokes={strokes} onStrokesChange={change} readOnly />);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    fireEvent.pointerDown(screen.getByRole('img'), { pointerId: 1, button: 0 });
    fireEvent.pointerUp(screen.getByRole('img'), { pointerId: 1, button: 0 });
    expect(change).not.toHaveBeenCalled();
  });

  it.each([
    { limited: Array.from({ length: 100 }, (): Stroke => [{ x: 0.5, y: 0.5 }]) },
    { limited: [Array.from({ length: 20_000 }, () => ({ x: 0.5, y: 0.5 }))] },
  ])('shows an actionable message at the drawing limits', ({ limited }) => {
    render(<DrawingPad strokes={limited} onStrokesChange={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Undo a stroke or clear/);
  });
});

describe('PaperInput', () => {
  it('reports confirmation without a canvas event and respects readOnly', () => {
    const change = vi.fn();
    const view = render(<PaperInput confirmed={false} onConfirmedChange={change} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'I wrote it on paper' }));
    expect(change).toHaveBeenCalledWith(true);
    view.rerender(<PaperInput confirmed onConfirmedChange={change} readOnly />);
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});
