import { Link } from 'react-router-dom';

import { useAllCards, useAppServices, useSessions, useSettings } from '../../app/useAppServices';
import { useNow } from '../../app/useNow';
import { localDayKey } from '../../domain/date';
import { planSession } from '../../domain/queue';
import { formatDate } from '../format';
import { ExtraPractice } from '../practice/ExtraPractice';
import { Onboarding } from './Onboarding';

function estimateMinutes(exerciseCount: number): number {
  return Math.max(1, Math.ceil((exerciseCount * 30) / 60));
}

function Stat({
  label,
  value,
  description,
}: {
  readonly label: string;
  readonly value: number;
  readonly description: string;
}) {
  return (
    <div className="home-stat">
      <dt>{label}</dt>
      <dd>
        <span className="home-stat__value">{String(value)}</span>
        <span className="home-stat__description">{description}</span>
      </dd>
    </div>
  );
}

export function HomePage() {
  const { catalog } = useAppServices();
  const settings = useSettings();
  const cards = useAllCards();
  const sessions = useSessions();
  const now = useNow();

  if (settings === undefined) {
    return (
      <section className="panel" aria-busy="true">
        <p role="status">Opening the Dojo…</p>
      </section>
    );
  }

  if (!settings.onboardingCompleted) {
    return <Onboarding />;
  }

  if (cards === undefined || sessions === undefined) {
    return (
      <section className="panel" aria-busy="true">
        <p role="status">Reading today&apos;s practice plan…</p>
      </section>
    );
  }

  const day = localDayKey(now);
  const introducedToday = cards.filter((card) => card.introducedLocalDay === day).length;
  const dueTotal = cards.filter((card) => !card.suspended && card.dueAt <= now).length;
  const pausedTotal = cards.filter((card) => card.suspended).length;
  const remainingNew = Math.max(0, settings.dailyNewLimit - introducedToday);
  const plan = planSession({
    cards,
    catalog: catalog.all,
    settings,
    introducedToday,
    now,
  });
  const plannedExercises = plan.primaryItems.length;
  const activeSession = sessions.find((session) => session.status === 'active');
  const lastSession = sessions.find((session) => session.status !== 'active');
  const remainingPrimary =
    activeSession?.primaryItems.filter((item) => item.status === 'pending').length ?? 0;
  const remainingRematch =
    activeSession?.rematchItems.filter((item) => item.status === 'pending').length ?? 0;

  return (
    <div className="home-shell">
      <section className="panel home-hero" aria-labelledby="dojo-title">
        <p className="eyebrow">Your daily writing practice</p>
        <h1 id="dojo-title">Dojo</h1>
        <p className="promise">
          We won&apos;t make kanji effortless. We&apos;ll make the effort count.
        </p>
        <p className="muted">
          Reviews are scheduled by a spaced-repetition model. You supply the effort and the honest
          self-grade.
        </p>

        <dl className="home-stats">
          <Stat
            label="Due now"
            value={dueTotal}
            description="Introduced characters whose scheduled review is ready."
          />
          <Stat
            label="New allowance today"
            value={remainingNew}
            description={`Left of your daily limit of ${String(settings.dailyNewLimit)}.`}
          />
          <Stat
            label="Paused"
            value={pausedTotal}
            description="Characters paused after an ambiguous prompt."
          />
        </dl>
      </section>

      <div className="home-columns">
        <section className="panel" aria-labelledby="practice-action-title">
          {activeSession === undefined ? (
            <>
              <h2 id="practice-action-title">Start practice</h2>
              {plannedExercises === 0 ? (
                <>
                  <p>
                    Nothing is scheduled right now. Due reviews will appear here automatically, and
                    a new day restores your allowance for new characters.
                  </p>
                  <p className="muted">
                    Adjust the daily new-character limit in <Link to="/settings">Settings</Link>, or
                    study more with an extra session below.
                  </p>
                  <ExtraPractice headingLevel={3} />
                </>
              ) : (
                <>
                  <p>
                    A new session plans <strong>{String(plannedExercises)}</strong>{' '}
                    {plannedExercises === 1 ? 'primary exercise' : 'primary exercises'}.
                  </p>
                  <p className="muted">
                    Rough estimate: about {String(estimateMinutes(plannedExercises))}{' '}
                    {estimateMinutes(plannedExercises) === 1 ? 'minute' : 'minutes'} at roughly 30
                    seconds per exercise. This is an approximation, not a timer.
                  </p>
                  <Link className="button button--primary" to="/practice">
                    Start practice
                  </Link>
                  <ExtraPractice headingLevel={3} />
                </>
              )}
            </>
          ) : (
            <>
              <h2 id="practice-action-title">Session in progress</h2>
              <p>
                You have {String(remainingPrimary)} primary and {String(remainingRematch)} rematch
                exercises remaining in this session.
              </p>
              <p className="muted">
                Resume where you stopped. Saved hints, drawings, and grades stay in place.
              </p>
              <Link className="button button--primary" to="/practice">
                Resume session
              </Link>
            </>
          )}
        </section>

        <section className="panel" aria-labelledby="last-summary-title">
          <h2 id="last-summary-title">Last summary</h2>
          {lastSession === undefined ? (
            <p>
              No finished session yet. Your first summary will appear here after you finish or stop
              a practice session.
            </p>
          ) : (
            <>
              <p>
                <strong>
                  {lastSession.status === 'completed' ? 'Completed session' : 'Partial session'}
                </strong>{' '}
                started {formatDate(lastSession.startedAt)}.
              </p>
              <p className="muted">
                A summary reports what happened. It does not claim that a character is mastered.
              </p>
              <Link className="button" to={`/sessions/${lastSession.id}`}>
                Open last summary
              </Link>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
