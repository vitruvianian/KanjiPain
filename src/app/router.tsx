import { HashRouter, Link, Route, Routes } from 'react-router-dom';

import { CharacterPage } from '../features/collection/CharacterPage';
import { CollectionPage } from '../features/collection/CollectionPage';
import { DeckPage } from '../features/decks/DeckPage';
import { DecksPage } from '../features/decks/DecksPage';
import { HomePage } from '../features/home/HomePage';
import { PracticePage } from '../features/practice/PracticePage';
import { SummaryPage } from '../features/practice/SummaryPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { SourcesPage } from '../features/sources/SourcesPage';
import { AppShell } from './AppShell';

export function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="practice" element={<PracticePage />} />
          <Route path="sessions/:id" element={<SummaryPage />} />
          <Route path="collection" element={<CollectionPage />} />
          <Route path="kanji/:id" element={<CharacterPage />} />
          <Route path="decks" element={<DecksPage />} />
          <Route path="decks/:id" element={<DeckPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="sources" element={<SourcesPage />} />
          <Route
            path="*"
            element={
              <section className="panel">
                <h1>Page not found</h1>
                <p>This address does not match a KanjiPain screen.</p>
                <Link to="/">Return to the Dojo</Link>
              </section>
            }
          />
        </Route>
      </Routes>
    </HashRouter>
  );
}
