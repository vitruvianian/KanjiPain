import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppServices } from '../../app/useAppServices';
import type { SessionRecord } from '../../domain/session-types';
import type { CheckerVerdict, Grade, HintKey } from '../../domain/types';
import type { DraftChange } from '../../services/session-service';
import { StaleRevisionError, StorageError } from '../../storage/errors';

export interface ShortRematchOffer {
  readonly itemId: string;
  readonly cardId: string;
}

export interface PracticeSessionController {
  readonly session: SessionRecord | null;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly notice: string | null;
  readonly reloadToken: number;
  readonly shortRematch: ShortRematchOffer | null;
  readonly openNext: () => Promise<void>;
  readonly acceptShortRematch: () => Promise<void>;
  readonly hideIntroduction: () => Promise<void>;
  readonly saveDraft: (change: DraftChange) => Promise<void>;
  readonly requestHint: () => Promise<HintKey | null>;
  readonly reveal: (reason: 'compare' | 'surrender') => Promise<void>;
  readonly grade: (grade: Grade, checkerVerdict?: CheckerVerdict) => Promise<void>;
  readonly flagAmbiguous: () => Promise<void>;
  readonly finishRepair: () => Promise<void>;
  readonly finish: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

function describeError(error: unknown): string {
  if (error instanceof StorageError) {
    return error.message;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return 'KanjiPain could not save that step. Your attempt is still here, so you can try again.';
}

export function usePracticeSession(): PracticeSessionController {
  const { sessions, reviews } = useAppServices();
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shortRematch, setShortRematch] = useState<ShortRematchOffer | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const sessionRef = useRef<SessionRecord | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const applySession = useCallback((next: SessionRecord) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const enqueue = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const result = chain.current.then(task, task);
    chain.current = result.catch(() => undefined);
    return result;
  }, []);

  const recover = useCallback(
    async (failure: unknown) => {
      if (!(failure instanceof StaleRevisionError)) {
        setError(describeError(failure));
        return;
      }

      const current = sessionRef.current;
      try {
        const fresh = current === null ? undefined : await sessions.getSession(current.id);
        if (fresh !== undefined) {
          applySession(fresh);
          setShortRematch(null);
          setReloadToken((token) => token + 1);
          setNotice(
            'Your progress changed in another tab, so KanjiPain reloaded the saved session. Check the current exercise before continuing.',
          );
          setError(null);
          return;
        }
      } catch (refreshFailure) {
        setError(describeError(refreshFailure));
        return;
      }
      setError('This practice session is no longer available. Return to the Dojo to begin again.');
    },
    [applySession, sessions],
  );

  useEffect(() => {
    const alive = { value: true };
    void (async () => {
      try {
        const started = await sessions.startOrResumeSession();
        if (alive.value) {
          applySession(started);
          setLoading(false);
        }
      } catch (failure) {
        if (alive.value) {
          setError(describeError(failure));
          setLoading(false);
        }
      }
    })();
    return () => {
      alive.value = false;
    };
  }, [applySession, sessions]);

  const openNext = useCallback(
    (acceptShortRematch = false): Promise<void> =>
      enqueue(async () => {
        const current = sessionRef.current;
        if (current?.status !== 'active' || current.phase.kind !== 'selecting') {
          return;
        }
        setBusy(true);
        setError(null);
        try {
          let active = current;
          let accept = acceptShortRematch;
          for (;;) {
            const result = await sessions.openNextItem(active.id, active.revision, accept);
            accept = false;
            active = result.session;
            applySession(active);
            setShortRematch(
              active.phase.kind === 'selecting' && result.decision.kind === 'short-rematch-offer'
                ? { itemId: result.decision.itemId, cardId: result.decision.cardId }
                : null,
            );
            if (result.decision.kind !== 'item' || active.phase.kind !== 'selecting') {
              break;
            }
          }
        } catch (failure) {
          await recover(failure);
        } finally {
          setBusy(false);
        }
      }),
    [applySession, enqueue, recover, sessions],
  );

  const hideIntroduction = useCallback((): Promise<void> => {
    return enqueue(async () => {
      const current = sessionRef.current;
      if (current?.phase.kind !== 'introduction') {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        applySession(await sessions.hideIntroduction(current.id, current.revision));
      } catch (failure) {
        await recover(failure);
      } finally {
        setBusy(false);
      }
    });
  }, [applySession, enqueue, recover, sessions]);

