# KanjiPain — Implementation Playbook

Status: build instructions for a coding model  
Specification: [ARCHITECTURE.md](./ARCHITECTURE.md)

## 0. Instructions to the implementing model

Build the application, not another proposal. Work through the checkpoints below
in order. Each checkpoint has a small responsibility, concrete files, and observable
acceptance criteria. Do not build future reading drills, an account system, AI
grading, or a PWA during these steps.

Before editing:

1. Read `ARCHITECTURE.md` completely once. At later checkpoints reread the referenced
   sections rather than repeatedly scanning the entire repository.
2. Inspect existing files and preserve completed work. The initial folder contains
   these two specification files; a later run may contain partial implementation.
3. Read `BUILD_PROGRESS.md` if it exists. Resume the first incomplete checkpoint.
4. Inspect relevant installed package types instead of guessing third-party APIs.

After each checkpoint:

- Run its specified checks and fix failures before proceeding.
- Update `BUILD_PROGRESS.md` with completed checkpoint numbers, commands/results,
  relevant decisions, and the next task. Include real blockers; do not claim a
  check passed if it was not run.
- Keep the summary short. Do not repeatedly rewrite these specifications.
- Stop only for an actual blocker or the requested checkpoint boundary, not because
  a nonpersistent visual mockup looks convincing.

If a data endpoint is unavailable, finish independent infrastructure using labeled
test fixtures, record the blocker, and retry acquisition later. A fixture-only
catalog cannot satisfy the release gate.

### Dependency order

```text
01 foundation → 02 contracts → 03 catalog → 04 persistence → 05 scheduler
→ 06 queue/state machine → 07 transactional services → 08 input and shell
→ 09 practice UI → 10 collection/home → 11 backup/settings
→ 12 end-to-end hardening → 13 release documentation
```

Use these identifiers in progress notes and optional commits. Do not add tools or
dependencies unless a checkpoint needs them.

## 01 — Bootstrap a reproducible frontend

Read architecture sections 5 and 7.

### Actions

1. Confirm Node 24 and npm are available. Add `.nvmrc` containing `24`, an engine
   range `>=24 <25`, and `private: true` in `package.json`.
2. Create a React/TypeScript/Vite app in this directory. Because the documentation
   already exists, do not use a scaffold operation that deletes/replaces the folder.
   Either create files directly or copy a temporary scaffold after inspecting it.
3. Use React 19, Vite 8, React Router 7, Dexie 4, Zod 4, and `ts-fsrs@6.0.0`.
   Install compatible stable `react-dom`, `dexie-react-hooks`, Japanese font assets,
   and corresponding TypeScript/React tooling. Save direct versions exactly.
4. Dev dependencies: Vitest, jsdom, Testing Library React/user-event/jest-dom,
   fake-indexeddb, Playwright, ESLint with TypeScript/React-hooks support, Prettier,
   tsx, fast-xml-parser, and Node type definitions. Add React types as needed by
   the scaffold. Do not install an ORM, server framework, or CSS component framework.
5. Create the module directories from architecture section 7.
6. Configure strict TypeScript for application and Node-side scripts/tests. Vite
   build alone is not the typecheck. Include scripts and tests in checked configs.
7. Add an ESLint flat configuration and a single Prettier configuration. Ignore
   `dist/`, coverage, browser reports, generated data formatting where necessary,
   and downloaded raw data. Avoid disabling useful rules to make the bootstrap pass.
8. Create `.gitignore` for node_modules, dist, test output, data/raw, local env files,
   and editor/OS files. Do not initialize git or commit unless the user requests it.
9. Add `BUILD_PROGRESS.md` with the checkpoint checklist.

### Required npm scripts

