import { chooseNextItem } from './queue';
import type {
  PrimarySessionItem,
  RematchSessionItem,
  SessionRecord,
  SessionReducerEvent,
  SessionItemStatus,
} from './session-types';
import type { ReviewEvent, Stroke, UnrevealedAttemptDraft } from './types';

export class InvalidSessionTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSessionTransitionError';
  }
}

type LocatedItem =
  | { readonly type: 'primary'; readonly item: PrimarySessionItem }
  | { readonly type: 'rematch'; readonly item: RematchSessionItem };

function reject(message: string): never {
  throw new InvalidSessionTransitionError(message);
}

function locateItem(session: SessionRecord, itemId: string): LocatedItem {
  const primary = session.primaryItems.find((item) => item.id === itemId);
  if (primary !== undefined) {
    return { type: 'primary', item: primary };
  }
  const rematch = session.rematchItems.find((item) => item.id === itemId);
  if (rematch !== undefined) {
    return { type: 'rematch', item: rematch };
  }
  return reject(`Session item ${itemId} does not exist.`);
}

function assertActive(session: SessionRecord): void {
  if (session.status !== 'active') {
    reject('A finished session cannot transition again.');
  }
}

function nextRevision(session: SessionRecord, changes: Partial<SessionRecord>): SessionRecord {
  return {
    ...session,
    ...changes,
    revision: session.revision + 1,
  };
}

function withItemStatus(
  session: SessionRecord,
  itemId: string,
  status: SessionItemStatus,
): Pick<SessionRecord, 'primaryItems' | 'rematchItems'> {
  return {
    primaryItems: session.primaryItems.map((item) =>
      item.id === itemId ? { ...item, status } : item,
    ),
    rematchItems: session.rematchItems.map((item) =>
      item.id === itemId ? { ...item, status } : item,
    ),
  };
}

