import { Link, useParams } from 'react-router-dom';

import {
  useAppServices,
  useSessionEvents,
  useSessionIntroducedCards,
  useSessions,
} from '../../app/useAppServices';
import { calculateSummary } from '../../domain/metrics';
import type { SessionSummary } from '../../domain/session-types';

interface MetricProps {
  readonly label: string;
  readonly value: number;
  readonly description: string;
}

function Metric({ label, value, description }: MetricProps) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>
        <span className="metric-value">{String(value)}</span>
        <span className="metric-description">{description}</span>
      </dd>
    </div>
  );
}

function summaryCopy(summary: SessionSummary): MetricProps[] {
  return [
    {
      label: 'Independent reviews',
      value: summary.independentReviews,
      description: 'Previously seen characters passed without assistance.',
    },
    {
      label: 'New characters introduced',
      value: summary.newCharactersIntroduced,
      description: 'Characters you met for the first time this session.',
    },
    {
      label: 'Misses recovered',
      value: summary.missesRecovered,
      description: 'Characters missed, then passed when they returned.',
    },
    {
      label: 'Needs another round',
      value: summary.needsAnotherRound,
      description: 'Characters missed without a successful rematch. They will come back.',
    },
  ];
}

function SummaryContent({ sessionId }: { sessionId: string }) {
  const sessions = useSessions();
  const events = useSessionEvents(sessionId);
  const cards = useSessionIntroducedCards(sessionId);
  const { catalog } = useAppServices();
  const session = sessions?.find((candidate) => candidate.id === sessionId);

  if (sessions === undefined || events === undefined || cards === undefined) {
    return <p role="status">Loading your summary…</p>;
  }
  if (session === undefined) {
    return (
      <section className="panel">
        <h1>Summary not found</h1>
        <p>That practice session is not saved in this browser.</p>
        <Link to="/">Return to the Dojo</Link>
      </section>
    );
  }

  const summary = calculateSummary(session, events, cards);
  const introduced = cards
    .map((card) => catalog.byId(card.kanjiId))
    .filter((entry) => entry !== undefined);

  return (
    <section className="panel" aria-labelledby="summary-title">
      <p className="eyebrow">
        {session.status === 'completed' ? 'Session complete' : 'Partial session'}
      </p>
      <h1 id="summary-title">Session summary</h1>
      {session.status === 'ended' ? (
        <p>
          You stopped early. Unfinished characters keep their schedules, and unseen new characters
          use none of today&apos;s introductions.
        </p>
      ) : (
        <p>You reached the end of the planned work. Progress is saved in this browser.</p>
      )}

      <dl className="summary-grid">
        {summaryCopy(summary).map((metric) => (
          <Metric key={metric.label} {...metric} />
        ))}
      </dl>

      {introduced.length === 0 ? null : (
        <div className="introduced-characters">
          <h2>Characters introduced</h2>
          <p className="introduced-glyphs">
            {introduced.map((entry) => (
              <span key={entry.id} lang="ja">
                {entry.literal}
              </span>
            ))}
          </p>
        </div>
      )}

      <p className="muted">
        &ldquo;Recovered&rdquo; does not mean mastered. Consistent, effortful recall is what makes a
        character durable.
      </p>

      <div className="button-row">
        <Link className="button button--primary" to="/">
          Return to the Dojo
        </Link>
        <Link className="button button--secondary" to="/collection">
          Browse the collection
        </Link>
      </div>
    </section>
  );
}

export function SummaryPage() {
  const { id } = useParams();
  if (id === undefined) {
    return (
      <section className="panel">
        <h1>Summary not found</h1>
        <Link to="/">Return to the Dojo</Link>
      </section>
    );
  }
  return <SummaryContent sessionId={id} />;
}