| Script          | Command/behavior                                                       |
| --------------- | ---------------------------------------------------------------------- |
| `dev`           | `vite`                                                                 |
| `build`         | `tsc -b && vite build` (configs include all intended TS sources)       |
| `preview`       | `vite preview`                                                         |
| `typecheck`     | `tsc -b --pretty false`                                                |
| `lint`          | `eslint .`                                                             |
| `format`        | `prettier --write .`                                                   |
| `format:check`  | `prettier --check .`                                                   |
| `test`          | `vitest run`                                                           |
| `test:watch`    | `vitest`                                                               |
| `test:e2e`      | `playwright test`                                                      |
| `data:fetch`    | Node/tsx script downloads raw KANJIDIC2, explicitly invoked            |
| `data:import`   | `tsx scripts/import-kanjidic.ts` with an optional local input path     |
| `data:validate` | `tsx scripts/validate-catalog.ts`                                      |
| `check`         | format check, lint, typecheck, data validation, unit/integration tests |

`check` must fail on the first failed command. Downloading data, installing browsers,
or updating dependencies must never be implicit in `check` or `build`. Until the
catalog scripts exist, document that the aggregate check is pending instead of
adding fake success stubs.

### Acceptance

- `npm run dev` renders a minimal KanjiPain screen.
- `npm run typecheck`, `npm run lint`, and `npm run build` pass.
- Dependencies are locked, documentation remains intact, no placeholder server exists.

## 02 — Define contracts and validation boundaries

Read architecture sections 8–10.

### Files

```text
src/domain/types.ts
src/domain/schemas.ts
src/domain/clock.ts
src/domain/ids.ts
src/domain/date.ts
src/domain/session-types.ts
src/data/teaching-notes.json
```

### Actions

1. Define the catalog, card, settings, attempt, event, session item, session phase,
   content issue, and manifest contracts specified in the architecture.
2. Define discriminated session phases rather than unrelated booleans:
   `selecting`, `introduction`, `prompt`, `feedback`, `repair`, `summary`.
   Each phase carries the IDs it requires. Invalid combinations should be difficult
   to represent. `summary` has no editable draft.
3. Define teaching notes as an object keyed by KanjiId with optional prompt override,
   mnemonic hint, component hint, plus source/reviewer metadata. Start with `{}`.
4. Implement `Clock` and `IdSource` interfaces with production implementations using
   `Date.now()` and `crypto.randomUUID()`. Tests inject fixed implementations.
5. Implement `localDayKey(timestamp)` with local date getters and zero-padding.
6. Define Zod validators with integer/range checks. Distinguish structural validation
   from later cross-record/reference validation.
7. Reserve FSRS serialization types behind `src/scheduler/types.ts`; complete their
   exact fields in checkpoint 05 from package declarations. Do not fake FSRS fields.

### Acceptance tests

- IDs for 一 and 湖 are `k-4e00` and `k-6e56`.
- Local-day tests under a non-UTC timezone do not accidentally use UTC date keys.
- Settings reject negative/new limits over ten and fractional limits.
- Catalog validation rejects missing meanings, empty reading sets, and invalid grades.
- Normalized points reject NaN, infinity, and values outside [0,1].

Run targeted unit tests and typecheck.

## 03 — Import and validate the complete Jōyō catalog

Read architecture section 6. Do not manually type a kanji list.

### Files

```text
scripts/fetch-kanjidic.ts
scripts/import-kanjidic.ts
scripts/validate-catalog.ts
src/data/kanji.generated.json
src/data/catalog-manifest.json
src/services/catalog.ts
public/licenses/kanjidic2-license.html
public/licenses/kanjidic2-documentation.html
DATA_SOURCES.md
tests/fixtures/kanjidic-small.xml
```

### Import algorithm

1. Download only when `data:fetch` is requested. Check HTTP status, save atomically to
   `data/raw/kanjidic2.xml.gz`, and record retrieval metadata alongside it.
2. `data:import` defaults to that path but accepts a file argument. Read bytes, hash
   using SHA-256, and gunzip using Node's built-in zlib.
3. Parse XML with attributes preserved and explicit array handling. Fields can be
   absent, singleton, or repeated. Do not fetch external DTD/entities. Configure the
   parser to avoid unnecessary entity processing and test against the actual input.
4. Iterate `kanjidic2.character`. Filter grades exactly as specified.
5. Extract the first stroke count, optional frequency, English meanings, and Japanese
   readings. Correctly handle meanings represented as strings or attribute objects.