  const saveDraft = useCallback(
    (change: DraftChange): Promise<void> =>
      enqueue(async () => {
        const current = sessionRef.current;
        if (current?.phase.kind !== 'prompt' && current?.phase.kind !== 'repair') {
          return;
        }
        try {
          applySession(await sessions.saveDraft(current.id, current.revision, change));
          setError(null);
        } catch (failure) {
          await recover(failure);
        }
      }),
    [applySession, enqueue, recover, sessions],
  );

  const requestHint = useCallback((): Promise<HintKey | null> => {
    return enqueue(async () => {
      const current = sessionRef.current;
      if (current?.phase.kind !== 'prompt') {
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await sessions.requestHint(current.id, current.revision);
        applySession(result.session);
        return result.hintKey;
      } catch (failure) {
        await recover(failure);
        return null;
      } finally {
        setBusy(false);
      }
    });
  }, [applySession, enqueue, recover, sessions]);

  const reveal = useCallback(
    (reason: 'compare' | 'surrender'): Promise<void> =>
      enqueue(async () => {
        const current = sessionRef.current;
        if (current?.phase.kind !== 'prompt') {
          return;
        }
        setBusy(true);
        setError(null);
        try {
          applySession(await sessions.revealAnswer(current.id, current.revision, reason));
        } catch (failure) {
          await recover(failure);
        } finally {
          setBusy(false);
        }
      }),
    [applySession, enqueue, recover, sessions],
  );

  const grade = useCallback(
    (value: Grade, checkerVerdict?: CheckerVerdict): Promise<void> =>
      enqueue(async () => {
        const current = sessionRef.current;
        if (current?.phase.kind !== 'feedback') {
          return;
        }
        const phase = current.phase;
        setBusy(true);
        setError(null);
        try {
          const result = await reviews.commitGrade({
            sessionId: current.id,
            attemptId: phase.draft.id,
            expectedRevision: current.revision,
            expectedCardVersion: phase.expectedCardVersion,
            grade: value,
            checkerVerdict,
          });
          applySession(result.session);
        } catch (failure) {
          await recover(failure);
        } finally {
          setBusy(false);
        }
      }),
    [applySession, enqueue, recover, reviews],
  );

  const flagAmbiguous = useCallback((): Promise<void> => {
    return enqueue(async () => {
      const current = sessionRef.current;
      if (current?.phase.kind !== 'feedback') {
        return;
      }
      const phase = current.phase;
      setBusy(true);
      setError(null);
      try {
        const result = await reviews.flagAmbiguous({
          sessionId: current.id,
          attemptId: phase.draft.id,
          expectedRevision: current.revision,
          expectedCardVersion: phase.expectedCardVersion,
        });
        applySession(result.session);
      } catch (failure) {
        await recover(failure);
      } finally {
        setBusy(false);
      }
    });
  }, [applySession, enqueue, recover, reviews]);

  const finishRepair = useCallback((): Promise<void> => {
    return enqueue(async () => {
      const current = sessionRef.current;
      if (current?.phase.kind !== 'repair') {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        applySession(await sessions.finishRepair(current.id, current.revision));
      } catch (failure) {
        await recover(failure);
      } finally {
        setBusy(false);
      }
    });
  }, [applySession, enqueue, recover, sessions]);

  const finish = useCallback((): Promise<void> => {
    return enqueue(async () => {
      const current = sessionRef.current;
      if (current?.status !== 'active') {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        applySession(await sessions.finishSession(current.id, current.revision));
      } catch (failure) {
        await recover(failure);
      } finally {
        setBusy(false);
      }
    });
  }, [applySession, enqueue, recover, sessions]);

  const refresh = useCallback((): Promise<void> => {
    return enqueue(async () => {
      const current = sessionRef.current;
      if (current === null) {
        return;
      }
      setBusy(true);
      try {
        const fresh = await sessions.getSession(current.id);
        if (fresh === undefined) {
          setError(
            'This practice session is no longer available. Return to the Dojo to begin again.',
          );
          return;
        }
        applySession(fresh);
        setShortRematch(null);
        setReloadToken((token) => token + 1);
        setError(null);
        setNotice(null);
      } catch (failure) {
        setError(describeError(failure));
      } finally {
        setBusy(false);
      }
    });
  }, [applySession, enqueue, sessions]);

  const openNextAutomatic = useCallback((): Promise<void> => openNext(false), [openNext]);
  const acceptShortRematch = useCallback((): Promise<void> => openNext(true), [openNext]);

  return {
    session,
    loading,
    busy,
    error,
    notice,
    reloadToken,
    shortRematch,
    openNext: openNextAutomatic,
    acceptShortRematch,
    hideIntroduction,
    saveDraft,
    requestHint,
    reveal,
    grade,
    flagAmbiguous,
    finishRepair,
    finish,
    refresh,
  };
}
