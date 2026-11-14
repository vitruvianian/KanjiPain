import { useState } from 'react';

import { Button } from '../../components/Button';
import { useAppServices } from '../../app/useAppServices';

export function Onboarding() {
  const { settings } = useAppServices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = async () => {
    setBusy(true);
    setError(null);
    try {
      await settings.update({ onboardingCompleted: true });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The introduction could not be saved. Please try again.',
      );
      setBusy(false);
    }
  };

  return (
    <section className="panel onboarding" aria-labelledby="onboarding-title">
      <p className="eyebrow">Welcome to the dojo</p>
      <h1 id="onboarding-title">Welcome to KanjiPain</h1>
      <p className="promise">
        We won&apos;t make kanji effortless. We&apos;ll make the effort count.
      </p>

      <div className="onboarding-grid">
        <section aria-labelledby="onboarding-writing">
          <h2 id="onboarding-writing">Write from memory</h2>
          <p>
            KanjiPain asks you to produce a character from its meaning and readings, then compare
            your attempt with the answer. You can draw on screen or use paper beside the screen.
          </p>
          <p className="muted">
            The app cannot grade handwriting. You judge each attempt honestly: got it, barely, or
            missed it.
          </p>
        </section>

        <section aria-labelledby="onboarding-scope">
          <h2 id="onboarding-scope">Writing only, on purpose</h2>
          <p>
            This is a recall and writing-practice tool, not a full Japanese course, dictionary, or
            handwriting analyser. Progress means scheduled writing reviews, not a claimed mastery
            score.
          </p>
          <p className="muted">
            Hints and answer reveals are recorded as assistance, so a helped attempt never counts as
            an independent success.
          </p>
        </section>

        <section aria-labelledby="onboarding-storage">
          <h2 id="onboarding-storage">Your progress stays local</h2>
          <p>
            Cards, schedules, and review history are stored only in this browser. There is no
            account and no server copy.
          </p>
          <p className="muted">
            Clearing site data removes your progress. Portable progress and backup tools live in
            Settings; drawings are never included in a backup.
          </p>
        </section>
      </div>

      {error === null ? null : (
        <div className="banner banner--error" role="alert">
          <p>{error}</p>
        </div>
      )}

      <div className="button-row">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            void begin();
          }}
        >
          {busy ? 'Opening the dojo…' : 'Enter the Dojo'}
        </Button>
      </div>
    </section>
  );
}