6. Build stable IDs from `literal.codePointAt(0)`, verify one Unicode code point per
   literal, and reject duplicates rather than silently deduplicating characters.
7. Sort the catalog by grade, frequency (null last), code point; assign curriculumOrder.
8. Validate all entries, exact count, contiguous order, IDs, and teaching-note references.
9. Write stable UTF-8 JSON with a final newline. Put retrieval timestamps in the
   manifest, not in each catalog entry; identical source bytes yield identical
   catalog bytes. Compute `datasetVersion` from the catalog and teaching-notes hashes
   using the exact formula in architecture section 6.
10. Include source documentation/license, provenance, transformation description, and
    an update procedure. Preserve applicable notices. Add the font license when its
    assets are selected. Production builds use committed generated assets.
11. Catalog service loads/validates once and exposes `all`, `byId`, and `orderedIds`.

### Tests and acceptance

- XML fixture includes grade 1/8 entries and excluded grade 9/10/ungraded entries.
- Fixture covers multiple meanings, non-English meanings, singleton/multiple
  readings, and multiple stroke counts (choose first).
- Fixture tests exercise normalization separately from the production 2,136-count gate.
- Production validator reports exactly 2,136 unique entries, no missing cues.
- 湖 exists with the correct stable ID; kana punctuation is preserved.
- Running import twice on the same raw file produces the same catalog hash.
- `npm run data:validate` and importer tests pass without network access.

If upstream count/content is unexpected, diagnose the data and filter. Never append
placeholder entries or weaken the count gate.

## 04 — Add durable storage and repositories

Read architecture sections 8 and 10.

### Files

```text
src/storage/database.ts
src/storage/repositories.ts
src/storage/errors.ts
src/app/AppProviders.tsx
tests/storage/database.test.ts
```

### Actions

1. Define the `kanjipain` Dexie database and indexes from the architecture. Keep a
   constructor/factory accepting a database name for isolated tests.
2. Add default settings idempotently in a transaction. Do not reseed on every render.
3. Implement repository reads: settings, card by ID, due cards, card history, sessions,
   content issues, introductions for a local day. Catalog stays outside IndexedDB.
4. Add typed error categories for unavailable storage, quota/write failures, invalid
   persisted data, and stale revisions. Preserve underlying errors for debugging.
5. Startup opens storage and catalog before enabling practice. Add error/retry UI.
6. Establish a service/provider boundary so route components never import the DB.
7. Expose read hooks using dexie-react-hooks through this boundary.

### Acceptance tests

- Data survives closing/reopening a named database.
- Initialization does not overwrite existing settings.
- Due queries include equality at the deadline and exclude future/suspended cards.
- A forced multi-table transaction failure rolls back every write.
- Tests use fake-indexeddb and clean databases after each test.

Do not create actual user cards merely by loading the collection or startup.

## 05 — Implement the pinned FSRS adapter

Read architecture section 9 and the installed `ts-fsrs@6.0.0` declarations.

### Files

```text
src/scheduler/types.ts
src/scheduler/serialization.ts
src/scheduler/fsrs-adapter.ts
tests/scheduler/fsrs-adapter.test.ts
```

### Actions

1. Initialize `DefaultScheduler` once using the exact configuration in the architecture.
   Node 24 is required. Do not use version 5 factory/examples.
2. Implement `create` and `review` behind `SchedulerAdapter`.
3. Map got → Good, barely → Hard, missed → Again. Do not expose Easy.
4. Inspect and explicitly encode/decode every card and log field of this package
   version. Convert Date fields to UnixMs on output and restore Dates on input.
5. Validate serialized records with Zod. Store adapter/package/model metadata.
6. Keep returned state immutable; preserve all FSRS-7 memory state fields.
7. Reject clock rollback relative to the last scheduled review. Never use elapsed
   drawing time to change the submitted grade.

### Acceptance tests

- New-card creation and all three mapped ratings produce finite valid state/due dates.
- Same state/grade/time gives identical results with fuzz disabled.
- Input state is not mutated.
- Serialize → JSON stringify/parse → deserialize preserves all scheduler fields.
- Applying a second review to a round-tripped card matches applying it directly.
- Supported envelope is accepted; another package/model version is rejected clearly.
- A review time before the latest review is rejected without output state.

