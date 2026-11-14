import { createContext } from 'react';

import type { BackupService } from '../services/backup-service';
import type { CatalogRepository } from '../services/catalog';
import type { DeckService } from '../services/deck-service';
import type { ContentIssueService } from '../services/content-issue-service';
import type { ReviewService } from '../services/review-service';
import type { SessionService } from '../services/session-service';
import type { SettingsService } from '../services/settings-service';
import type { StorageRepositories } from '../storage/repositories';

export interface AppServices {
  readonly backup: BackupService;
  readonly catalog: CatalogRepository;
  readonly storage: StorageRepositories;
  readonly sessions: SessionService;
  readonly reviews: ReviewService;
  readonly contentIssues: ContentIssueService;
  readonly decks: DeckService;
  readonly settings: SettingsService;
}

export const AppServicesContext = createContext<AppServices | null>(null);
