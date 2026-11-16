import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FeedbackPhase } from '../../src/domain/session-types';
import type { InputMode, Stroke } from '../../src/domain/types';
import { FeedbackPanel } from '../../src/features/practice/FeedbackPanel';
import { loadBundledCatalog } from '../../src/services/catalog';

afterEach(cleanup);

const catalog = await loadBundledCatalog();
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

  it('shows how to write the character after a wrong drawing', async () => {
    const user = userEvent.setup();
    renderPanel(phase(vertical));

    expect(
      await screen.findByRole('img', { name: 'Stroke order animation for 一: 1 stroke' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide the stroke order' }));
    expect(screen.queryByRole('img', { name: /Stroke order animation/ })).not.toBeInTheDocument();
  });

  it('keeps the stroke order folded after a correct drawing until asked for', async () => {
    const user = userEvent.setup();
    renderPanel(phase(horizontal));

    await screen.findByText('This matches 一.');
    expect(screen.queryByRole('img', { name: /Stroke order animation/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show the stroke order' }));
    expect(screen.getByRole('img', { name: /Stroke order animation/ })).toBeInTheDocument();
  });

  it('shows how to write the character after a paper attempt', async () => {
    renderPanel(phase([], 'paper'));
    expect(
      await screen.findByRole('img', { name: /Stroke order animation for 一/ }),
    ).toBeInTheDocument();
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
    // Once the stroke order guide has loaded, nothing is left checking or judging.
    await screen.findByRole('img', { name: /Stroke order animation/ });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onGrade).toHaveBeenCalledExactlyOnceWith('got', undefined);
  });

  it('warns and leaves grading to the learner when the character has no stroke data', async () => {
    const user = userEvent.setup();
    const onGrade = vi.fn();
    render(
      <FeedbackPanel
        phase={phase(horizontal)}
        entry={{
          id: 'k-2603',
          literal: '☃',
          meanings: ['snowman'],
          onReadings: [],
          kunReadings: [],
          readings: [],
          strokeCount: null,
          curriculumOrder: 0,
        }}
        busy={false}
        literalOf={() => undefined}
        onGrade={onGrade}
        onFlagAmbiguous={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(/Not recognized: stroke order and automatic checking/),
    ).toBeInTheDocument();
    expect(screen.getByText(/The app cannot judge this attempt/)).toBeInTheDocument();
    expect(screen.queryByText(/Suggested grade/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: /Show the correct strokes/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('model-strokes')).not.toBeInTheDocument();

    // No verdict is recorded, so statistics keep these attempts apart from checked ones.
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onGrade).toHaveBeenCalledExactlyOnceWith('got', undefined);
  });

  it('checks a custom-deck character against stroke data outside the Jōyō set', async () => {
    render(
      <FeedbackPanel
        phase={phase(vertical)}
        entry={{
          id: 'k-9df2',
          literal: '鷲',
          meanings: ['eagle'],
          onReadings: [],
          kunReadings: [],
          readings: ['わし'],
          strokeCount: 23,
          curriculumOrder: 0,
        }}
        busy={false}
        extraReferenceIds={['k-9df2']}
        literalOf={() => undefined}
        onGrade={vi.fn()}
        onFlagAmbiguous={vi.fn()}
      />,
    );

    expect(await screen.findByText('The stroke count is off.')).toBeInTheDocument();
    expect(screen.getByText(/鷲 has 23/)).toBeInTheDocument();
    expect(screen.queryByText(/Not recognized/)).not.toBeInTheDocument();
  });
});

describe('FeedbackPanel keyboard and look-alikes', () => {
  it('grades with 1, 2 and 3, and Escape cancels an override', async () => {
    const user = userEvent.setup();
    const onGrade = renderPanel(phase(vertical));
    await screen.findByText('This does not match 一.');

    await user.keyboard('1');
    expect(onGrade).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Confirm grade' })).toBeInTheDocument();
    // Grade keys wait while the override question is open.
    await user.keyboard('2');
    expect(onGrade).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.keyboard('3');
    expect(onGrade).toHaveBeenCalledExactlyOnceWith('missed', 'mismatch');
  });

  it('grades an accepted drawing from the keyboard', async () => {
    const user = userEvent.setup();
    const onGrade = renderPanel(phase(horizontal));
    await screen.findByText('This matches 一.');
    await user.keyboard('2');
    expect(onGrade).toHaveBeenCalledExactlyOnceWith('barely', 'match');
  });

  it('shows the answer drawn from its strokes, and look-alikes to compare', async () => {
    render(
      <FeedbackPanel
        phase={phase([], 'paper')}
        entry={one}
        busy={false}
        lookalikes={[{ id: 'k-4e8c', literal: '二', meaning: 'two' }]}
        literalOf={(id) => catalog.byId(id)?.literal}
        onGrade={vi.fn()}
        onFlagAmbiguous={vi.fn()}
      />,
    );
    expect(await screen.findByTestId('answer-glyph')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Don.t confuse it with/ })).toBeInTheDocument();
    expect(screen.getByText('二')).toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
  });
});

describe('FeedbackPanel next-review preview', () => {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const now = 1_800_000_000_000;

  function renderWith(
    props: Partial<Parameters<typeof FeedbackPanel>[0]>,
    feedback = phase([], 'paper'),
  ) {
    render(
      <FeedbackPanel
        phase={feedback}
        entry={one}
        busy={false}
        literalOf={(id) => catalog.byId(id)?.literal}
        onGrade={vi.fn()}
        onFlagAmbiguous={vi.fn()}
        {...props}
      />,
    );
  }

  it('shows on each grade when the character would come back, without renaming the buttons', () => {
    renderWith({
      gradePreview: {
        now,
        dueAt: { got: now + 4 * DAY, barely: now + 2 * DAY, missed: now + 10 * 60_000 },
      },
    });

    const got = screen.getByRole('button', { name: 'Got it' });
    expect(got).toHaveTextContent('4d');
    expect(got).toHaveAccessibleDescription('Next review in 4 days.');
    expect(screen.getByRole('button', { name: 'Barely' })).toHaveTextContent('2d');
    const missed = screen.getByRole('button', { name: 'Missed it' });
    expect(missed).toHaveTextContent('10m');
    expect(missed).toHaveAccessibleDescription('Next review in 10 minutes.');
  });

  it('tells an assisted attempt when it returns', () => {
    const assisted = phase([], 'paper');
    renderWith(
      {
        gradePreview: { now, dueAt: { got: now + 4 * DAY, barely: now + DAY, missed: now + DAY } },
      },
      { ...assisted, draft: { ...assisted.draft, hintKeysUsed: ['stroke-count'] } },
    );

    expect(screen.getByText(/Its next review will be in 1 day\./)).toBeInTheDocument();
  });

  it('says a rematch leaves the schedule alone and shows no intervals', () => {
    renderWith({ unchangedDue: { dueAt: now + 5 * HOUR, now } });

    expect(screen.getByText(/no grade changes the schedule/)).toHaveTextContent('in 5 hours');
    expect(screen.getByRole('button', { name: 'Got it' })).toHaveTextContent(/^Got it$/);
  });
});