Do not assert arbitrary “Good must be N days” constants unless the pinned library
actually specifies them. Do assert equivalent behavior to direct library calls.

## 06 — Implement pure prompts, queue, state machine, and metrics

Read architecture sections 3, 4, and 9.

### Files

```text
src/domain/prompts.ts
src/domain/queue.ts
src/domain/session-reducer.ts
src/domain/metrics.ts
src/domain/status.ts
tests/domain/
```

### Required function responsibilities

```ts
// Exact parameter object types live in domain/types.ts or session-types.ts.
buildPrompt(entry, teachingNote): ProductionPrompt
planSession({ cards, catalog, settings, introducedToday, now }): SessionPlan
chooseNextItem(session): NextItemDecision
reduceSession(session, event): SessionRecord
calculateSummary(session, reviewEvents, cards): SessionSummary
deriveCharacterStatus(card, scheduledHistory, now): CharacterStatus
```

The reducer takes already-validated events and timestamps; it does not open storage,
call FSRS, create random IDs, or read the clock. `chooseNextItem` must represent
short-rematch offer versus automatically eligible item versus completion explicitly.

### Actions

1. Implement prompt construction, hint availability/order, and target-leak validation.
2. Implement due-first primary selection and deterministic curriculum ordering.
3. Implement gap accounting using distinct other card IDs after each rematch enqueue.
4. Implement at most two rematches, no duplicate pending retries, and early finish.
5. Implement state transitions with explicit rejection of invalid commands (for example,
   grade before reveal or editing a frozen answer).
6. Implement summary formulas and reliable/developing status exactly as specified.

### Essential scenario table

| Scenario                                 | Expected                                                 |
| ---------------------------------------- | -------------------------------------------------------- |
| 25 due, 5 new allowed                    | 20 due, 0 new                                            |
| 18 due, 5 new allowed                    | 18 due, 2 new                                            |
| 0 due, limit 5, 3 introduced today       | 2 new                                                    |
| Daily new limit 0 and no due             | Empty plan                                               |
| Equal due times                          | Curriculum order, then ID determines tie                 |
| Suspended card due                       | Excluded                                                 |
| Miss A; finish B,C,D                     | A rematch becomes eligible                               |
| Miss A; finish B twice and C             | Only two distinct other cards; not yet eligible          |
| Only A remains                           | Explicit short-rematch/finish choice                     |
| Miss A primary and both rematches        | No third rematch                                         |
| Pass A rematch                           | No further retries; primary scheduling remains unchanged |
| Assisted response                        | Cannot contribute to independent successes               |
| Initial learning check passed            | Not an independent review metric                         |
| Ambiguity skip                           | No gap credit, no FSRS result                            |
| Reliable threshold crosses fourteen days | Status follows exact rule                                |

Run domain tests and typecheck. Avoid React tests at this checkpoint.

## 07 — Wire transactional application services

Read architecture section 9 in full. This is the highest-risk checkpoint.

### Files

```text
src/services/session-service.ts
src/services/review-service.ts
src/services/draft-save-queue.ts
src/services/content-issue-service.ts
tests/services/
```

### Service commands

- `startOrResumeSession()`
- `openNextItem(sessionId, expectedRevision)`
- `saveDraft(sessionId, expectedRevision, draftChange)`
- `hideIntroduction(sessionId, expectedRevision)`
- `requestHint(sessionId, expectedRevision)`
- `revealAnswer(sessionId, expectedRevision, reason)`
- `commitGrade({sessionId, attemptId, expectedRevision, expectedCardVersion, grade})`
- `flagAmbiguous({sessionId, attemptId, expectedRevision, expectedCardVersion})`
- `finishRepair(sessionId, expectedRevision)`
- `finishSession(sessionId, expectedRevision)`
- `resumePausedCard(cardId, expectedCardVersion)`

Names may be grouped into classes/factories, but maintain these responsibilities.

### Actions

1. Inject database/repositories, immutable catalog, initialized scheduler, clock, IDs.
2. Serialize creation of the single active session inside a transaction.
3. Opening a new introduction creates its card and persists exposure metadata
   atomically with the session phase. Recheck daily allowance at this point.
