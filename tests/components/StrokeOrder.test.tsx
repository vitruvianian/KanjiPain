import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StrokeOrder } from '../../src/components/StrokeOrder';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function reduceMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches: reduce }));
}

describe('StrokeOrder', () => {
  it('shows a numbered step for every stroke, each adding one stroke', async () => {
    reduceMotion(true);
    render(<StrokeOrder kanjiId="k-65e5" literal="日" />);

    const steps = await screen.findAllByRole('img', { name: /^Stroke \d of 4$/ });
    expect(steps).toHaveLength(4);
    steps.forEach((step, index) => {
      expect(step.querySelectorAll('.stroke-order__earlier path')).toHaveLength(index);
      expect(step.querySelectorAll('.stroke-order__current')).toHaveLength(1);
      expect(step.querySelectorAll('.stroke-order__start')).toHaveLength(1);
    });
    expect(screen.getByText(/Write the 4 strokes in the numbered order/)).toBeInTheDocument();
  });

  it('starts fully drawn when motion is reduced and animates only on request', async () => {
    reduceMotion(true);
    const user = userEvent.setup();
    render(<StrokeOrder kanjiId="k-65e5" literal="日" />);

    const animation = await screen.findByRole('img', {
      name: 'Stroke order animation for 日: 4 strokes',
    });
    expect(animation.querySelectorAll('.stroke-order__labels text')).toHaveLength(4);
    expect(screen.getByTestId('stroke-order-ink').querySelectorAll('path')).toHaveLength(4);

    await user.click(screen.getByRole('button', { name: 'Replay stroke order' }));
    expect(screen.getByTestId('stroke-order-ink').querySelectorAll('path')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Restart stroke order' })).toBeInTheDocument();
  });

  it('animates the strokes in order by default', async () => {
    reduceMotion(false);
    render(<StrokeOrder kanjiId="k-4e00" literal="一" />);
    await screen.findByRole('img', { name: 'Stroke order animation for 一: 1 stroke' });
    expect(screen.getByText(/Write the single stroke/)).toBeInTheDocument();
    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: 'Replay stroke order' })).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    expect(screen.getByTestId('stroke-order-ink').querySelectorAll('path')).toHaveLength(1);
  });

  it('says so when a character has no stroke data', async () => {
    reduceMotion(true);
    render(<StrokeOrder kanjiId="k-0000" literal="?" />);
    expect(await screen.findByText(/stroke order for this character is unavailable/)).toBeVisible();
  });
});
