import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useAppServices, useCard, useDeckContent } from '../../app/useAppServices';
import { Button } from '../../components/Button';
import { literalFromKanjiId } from '../../domain/ids';
import { FeedbackPanel } from './FeedbackPanel';
import { IntroductionPanel } from './IntroductionPanel';
import { PromptPanel } from './PromptPanel';
import { RepairPanel } from './RepairPanel';
import { ShortRematchPanel } from './ShortRematchPanel';
import type { SessionMode } from '../../domain/session-types';
import { usePracticeSession } from './usePracticeSession';

function exerciseCounts(primaryRemaining: number, rematchRemaining: number): string {
  return `${String(primaryRemaining)} primary · ${String(rematchRemaining)} rematch`;
}

function modeFrom(value: string | null): SessionMode {
  return value === 'extra-new' || value === 'review-ahead' ? value : 'regular';
}

const MODE_LABELS: Readonly<Record<Exclude<SessionMode, 'regular'>, string>> = {
  'extra-new': 'Extra session: new characters',
  'review-ahead': 'Extra session: reviewing ahead',
};

export function PracticePage() {
  const [searchParams] = useSearchParams();
  const practice = usePracticeSession(modeFrom(searchParams.get('mode')));
  const { catalog } = useAppServices();
  const navigate = useNavigate();
  const { session, loading, busy, error, notice, shortRematch, refresh, openNext } = practice;

  const phase = session?.phase;
  const phaseCardId =
    phase !== undefined && phase.kind !== 'selecting' && phase.kind !== 'summary'
      ? phase.cardId
      : '';
  const card = useCard(phaseCardId);
  // A session keeps the deck it started with, whichever deck is active now.
  const content = useDeckContent(session?.deckId);
  const extraReferenceIds = useMemo(
    () =>
      (content?.entries ?? [])
        .filter((entry) => entry.strokeCount !== null && catalog.byId(entry.id) === undefined)
        .map((entry) => entry.id),
    [catalog, content],
  );

  useEffect(() => {
    if (session !== null && session.status !== 'active') {
      void navigate(`/sessions/${session.id}`, { replace: true });
    }
  }, [navigate, session]);

  useEffect(() => {
    if (
      session !== null &&
      session.status === 'active' &&
      session.phase.kind === 'selecting' &&
      shortRematch === null
    ) {
      void openNext();
    }
  }, [openNext, session, shortRematch]);

  if (loading) {
    return (
      <div className="practice-shell">
        <p role="status">Opening your practice session…</p>
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="practice-shell">
        <section className="panel" role="alert">
          <h1>Practice could not start</h1>
          <p>{error ?? 'The saved session could not be opened.'}</p>
          <Button
            variant="primary"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload app
          </Button>
        </section>
      </div>
    );
  }

  const entry =
    phase === undefined || content === undefined || content === null
      ? undefined
      : phase.kind === 'introduction'
        ? content.byId(phase.kanjiId)
        : card === undefined
          ? undefined
          : content.byId(card.kanjiId);
  const note = entry === undefined ? undefined : content?.noteFor(entry.id);
  const primaryPending = session.primaryItems.filter((item) => item.status === 'pending').length;
  const rematchPending = session.rematchItems.filter((item) => item.status === 'pending').length;

  return (
    <div className="practice-shell">
      <h1 className="visually-hidden">Practice</h1>
      <div className="practice-toolbar">
        <p className="practice-progress">
          {content === undefined || content === null ? null : (
            <span className="practice-deck">{content.deck.name} · </span>
          )}
          {session.mode === undefined ? null : (
            <span className="practice-mode">{MODE_LABELS[session.mode]} · </span>
          )}
          <span className="muted">Remaining:</span> {exerciseCounts(primaryPending, rematchPending)}
        </p>
        <Button
          disabled={busy || session.status !== 'active'}
          onClick={() => {
            void practice.finish();
          }}
        >
          Finish session
        </Button>
      </div>

      {notice === null ? null : (
        <div className="banner banner--notice" role="status">
          <p>{notice}</p>
        </div>
      )}

      {error === null ? null : (
        <div className="banner banner--error" role="alert">
          <p>
            <strong>That step could not be saved.</strong> {error}
          </p>
          <div className="button-row">
            <Button
              onClick={() => {
                void refresh();
              }}
            >
              Reload saved progress
            </Button>
          </div>
        </div>
      )}

      {entry === undefined &&
      (phase?.kind === 'prompt' || phase?.kind === 'feedback' || phase?.kind === 'repair') ? (
        <p role="status">Loading the character…</p>
      ) : null}

      {entry !== undefined && phase?.kind === 'introduction' ? (
        <IntroductionPanel
          entry={entry}
          {...(note === undefined ? {} : { note })}
          busy={busy}
          onHide={() => {
            void practice.hideIntroduction();
          }}
        />
      ) : null}

      {entry !== undefined && phase?.kind === 'prompt' ? (
        <PromptPanel
          key={`${phase.draft.id}:${String(practice.reloadToken)}`}
          phase={phase}
          entry={entry}
          {...(note === undefined ? {} : { note })}
          busy={busy}
          onSaveDraft={(change) => {
            void practice.saveDraft(change);
          }}
          onRequestHint={() => {
            void practice.requestHint();
          }}
          onReveal={(reason) => {
            void practice.reveal(reason);
          }}
        />
      ) : null}

      {entry !== undefined && phase?.kind === 'feedback' ? (
        <FeedbackPanel
          phase={phase}
          entry={entry}
          busy={busy}
          extraReferenceIds={extraReferenceIds}
          literalOf={literalFromKanjiId}
          onGrade={(grade, checkerVerdict) => {
            void practice.grade(grade, checkerVerdict);
          }}
          onFlagAmbiguous={() => {
            void practice.flagAmbiguous();
          }}
        />
      ) : null}

      {entry !== undefined && phase?.kind === 'repair' ? (
        <RepairPanel
          key={`${phase.itemId}:${String(practice.reloadToken)}`}
          phase={phase}
          entry={entry}
          busy={busy}
          onSaveDraft={(change) => {
            void practice.saveDraft(change);
          }}
          onFinishRepair={() => {
            void practice.finishRepair();
          }}
        />
      ) : null}

      {phase?.kind === 'selecting' && shortRematch !== null ? (
        <ShortRematchPanel
          busy={busy}
          onAccept={() => {
            void practice.acceptShortRematch();
          }}
          onFinish={() => {
            void practice.finish();
          }}
        />
      ) : null}

      {phase?.kind === 'selecting' && shortRematch === null ? (
        <p role="status">Preparing the next exercise…</p>
      ) : null}
    </div>
  );
}