4. Handle an exposed but never-reviewed card as an introduction/first-learning check.
5. Implement draft-save serialization; each successful save returns the next revision.
   Flush completed pending saves before reveal, grade, or deliberate navigation.
6. Persist hints before displaying them; persist reveal before enabling grading.
7. `commitGrade` checks existing event ID before revisions so retried identical requests
   return their prior result. Reject a reused attempt ID attached to a different item.
8. Apply assistance/surrender rules serverlessly in the service; disabling UI buttons
   alone is insufficient. Then commit card/event/session atomically.
9. Only primary scheduled events call the scheduler. Retry events change session/history
   but not FSRS state or scheduled review count. Repair has no review event.
10. Ambiguity records an issue, pauses the card, cancels its rematches, and advances
    without grading. A version increment for pause/resume protects concurrent changes.
11. Return typed stale-state/write errors. The UI must be able to retry or reload state.
12. Ending a session cancels planned work, drops the ungraded active draft, retains
    committed reviews, and persists a summary-accessible ended record.

### Required integration tests

- Repeated or simultaneous start requests create only one active session.
- A double-click/double-submit stores one event and increments scheduled count once.
- Simulated failed grade transaction leaves card, history, and queue unchanged.
- Reload after reveal retains hint/surrender flags and frozen draft.
- A stale tab cannot overwrite a newer grade or saved draft.
- Assisted input submitted as `got` becomes `missed` in persisted data.
- Each rematch writes history without changing serialized FSRS card state.
- Opening an introduction consumes one slot exactly once; planned unexposed cards
  consume none. A midnight resume checks the new local day correctly.
- Finishing mid-prompt does not fabricate a grade or delay an existing due card.
- Ambiguity preserves FSRS state, pauses the card, and removes pending retries.
- Dataset-version mismatch ends the obsolete active session without losing events.

Do not proceed to an elaborate UI until these tests pass.

## 08 — Build the app shell and drawing input

Read architecture sections 4 and 7.

### Files

```text
src/app/router.tsx
src/app/AppShell.tsx
src/app/ErrorBoundary.tsx
src/components/DrawingPad.tsx
src/components/Button.tsx
src/components/Dialog.tsx
src/styles/tokens.css
src/styles/global.css
```

### Shell actions

1. Implement HashRouter routes and not-found behavior.
2. Build shared navigation, sources footer, loading/error states, and responsive layout.
3. Bundle the Japanese font; avoid a runtime font CDN. Apply Japanese language metadata.
4. Implement design tokens from the architecture, focus states, reduced motion, and
   consistent button/form styling. Minimal route headings are acceptable here.

### Drawing implementation

1. SVG uses `viewBox="0 0 1000 1000"`, a square paper surface, and vector paths.
2. Capture a single active pointer on pointer-down. Convert client coordinates through
   the SVG bounding rectangle into normalized [0,1] points. Clamp to bounds.
3. Append points during pointer-move; optionally use coalesced events. Use a minimum
   spacing threshold to avoid storing redundant points. Do not smooth away meaningful
   corners. Pressure-sensitive stroke width is not required.
4. Commit the stroke on pointer-up. On pointer-cancel discard only the active partial
   stroke, keeping previously committed strokes. Ignore additional simultaneous pointers.
5. Render a one-point stroke as a dot. For paths, use rounded caps/joins.
6. `Undo` removes the last completed stroke; `Clear` clears all completed strokes.
7. `readOnly` prevents editing after submission. Expose `onStrokesChange` for completed
   changes, not every pointer movement, to the serialized persistence queue.
8. Apply `touch-action: none` only on the drawing surface. Preserve strokes across resize.
9. Bound an attempt to 100 strokes and 20,000 points; show a clear reset/undo message at
   the limit rather than allowing unbounded persistence writes.
10. Provide paper mode with a checkbox/button confirming an attempted answer. It must
    work with only a keyboard and never require a fake canvas event.

### Acceptance