function assertDraftIdentity(
  draft: UnrevealedAttemptDraft,
  itemId: string,
  previous?: UnrevealedAttemptDraft,
): void {
  if (draft.itemId !== itemId) {
    reject('Attempt draft does not belong to the active item.');
  }
  if (draft.surrendered) {
    reject('Surrender can only be recorded while revealing an attempt.');
  }
  if (
    previous !== undefined &&
    (draft.id !== previous.id || draft.startedAt !== previous.startedAt)
  ) {
    reject('Attempt identity and start time cannot be edited.');
  }
  if (previous?.hintKeysUsed.some((hint) => !draft.hintKeysUsed.includes(hint)) === true) {
    reject('A requested hint cannot be removed from an attempt.');
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertReviewMatchesFeedback(
  session: SessionRecord,
  event: ReviewEvent,
  item: LocatedItem,
): void {
  if (session.phase.kind !== 'feedback') {
    reject('A grade or ambiguity skip requires revealed feedback.');
  }
  const { phase } = session;
  if (
    event.sessionId !== session.id ||
    event.itemId !== phase.itemId ||
    event.cardId !== phase.cardId ||
    event.id !== phase.draft.id
  ) {
    reject('Review event identity does not match the active attempt.');
  }
  if (event.occurredAt < phase.draft.revealedAt) {
    reject('A review event cannot precede its reveal.');
  }
  if (event.inputMode !== phase.draft.inputMode) {
    reject('Review input mode does not match the frozen attempt.');
  }
  if (!sameStrings(event.hintKeysUsed, phase.draft.hintKeysUsed)) {
    reject('Review hints do not match the frozen attempt.');
  }
  const assisted = phase.draft.surrendered || phase.draft.hintKeysUsed.length > 0;
  if (event.assisted !== assisted) {
    reject('Review assistance does not match the frozen attempt.');
  }
  if (event.beforeVersion !== phase.expectedCardVersion) {
    reject('Review card version does not match the active attempt.');
  }

  const expectedKind = item.type === 'primary' ? 'scheduled' : 'rematch';
  if (event.kind !== 'ambiguous' && event.kind !== expectedKind) {
    reject(`Expected a ${expectedKind} review event for this item.`);
  }
}

function appendGapCredit(
  rematches: readonly RematchSessionItem[],
  completedEvent: ReviewEvent,
): RematchSessionItem[] {
  return rematches.map((item) => {
    if (
      item.status !== 'pending' ||
      item.cardId === completedEvent.cardId ||
      item.afterOtherCompletions.some((completion) => completion.cardId === completedEvent.cardId)
    ) {
      return item;
    }

    return {
      ...item,
      afterOtherCompletions: [
        ...item.afterOtherCompletions,
        { cardId: completedEvent.cardId, eventId: completedEvent.id },
      ],
    };
  });
}

function retryOrdinal(item: LocatedItem, grade: ReviewEvent['grade']): 1 | 2 | null {
  if (grade !== 'missed') {
    return null;
  }
  if (item.type === 'primary') {
    return 1;
  }
  return item.item.ordinal === 1 ? 2 : null;
}

function commitGrade(
  session: SessionRecord,
  event: Extract<SessionReducerEvent, { type: 'commit-grade' }>,
): SessionRecord {
  if (session.phase.kind !== 'feedback') {
    return reject('A grade cannot be committed before answer reveal.');
  }
  const item = locateItem(session, session.phase.itemId);
  const review = event.reviewEvent;
  assertReviewMatchesFeedback(session, review, item);

  if (review.kind === 'ambiguous') {
    return reject('A graded transition requires a scheduled or rematch grade.');
  }
  if ((review.assisted || session.phase.draft.surrendered) && review.grade !== 'missed') {
    return reject('Assisted or surrendered recall must be graded missed.');
  }
  if (item.type === 'primary' && review.afterVersion !== review.beforeVersion + 1) {
    return reject('A scheduled review must increment the card version once.');
  }
  if (item.type === 'rematch' && review.afterVersion !== review.beforeVersion) {
    return reject('A rematch must not change the card version.');
  }
  if (session.completedEventIds.includes(review.id)) {
    return reject(`Review event ${review.id} was already completed.`);
  }

  const ordinal = retryOrdinal(item, review.grade);
  if ((ordinal === null) !== (event.retryItemId === undefined)) {
    return reject(
      ordinal === null
        ? 'This result must not enqueue another rematch.'
        : 'A failed primary or first rematch requires a supplied retry item ID.',
    );
  }

  const itemStatus = withItemStatus(session, item.item.id, 'done');
  let rematchItems = itemStatus.rematchItems;

  if (ordinal !== null && event.retryItemId !== undefined) {
    if (
      session.primaryItems.some((candidate) => candidate.id === event.retryItemId) ||
      session.rematchItems.some((candidate) => candidate.id === event.retryItemId)
    ) {
      return reject(`Retry item ID ${event.retryItemId} already exists.`);
    }
    if (
      rematchItems.some(
        (candidate) => candidate.cardId === review.cardId && candidate.status === 'pending',
      )
    ) {
      return reject(`Card ${review.cardId} already has a pending rematch.`);
    }
    rematchItems = [
      ...rematchItems,
      {
        id: event.retryItemId,
        cardId: review.cardId,
        ordinal,
        afterOtherCompletions: [],
        status: 'pending',
        expectedCardVersion: review.afterVersion,
      },
    ];
  }

  if (item.type === 'rematch' && review.grade !== 'missed') {
    rematchItems = rematchItems.map((candidate) =>
      candidate.cardId === review.cardId && candidate.status === 'pending'
        ? { ...candidate, status: 'skipped' }
        : candidate,
    );
  }

  rematchItems = appendGapCredit(rematchItems, review);
  const phase =
    review.grade === 'missed'
      ? {
          kind: 'repair' as const,
          itemId: item.item.id,
          cardId: item.item.cardId,
          committedEventId: review.id,
          targetHidden: false,
          practiceStrokes: [],
        }
      : { kind: 'selecting' as const };

  return nextRevision(session, {
    primaryItems: itemStatus.primaryItems,
    rematchItems,
    completedEventIds: [...session.completedEventIds, review.id],
    phase,
  });
}

function skipAmbiguity(
  session: SessionRecord,
  event: Extract<SessionReducerEvent, { type: 'skip-ambiguity' }>,
): SessionRecord {
  if (session.phase.kind !== 'feedback') {
    return reject('Ambiguity can only be recorded after answer reveal.');
  }
  const item = locateItem(session, session.phase.itemId);
  const review = event.reviewEvent;
  assertReviewMatchesFeedback(session, review, item);
  if (review.schedulerLog !== null) {
    return reject('An ambiguity skip must use an ungraded event without an FSRS result.');
  }
  if (session.completedEventIds.includes(review.id)) {
    return reject(`Review event ${review.id} was already completed.`);
  }

  return nextRevision(session, {
    ...withItemStatus(session, item.item.id, 'skipped'),
    completedEventIds: [...session.completedEventIds, review.id],
    phase: { kind: 'selecting' },
  });
}

function finishSession(
  session: SessionRecord,
  endedAt: number,
  status: 'completed' | 'ended',
): SessionRecord {
  if (endedAt < session.startedAt) {
    return reject('A session cannot end before it started.');
  }

  return nextRevision(session, {
    status,
    endedAt,
    primaryItems: session.primaryItems.map((item) =>
      item.status === 'pending' ? { ...item, status: 'skipped' } : item,
    ),
    rematchItems: session.rematchItems.map((item) =>
      item.status === 'pending' ? { ...item, status: 'skipped' } : item,
    ),
    phase: { kind: 'summary' },
  });
}

function cloneStrokes(strokes: readonly Stroke[]): Stroke[] {
  return strokes.map((stroke) => stroke.map((point) => ({ ...point })));
}

export function reduceSession(session: SessionRecord, event: SessionReducerEvent): SessionRecord {
  assertActive(session);

  switch (event.type) {
    case 'open-item': {
      if (session.phase.kind !== 'selecting') {
        return reject('An item can only open from the selecting phase.');
      }
      const decision = chooseNextItem(session);
      if (
        (event.selection === 'automatic' &&
          (decision.kind !== 'item' || decision.itemId !== event.itemId)) ||
        (event.selection === 'short-rematch' &&
          (decision.kind !== 'short-rematch-offer' || decision.itemId !== event.itemId))
      ) {
        return reject('The requested item is not the current queue decision.');
      }

      const located = locateItem(session, event.itemId);
      if (located.item.status !== 'pending') {
        return reject('Only a pending item can be opened.');
      }
      if (event.target.kind === 'introduction') {
        if (located.type !== 'primary') {
          return reject('Rematches never show an introduction.');
        }
        return nextRevision(session, {
          phase: {
            kind: 'introduction',
            itemId: located.item.id,
            cardId: located.item.cardId,
            kanjiId: located.item.kanjiId,
          },
        });
      }

      if (located.type === 'primary' && located.item.origin === 'new') {
        return reject('A planned new character must be introduced before prompting.');
      }
      if (located.item.expectedCardVersion !== event.target.expectedCardVersion) {
        return reject('Prompt card version does not match the planned item.');
      }
      assertDraftIdentity(event.target.draft, located.item.id);
      return nextRevision(session, {
        phase: {
          kind: 'prompt',
          itemId: located.item.id,
          cardId: located.item.cardId,
          expectedCardVersion: event.target.expectedCardVersion,
          draft: event.target.draft,
        },
      });
    }

    case 'hide-introduction': {
      if (session.phase.kind !== 'introduction') {
        return reject('Only an introduction can be hidden to start an attempt.');
      }
      const item = locateItem(session, session.phase.itemId);
      if (item.type !== 'primary') {
        return reject('An introduction must belong to a primary item.');
      }
      if (
        item.item.expectedCardVersion !== null &&
        item.item.expectedCardVersion !== event.expectedCardVersion
      ) {
        return reject('Introduced card version does not match the planned item.');
      }
      assertDraftIdentity(event.draft, item.item.id);
      const primaryItems = session.primaryItems.map((candidate) =>
        candidate.id === item.item.id
          ? { ...candidate, expectedCardVersion: event.expectedCardVersion }
          : candidate,
      );
      return nextRevision(session, {
        primaryItems,
        phase: {
          kind: 'prompt',
          itemId: item.item.id,
          cardId: item.item.cardId,
          expectedCardVersion: event.expectedCardVersion,
          draft: event.draft,
        },
      });
    }

    case 'save-draft': {
      if (session.phase.kind !== 'prompt') {
        return reject('A revealed or inactive answer is frozen and cannot be edited.');
      }
      assertDraftIdentity(event.draft, session.phase.itemId, session.phase.draft);
      return nextRevision(session, {
        phase: { ...session.phase, draft: event.draft },
      });
    }

    case 'reveal': {
      if (session.phase.kind !== 'prompt') {
        return reject('Only an active prompt can reveal its answer.');
      }
      const draft = session.phase.draft;
      if (event.revealedAt < draft.startedAt) {
        return reject('An answer cannot be revealed before the attempt started.');
      }
      if (
        event.reason === 'compare' &&
        draft.strokes.length === 0 &&
        !draft.paperAttemptConfirmed
      ) {
        return reject('Compare requires a drawing or confirmed paper attempt.');
      }
      return nextRevision(session, {
        phase: {
          ...session.phase,
          kind: 'feedback',
          draft: {
            ...draft,
            surrendered: event.reason === 'surrender',
            revealedAt: event.revealedAt,
          },
        },
      });
    }

    case 'commit-grade':
      return commitGrade(session, event);

    case 'skip-ambiguity':
      return skipAmbiguity(session, event);

    case 'update-repair': {
      if (session.phase.kind !== 'repair') {
        return reject('Repair drawing can only change during the repair phase.');
      }
      return nextRevision(session, {
        phase: {
          ...session.phase,
          targetHidden: event.targetHidden,
          practiceStrokes: cloneStrokes(event.practiceStrokes),
        },
      });
    }

    case 'complete-repair':
      if (session.phase.kind !== 'repair') {
        return reject('Only a committed miss can complete repair.');
      }
      return nextRevision(session, { phase: { kind: 'selecting' } });

    case 'skip-item': {
      if (session.phase.kind !== 'selecting') {
        return reject('A planned item can only be skipped while selecting.');
      }
      const item = locateItem(session, event.itemId);
      if (item.type !== 'primary' || item.item.origin !== 'new' || item.item.status !== 'pending') {
        return reject('Only a pending planned-new item can be skipped before opening.');
      }
      return nextRevision(session, {
        ...withItemStatus(session, item.item.id, 'skipped'),
      });
    }

    case 'complete':
      if (session.phase.kind !== 'selecting' || chooseNextItem(session).kind !== 'complete') {
        return reject('A session can only complete after all planned work is resolved.');
      }
      return finishSession(session, event.endedAt, 'completed');

    case 'finish':
      return finishSession(session, event.endedAt, 'ended');
  }
}
