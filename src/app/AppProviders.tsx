import { type ReactNode, useEffect, useState } from 'react';

import { systemClock } from '../domain/clock';
import { systemIdSource } from '../domain/ids';
import { lookupStrokeCounts } from '../recognition/load';
import { initializeFsrsAdapter } from '../scheduler/fsrs-adapter';
import { createBackupService } from '../services/backup-service';
import { loadBundledCatalog, type CatalogRepository } from '../services/catalog';
import { createContentIssueService } from '../services/content-issue-service';
import { createDeckService } from '../services/deck-service';
import { DraftSaveQueue } from '../services/draft-save-queue';
import { createReviewService } from '../services/review-service';
import { createSessionService } from '../services/session-service';
import { createSettingsService } from '../services/settings-service';
import {
  createDatabase,
  DEFAULT_DATABASE_NAME,
  initializeDatabase,
  type KanjiPainDatabase,
} from '../storage/database';
import { StorageError } from '../storage/errors';
import { createStorageRepositories } from '../storage/repositories';
import { AppServicesContext, type AppServices } from './app-services-context';

interface AppProvidersProps {
  children: ReactNode;
  databaseName?: string;
  databaseFactory?: (name: string) => KanjiPainDatabase;
  catalogLoader?: () => CatalogRepository | Promise<CatalogRepository>;
}

interface StartupAttemptProps extends Omit<AppProvidersProps, 'databaseName'> {
  databaseName: string;
  onRetry: () => void;
}

function startupErrorMessage(error: unknown): string {
  if (error instanceof StorageError) {
    return error.message;
  }
  return 'The catalog or practice engine could not be loaded.';
}

function startupErrorTitle(error: unknown): string {
  return error instanceof StorageError ? 'Progress cannot be saved' : 'Practice unavailable';
}

function StartupAttempt({
  children,
  databaseName,
  databaseFactory = createDatabase,
  catalogLoader = loadBundledCatalog,
  onRetry,
}: StartupAttemptProps) {
  const [services, setServices] = useState<AppServices | null>(null);
  const [startupError, setStartupError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    const database = databaseFactory(databaseName);

    const start = async () => {
      try {
        const [catalog, , scheduler] = await Promise.all([
          catalogLoader(),
          initializeDatabase(database),
          initializeFsrsAdapter(),
        ]);
        if (active) {
          const storage = createStorageRepositories(database);
          const draftQueue = new DraftSaveQueue();
          const sessions = createSessionService({
            database,
            storage,
            catalog,
            scheduler,
            clock: systemClock,
            ids: systemIdSource,
            draftQueue,
          });
          const reviews = createReviewService({
            database,
            scheduler,
            clock: systemClock,
            ids: systemIdSource,
            draftQueue,
          });
          const decks = createDeckService({
            database,
            catalog,
            clock: systemClock,
            ids: systemIdSource,
            strokeLookup: lookupStrokeCounts,
          });
          // Newer stroke data may cover characters that were unrecognized when imported.
          void decks.recheckStrokes().catch(() => undefined);
          setServices({
            catalog,
            decks,
            storage,
            sessions,
            reviews,
            contentIssues: createContentIssueService({ database }),
            settings: createSettingsService({ database }),
            backup: createBackupService({ database, catalog, clock: systemClock }),
          });
        }
      } catch (error) {
        if (active) {
          setStartupError(error);
        }
      }
    };

    void start();
    return () => {
      active = false;
      database.close();
    };
  }, [catalogLoader, databaseFactory, databaseName]);

  if (startupError !== null) {
    return (
      <main className="app-shell">
        <section className="hero" role="alert" aria-labelledby="startup-error-title">
          <p className="eyebrow">The dojo could not open.</p>
          <h1 id="startup-error-title">{startupErrorTitle(startupError)}</h1>
          <p className="promise">{startupErrorMessage(startupError)}</p>
          <button type="button" onClick={onRetry}>
            Retry startup
          </button>
        </section>
      </main>
    );
  }

  if (services === null) {
    return (
      <main className="app-shell" aria-busy="true">
        <section className="hero" aria-labelledby="startup-title">
          <p className="eyebrow">Opening the dojo.</p>
          <h1 id="startup-title">KanjiPain</h1>
          <p className="status">Validating the catalog and saved progress…</p>
        </section>
      </main>
    );
  }

  return <AppServicesContext.Provider value={services}>{children}</AppServicesContext.Provider>;
}

export function AppProviders({
  children,
  databaseName = DEFAULT_DATABASE_NAME,
  databaseFactory = createDatabase,
  catalogLoader = loadBundledCatalog,
}: AppProvidersProps) {
  const [retryCount, setRetryCount] = useState(0);

  return (
    <StartupAttempt
      key={retryCount}
      databaseName={databaseName}
      databaseFactory={databaseFactory}
      catalogLoader={catalogLoader}
      onRetry={() => {
        setRetryCount((count) => count + 1);
      }}
    >
      {children}
    </StartupAttempt>
  );
}