- Mouse drawing, undo, clear, freezing, and resizing work in a real browser.
- Touch/pen behavior uses pointer capture and does not drag-scroll the canvas.
- Normalized strokes restore with the same proportions at another viewport size.
- Accessible names, keyboard focus, paper input, and 360px layout work.
- Component tests cover callbacks/readOnly; browser tests cover actual pointer behavior.

## 09 — Implement the complete practice route

Read architecture section 3 and reuse the services from checkpoint 07.

### Files

```text
src/features/practice/PracticePage.tsx
src/features/practice/IntroductionPanel.tsx
src/features/practice/PromptPanel.tsx
src/features/practice/FeedbackPanel.tsx
src/features/practice/RepairPanel.tsx
src/features/practice/ShortRematchPanel.tsx
src/features/practice/SummaryPage.tsx
src/features/practice/usePracticeSession.ts
```

### Actions

1. Render strictly from persisted session phase and local drawing-in-progress state.
2. Introduction shows actual catalog data; `Hide and try` removes target content.
3. Prompt shows meanings/readings, input mode, hint ladder, and surrender action.
4. Keep target glyph out of prompt DOM/labels/title. Do not link to target detail while
   pretending it is a hidden-answer exercise. Persisted static data is not secret.
5. `Compare answer` flushes draft saves then reveals. Prevent empty submission; keep
   `I don't know` available without any drawing.
6. Feedback freezes the attempt and shows the target side by side (stacked on narrow
   screens). Display all valid self-grading controls and assistance explanation.
7. Disable transition buttons while committing. Advance only after successful storage.
   A failed write leaves the attempt recoverable and displays retry.
8. Misses pass through repair; passes advance directly. Show the short-rematch choice
   when required by queue policy. `Finish` is always available.
9. Summary uses domain metrics, not UI counters. Link back to Dojo/Collection.
10. On browser reload resume the exact phase. On stale-tab error reload canonical state
    with a visible explanation. Keep grading disabled until refresh completes.
11. During practice, prevent accidental link navigation from discarding queued completed
    strokes; flush saves before internal navigation. Do not rely on async beforeunload.
12. Add concise demanding-but-kind copy. No shame messages, fake automatic grading,
    or claims of verified accuracy.

### Acceptance scenarios

- New user can introduce, attempt, grade, and finish at least one real character.
- Existing due card can fail, receive help, return in a rematch, and show recovery.
- Revealed answer remains revealed after reload; the same attempt cannot be graded twice.
- Hint usage cannot be cleared by changing input mode or navigating away and back.
- Paper-only keyboard flow can finish a session.
- Finishing an unanswered exercise leaves its schedule unchanged.
- Prompt ambiguity produces a local paused card rather than an invented failure.

## 10 — Build Dojo, Wall, and character details

Read architecture sections 3.1 and 4.

### Files

```text
src/features/home/HomePage.tsx
src/features/home/Onboarding.tsx
src/features/collection/CollectionPage.tsx
src/features/collection/CharacterPage.tsx
src/features/collection/search.ts
```

### Actions

1. Home displays due count, remaining new allowance, start/resume, and last summary.
   Show a conservative time estimate based on primary count (about 30 seconds each),
   explicitly marked approximate. Never manufacture progress data.
2. Complete onboarding and persist its flag. Explain the writing-only scope and local
   storage/backups. Returning users do not see onboarding again.
3. Render the catalog in a responsive grid, 120 per page, with accessible character
   links and status labels/tooltips. Keep unseen characters visible in the collection.
4. Search all entries before paging; normalize kana for matching without modifying
   stored source readings. Use substring English search and literal search.
5. Filters: all, unseen, introduced, developing, reliable, due, paused. Due/paused are
   overlays and can include otherwise developing/reliable characters.
6. Detail shows meanings, on/kun readings with punctuation explanation, stroke count,
   current schedule/status, and latest twenty events with kind labels.
7. Resume-paused action clears pause with version checking and unchanged due date.
8. Browsing does not create a card or count as an introduction. Do not implement manual
   “mastered” buttons or placement testing here.

### Acceptance

- Full catalog count remains 2,136 through pagination/search reset.
- Search finds 湖 by literal, an English meaning, and its reading.
- Kanji IDs in route paths are stable ASCII IDs, not array indexes.
- Empty result and unknown route states are clear.
- Home/collection update after a grade without a hard reload.
- Reliable status excludes rematches, assisted successes, and immediate new checks
  unless they actually meet the architecture's scheduled-history threshold.

## 11 — Settings, sources, and portable progress

Read architecture sections 6 and 10.

### Files

```text
src/storage/backup-schema.ts
src/services/backup-service.ts
src/features/settings/SettingsPage.tsx
src/features/settings/ImportPreview.tsx
src/features/sources/SourcesPage.tsx
tests/services/backup.test.ts
```

### Actions

1. Add validated settings for daily new limit and input mode. Changes do not wipe cards.
2. Export a consistent snapshot of all backup tables in a read transaction. Use the
   envelope/version from the architecture; exclude catalog and drawing data.
3. Disable backup import/export while a session is active; show resume/finish links.
4. Import pipeline: file size check → parse → schema validation → reference validation
   → count preview → explicit replacement confirmation → atomic write transaction.
5. Validate unique IDs, card/kanji/skill consistency, event/session references, session
   statuses, scheduler metadata/state, and required timestamps. Reject dangling records.
6. When replacing, clear all user tables and restore in the same transaction. Never clear
   first and validate later. Preserve the previous state on every error.
7. Allow compatible content-hash differences with valid catalog membership; reject
   unknown adapter/model versions instead of guessing how to migrate.
8. Display practical local-storage information and export guidance.
9. Sources page includes EDRDG attribution, links/local notices, generated-data license,
   import transformation description, current dataset date/hash, font attribution, and
   application version. Footer links here on every screen.

### Required tests

- Export → empty DB → import preserves cards, schedules, histories, settings, issues.
- Invalid JSON, unsupported backup/model versions, unknown IDs, duplicate events,
  dangling references, active sessions, and oversized files are rejected.
- Failed import transaction leaves the previous database intact.
- Export excludes drawings and still passes its own import validator.
- Settings persist across reloads without resetting the daily introduction count.

Do not add synchronization, background uploads, or an account flow.

## 12 — Browser-level verification and edge-case hardening

### Files

```text
playwright.config.ts
e2e/onboarding.spec.ts
e2e/practice.spec.ts
e2e/persistence.spec.ts
e2e/backup.spec.ts
e2e/collection.spec.ts
e2e/accessibility.spec.ts
```

### Harness requirements

- Run Chromium against a local production build/preview on a fixed port. Playwright's
  webServer may invoke build/preview; do not reuse an unrelated running server in CI.
- Fresh browser context per independent test. Install Chromium explicitly once with
  `npx playwright install chromium`; it is not part of normal app startup.
- Seed known cards via test utilities or a valid backup through the public import UI.
  Avoid production debug endpoints/window globals. Use a fixed clock or explicit
  relative timestamps so tests do not depend on real calendar dates.
- A small test catalog may test isolated modules, but production browser smoke tests
  must verify the real 2,136-entry catalog loads.

### End-to-end matrix

1. First visit → onboarding → new introduction → drawn attempt → self-grade → summary.
2. Due card → hint → forced miss → three distinct other completions → rematch.
3. Short queue → explicit short-rematch offer → repeated misses → bounded finish.
4. Reload on prompt, feedback, and repair; no extra exposures, grades, or hint resets.
5. Rapid repeated grade clicks create one persisted review.
6. Two tabs open the same session; a stale tab cannot clobber canonical state.
7. Paper-input session works through keyboard only, with visible focus.
8. 360px viewport has no horizontal overflow; drawing controls remain usable.
9. Flag ambiguity → paused collection status → resume → original due date retained.
10. Export → new context/import → same schedule/history/summary.
11. Full catalog search/filter/pagination; no fabricated characters or missing count.
12. After initial page/assets load, disable network and complete a session. Do not
    assert offline reload support, which belongs to the future PWA milestone.
13. Validate sources/attribution links and Japanese glyph rendering.

Unit/integration tests remain the place to simulate storage failures and midnight
transitions deterministically; do not reproduce every test at every level.

### Final verification commands

```sh
npm ci
npm run check
npm run build
npm run test:e2e
```

Run formatting fixes explicitly if needed, then rerun affected checks. Do not add
automatic lint suppression, skip tests, or widen types merely to get a green result.

Manually inspect at least one phone-width drawing flow and one desktop/paper flow.
Check contrast, target glyph visibility, and pointer behavior; test runners cannot
fully validate their quality.

## 13 — Finish documentation and release handoff

### Files

```text
README.md
DATA_SOURCES.md
BUILD_PROGRESS.md
```

### README contents

- Product purpose and version 1 boundaries.
- Node/npm prerequisites and `npm ci` / `npm run dev` setup.
- Commands for formatting, lint, typecheck, tests, build, preview, and E2E.
- Local-first storage, export/import, and the distinction from offline cold starts.
- Exact self-grading/hint rules and the difference between scheduled reviews/rematches.
- Data sourcing/attribution and pointer to `DATA_SOURCES.md`.
- Static deployment: publish `dist/`, HTTPS, hash routing, correct Vite base when served
  from a subdirectory. No secrets or server environment variables required.
- Known limitations: no auto handwriting grading, no full reading curriculum yet,
  no account sync, no PWA installation guarantee.

### Data maintenance instructions

Document fetch/import/validate/check commands, expected 2,136 count, upstream license
review, manifest diff review, and monthly/pre-release refresh procedure. A source
update must not change stable IDs or reset IndexedDB. State how to recover from a
count mismatch without weakening validation.

### Completion gate

Check every item in architecture section 12 against actual behavior. Mark progress
complete only when the final commands have succeeded and manual checks are recorded.
Give the user a concise handoff with run command, completed features, and any real
remaining limitations. Do not label roadmap items as implemented.

## Appendix A — Small-model task prompt template

Use this when handing a single checkpoint to another implementation session:

```text
Implement checkpoint [NN] from IMPLEMENTATION_PLAN.md in the KanjiPain folder.

Read BUILD_PROGRESS.md and the architecture sections referenced by that checkpoint.
Inspect existing work before editing. Complete only this checkpoint and prerequisite
fixes needed for it. Use the documented stack, module boundaries, and data contracts.
Do not invent new product requirements or implement roadmap features.

Run the checkpoint's acceptance checks. Fix failures caused by your changes.
Update BUILD_PROGRESS.md with changed responsibilities, commands/results, blockers,
and the next checkpoint. Never claim an unrun check passed.
```

## Appendix B — Common mistakes to avoid

| Mistake                                              | Required implementation                                |
| ---------------------------------------------------- | ------------------------------------------------------ |
| List of example kanji presented as complete          | Import and validate all 2,136 Jōyō entries             |
| Recognition choices instead of recall                | Blank drawing/paper attempt before reveal              |
| Comparing drawing pixels to a font                   | Honest self-grading in version 1                       |
| Treating every dictionary radical as a decomposition | Only reviewed optional component notes                 |
| Rating a hint-assisted answer Good                   | Force Again in the application service                 |
| Calling FSRS for every local retry                   | Schedule primaries only; log rematches separately      |
| Replacing FSRS with custom intervals                 | Pinned adapter and serialized full state               |
| v5 examples with v6 dependency                       | DefaultScheduler/newCard/review API                    |
| Creating all planned new cards immediately           | Enroll only on actual persisted introduction           |
| Counting UTC dates as local days                     | Local calendar-day helper                              |
| Progress only in React state/localStorage            | Transactional IndexedDB                                |
| Saving card and event in separate operations         | One atomic multi-table transaction                     |
| Repeated click creates repeated reviews              | Attempt ID idempotency plus revision/version checks    |
| Reveal resets after refresh                          | Persist phase and draft/hint state                     |
| Backup parsing after deletion                        | Validate fully, then replace atomically                |
| Fetching dictionary data during every build          | Commit generated assets; explicit maintenance commands |
| Announcing offline install without service worker    | State loaded-app offline behavior precisely            |
| Styling before testing the learning engine           | Follow dependency order and checkpoint gates           |
