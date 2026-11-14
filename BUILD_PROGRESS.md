# KanjiPain Build Progress

Last updated: 2026-11-14

## Checkpoints

- [x] 01 — Bootstrap a reproducible frontend
- [x] 02 — Define contracts and validation boundaries
- [x] 03 — Import and validate the complete Jōyō catalog
- [x] 04 — Add durable storage and repositories
- [x] 05 — Implement the pinned FSRS adapter
- [x] 06 — Implement pure prompts, queue, state machine, and metrics
- [x] 07 — Wire transactional application services
- [x] 08 — Build the app shell and drawing input
- [x] 09 — Implement the complete practice route
- [x] 10 — Build Dojo, Wall, and character details
- [x] 11 — Settings, sources, and portable progress
- [x] 12 — Browser-level verification and edge-case hardening
- [x] 13 — Finish documentation and release handoff

## Checkpoint 01 notes

- Installed Node.js 24.22.3 through the existing nvm installation; the project pins major 24 in `.nvmrc` and `package.json`.
- Bootstrapped React 19, strict TypeScript, Vite 8, Vitest, ESLint, Prettier, and the documented application dependencies.
- Direct dependencies are exact-version pinned in `package.json`; `package-lock.json` is committed project state.
- Added the architecture's module directories and a minimal KanjiPain foundation screen.
- Added a smoke test and test setup so the unit-test command has real coverage from the first checkpoint.
- Catalog maintenance scripts and the aggregate `npm run check` are intentionally pending checkpoint 03. Their npm commands point at the documented future scripts; no fake success stubs were added.

## Checkpoint 01 verification

- `npm run format:check` — passed.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run test` — passed (1 test file, 1 test).
- `npm run build` — passed with Vite 8.3.8.
- `npm run dev -- --host 127.0.0.1` — served successfully; the returned HTML contained the KanjiPain root and entry module. The verification server was then stopped intentionally (exit 143 from SIGTERM).
- `npm ls --depth=0` — passed with the exact direct dependency tree installed.
- `npm audit --omit=dev` — passed with zero production vulnerabilities. The full audit currently reports ten moderate findings through development-only ESLint/minimatch dependencies; npm offers only a forced breaking downgrade, so no unsafe automatic remediation was applied.
- `npm run check` — not run because `data:validate` is intentionally unavailable until checkpoint 03, as required by the implementation plan.

## Checkpoint 02 notes

- Added contracts for catalog entries/manifests, teaching notes, settings, cards, drawing attempts, prompts, review events, content issues, session items, session records, and discriminated session phases.
- Prompt and feedback phases use unrevealed/revealed draft types respectively; summary phases cannot carry editable draft state.
- Added strict Zod structural schemas with bounded integer, enum, timestamp, stroke, normalized-point, and within-record validation.
- Kept scheduler payloads as opaque JSON objects. Their exact pinned `ts-fsrs` fields remain intentionally reserved for checkpoint 05.
- Added injectable production clock and ID sources, deterministic kanji/card ID helpers, and a local-calendar day helper.
- Added the empty, validated `src/data/teaching-notes.json` starting point. Catalog membership and cross-record reference validation remain responsibilities of later catalog/backup checkpoints.

## Checkpoint 02 verification

- `npm run format:check` — passed.
- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm run test -- tests/domain` — passed (3 files, 25 tests).
- `npm run test` — passed (4 files, 26 tests).
- `npm run build` — passed.
- `npm run check` — still intentionally pending checkpoint 03's production catalog validator.

## Checkpoint 03 notes

- Added an explicit, atomic KANJIDIC2 fetch command with response metadata and input SHA-256 recording. Raw downloads remain ignored and are never required by normal builds or tests.
- Added a local-gzip importer that disables XML entity expansion, preserves attributes, normalizes singleton/repeated fields, filters grades 1–6/8, and rejects malformed or duplicate selected entries.
- Generated and committed the complete 2,136-entry catalog plus a provenance manifest. Dataset version: `4d5746dd603285b9ccd23e54b719cadf8b4ba41208d609c0cb4914cc4e35ed67`.
- Added independent production validation for exact count, unique IDs/literals, stable Unicode IDs, deterministic curriculum order, cues, note references, target leaks, hashes, and dataset-version formula.
- Added the read-only catalog repository with complete `all`, `byId`, and `orderedIds` access.
- Added fixture and production catalog tests covering excluded grades, language filtering, source ordering, punctuation, stroke-count selection, duplicate rejection, deterministic output, 湖, and immutable views.
- Added `DATA_SOURCES.md`, bundled EDRDG documentation/license copies, and the Noto Sans JP OFL notice. The source-data license is documented separately from application code.

## Checkpoint 03 verification

- `npm run data:fetch` — passed; downloaded 1,488,576 bytes and recorded source metadata.
- `npm run data:import` — passed twice against the same source; both runs produced catalog SHA-256 `678f6b7ec215b5703ad6d0925b4bb12670de6288bc722e77639cbc132a9dc5cb`.
- `npm run data:validate` — passed with exactly 2,136 unique Jōyō entries.
- `npm run test -- tests/scripts` — passed (2 files, 8 tests).
- `npm run check` — passed (6 test files, 34 tests, including formatting, lint, typecheck, and catalog validation).
- `npm run build` — passed.

## Checkpoint 04 notes

- Added the version 1 `kanjipain` Dexie database with the documented cards, events, sessions, settings, content-issues, and metadata tables. Boolean fields are not indexed.
- Added idempotent transactional initialization that creates default settings exactly once and never creates user cards.
- Added validated repository reads for settings, individual/due cards, card history, individual/filtered sessions, the active session, content issues, and local-day introductions.
- Added typed storage errors for unavailable IndexedDB, quota failures, generic operations, invalid persisted records, and stale revisions while preserving original causes.
- Added an application provider that validates the bundled catalog and opens storage before rendering children. Blocking catalog/storage errors provide an explicit retry flow.
- Kept Dexie private to storage/provider modules. UI consumers receive catalog/repository services and reactive `dexie-react-hooks` read hooks through context.
- Added fake-IndexedDB tests for reopen durability, idempotent settings, no startup cards, due-boundary filtering, local-day introductions, invalid-record rejection, startup/retry UI, reactive settings, and multi-table rollback.

## Checkpoint 04 verification

- `npm run test -- tests/storage tests/app` — passed (3 matched files, 10 tests).
- `npm run check` — passed (8 files, 43 tests, including formatting, lint, typecheck, and catalog validation).
- `npm run build` — passed. Vite reports the expected large initial chunk now that the complete bundled catalog is loaded at startup; code splitting remains a later optimization, not a functional failure.

## Checkpoint 05 notes

- Added a one-time asynchronous `DefaultScheduler` initialization using pinned `ts-fsrs@6.0.0`, model `FSRS-7`, desired retention `0.9`, short-term scheduling disabled, fuzz disabled, and a 36,500-day maximum interval.
- Added a synchronous application adapter after initialization. It maps `got` to Good, `barely` to Hard, and `missed` to Again; Easy is not an application grade.
- Explicitly serialized all 12 pinned card fields and all 11 revlog fields. FSRS `Date` values become epoch milliseconds and are restored before library calls.
- Added strict Zod validation and envelopes carrying adapter version `1`, package version `6.0.0`, and model `FSRS-7`. Card/event persistence boundaries now validate these exact envelopes instead of opaque records.
- Preserved the complete FSRS-7 memory state, including `stabilityFast`, and froze adapter results, envelopes, and serialized payloads.
- Added explicit clock-rollback rejection against `lastReviewAt`. The adapter accepts only card, grade, and review time, so drawing duration cannot influence scheduling.
- Added direct-library equivalence tests for creation and all three mappings, deterministic replay, input immutability, complete JSON round trips, second reviews after round trips, unsupported metadata, and rollback protection.

## Checkpoint 05 verification

- `npm run test -- tests/scheduler/fsrs-adapter.test.ts` — passed (1 file, 13 tests).
- `npm run check` — passed (9 files, 56 tests, including formatting, lint, typecheck, catalog validation, and the full suite).
- `npm run build` — passed. The existing expected large catalog chunk warning remains non-fatal.

## Checkpoint 06 notes

- Added pure production-prompt construction with reviewed overrides, kun/on reading cues, ordered optional mnemonic/component hints, an always-available stroke-count hint, immutable output, and target-glyph leak rejection. Full answer remains an action rather than prompt data.
- Added deterministic due-first session planning with the fixed 20-primary limit, due/curriculum/ID ordering, suspended-card exclusion, unseen curriculum selection, and local-day introduction allowance accounting.
- Added explicit next-item decisions for eligible rematches, primary work, short-rematch offers, and completion. Rematch eligibility requires three distinct other completed cards.
- Added a pure session reducer covering introduction, prompt, reveal, feedback, repair, selection, completion, and early finish. It rejects invalid transitions, frozen-answer edits, empty comparisons, assisted passes, version mistakes, duplicate retries, and retry attempts beyond the second rematch.
- Added deterministic rematch gap accounting and event references. Graded primary/rematch completions count once per distinct other card; ambiguity skips and repair work do not add gap credit.
- Added summary metrics for independent reviews, actual introductions, recovered misses, and unresolved primary misses, including assisted and first-learning exclusions.
- Added character status derivation for unseen/introduced/developing/reliable plus independent due/paused badges. Reliability uses the exact latest-three, fourteen-day-span, and seven-day-interval rules.

## Checkpoint 06 verification

- `npm run test -- tests/domain` — passed (8 files, 59 tests).
- `npm run check` — passed (14 files, 90 tests, including formatting, lint, typecheck, catalog validation, and the full suite).
- `npm run build` — passed. The existing expected large catalog chunk warning remains non-fatal.

## Checkpoint 07 notes

- Added injected session, review, content-issue, and draft-save services over the private Dexie database. Services receive the immutable catalog, initialized scheduler, clock, and ID source.
- Serialized active-session creation in a transaction. Matching active sessions resume; obsolete dataset sessions end without deleting history before a replacement is planned.
- Added atomic introduction opening: planned cards remain absent until exposure, the local-day allowance is rechecked at opening time, and unreviewed exposed cards reopen their introduction without consuming another slot.
- Added serialized prompt/repair draft saves with revision returns and flushes before reveal, grading, repair completion, item navigation, and session finish. Hints and reveal state are durable before commands return.
- Added atomic scheduled grading with event-first idempotency checks, optimistic session/card versions, forced assisted/surrender grading, one FSRS call, and all-or-nothing card/event/session writes.
- Added rematch event persistence without scheduler/card mutation, deterministic retry IDs, repair transitions, and early finish without fabricated events.
- Added atomic ambiguity handling that preserves scheduler state, increments the card version, pauses the card, records the event and content issue, cancels pending retries, and supports version-checked resume.
- Startup now initializes FSRS before publishing application services, ensuring scheduler initialization never occurs inside a transaction.
- Extended the catalog service with immutable validated teaching notes for persisted hint selection.

## Checkpoint 07 verification

- `npm run test -- tests/services` — passed (3 files, 15 tests).
- `npm run check` — passed (17 files, 105 tests, including formatting, lint, typecheck, catalog validation, and the full suite).
- `npm run build` — passed. The existing expected large initial chunk warning remains non-fatal; FSRS model chunks are emitted separately.

## Checkpoint 08 notes

- Added the HashRouter shell with all documented route paths, minimal route headings, active navigation, a persistent sources footer, direct-link reload support, and a not-found screen. Practice uses a quieter header with an explicit exit link.
- Added route-change focus, a skip link, rendering-error recovery, shared Button and native modal Dialog components, and reusable keyboard-accessible paper confirmation.
- Added design tokens, responsive layouts, 44px control targets, focus indicators, reduced-motion rules, system fonts for English, and bundled Noto Sans JP for `lang="ja"` content.
- Added controlled SVG drawing with normalized coordinates, single-pointer capture, mouse/touch/pen support, clamping, minimum point spacing, dots, rounded paths, undo/clear, and read-only submission state. Only completed gestures emit changes; cancellation discards the active partial stroke.
- Enforced 100-stroke and 20,000-point limits with actionable feedback. Canvas-only touch handling preserves page gestures elsewhere; normalized paths retain proportions after resizing.
- Added component tests and a dedicated browser fixture for input verification. The fixture is outside the production entry point. Playwright now runs Chromium checks separately from Vitest.
- Verified contrast: text/background 16.18:1, text/surface 14.33:1, muted/surface 8.16:1, accent/surface 5.67:1, ink/accent 5.92:1, ink/paper 14.99:1, and control border/surface 3.49:1.

## Checkpoint 08 verification

- `npm run check` — passed (19 files, 111 tests, including formatting, lint, typecheck, catalog validation, and the full unit/integration suite).
- Chromium browser coverage: drawing commit/capture, undo/clear/freeze, touch cancellation, pen input, multi-touch exclusion, stroke/point limits, normalized resize, keyboard paper input, modal focus restoration, hash navigation/reload, and 360px layout (8 tests).
- `npm run build` — passed with the existing non-fatal initial chunk-size warning.
- Browser setup: `npx playwright install chromium`; run checks with `npm run test:e2e`.

## Checkpoint 09 notes

- Wired `/practice` and `/sessions/:id` to the persisted session service: the route starts or resumes the active session, opens the next queue decision automatically, and renders strictly from the stored phase.
- Added the introduction, recall prompt, feedback, repair, short-rematch, and summary screens. Introduction and feedback show real catalog meanings, readings, stroke count, and reviewed teaching notes.
- Kept the target glyph out of the prompt DOM: the prompt uses meaning and reading cues only, and the target mounts after reveal. The prompt deliberately does not link to character details.
- Added input-mode switching, persisted hints with a monotonic ladder, paper confirmation, empty-submission prevention, immediate surrender, and assistance-aware grading. Assisted attempts expose only `Continue — practice again`.
- Displayed frozen attempts beside the target, stacked on narrow screens, with honest self-grading copy and an ambiguity action that pauses the card instead of inventing a failure.
- Kept transitions disabled while writes commit, left failed writes recoverable with a visible retry, and automatically reloaded canonical state with an explanation after a stale-tab revision conflict.
- Flushed drafts before reveal, grading, repair completion, and finish through the existing serialized save queue. Practice has no navigation links or footer, so no accidental link can discard completed strokes.
- Added storage reads for session review events and introduced cards, plus live-query hooks, so summaries use `calculateSummary` rather than UI counters.
- Fixed `DraftSaveQueue.flush` so a previously failed save cannot be replayed as the failure of an unrelated later command; failures still reach the caller that made them.
- Disabled the shell navigation and footer during active practice and removed the programmatic main focus outline.

## Checkpoint 09 verification

- `npm run check` — passed (20 files, 116 tests, including formatting, lint, typecheck, catalog validation, and the full unit/integration suite).
- Practice integration coverage: introduction-to-grade flow, paper keyboard attempt, hint persistence across input changes, assisted miss through repair, revealed-answer reload, surrender without drawing, stale-tab recovery, and summary metrics.
- Chromium browser coverage: real mouse drawing through grading and finishing, keyboard-only paper attempt at 360px with stacked feedback, and hint/assistance/repair persistence across reloads (11 total browser tests including checkpoint 08).
- `npm run build` — passed with the existing non-fatal initial chunk-size warning.
- Manual browser pass (Chromium): introduced 日, hid it, compared a paper attempt, graded `Got it`, saw the next new character, finished early, and read the partial summary at `/#/sessions/:id`.

## Checkpoint 10 notes

- Replaced the Dojo placeholder with a live daily dashboard: due count, remaining new-character allowance, paused count, an approximate 30-seconds-per-exercise session estimate, start/resume actions, and a link to the latest finished summary. Counts come from live stored cards and sessions, never from invented progress.
- Added first-visit onboarding that explains writing-only scope, honest self-grading, local-only storage, and backups. Its completion flag is persisted through a new validated settings service, so returning users go straight to the Dojo.
- Added the Wall at `/collection`: all 2,136 characters in a responsive grid, 120 per page, with visible learning/status labels, due and paused overlays, stable `/kanji/:id` links, page controls, and clear empty/loading states.
- Added catalog-wide search before pagination: literal kanji, case-insensitive English meaning substrings, and kana readings with katakana/hiragana equivalence. Source readings are normalized only for comparison and remain unchanged in storage and display.
- Added all seven filters: all, unseen, introduced, developing, reliable, due, and paused. Due/paused are overlays independent of the underlying learning state.
- Added character details: meanings, on/kun readings with the KOD/KANJIDIC punctuation explanation, stroke count, frequency/curriculum order, current schedule and status, and the latest twenty event records with kind, grade, assistance, input mode, and hints.
- Added version-checked pause recovery to the detail screen. Resuming clears only the pause; the existing due date and scheduler state remain untouched.
- Extended storage with all-card and all-event reads plus live-query hooks, added a coarse display clock for due overlays, and kept browsing read-only so no card or introduction is created by opening the collection or a character.

## Checkpoint 10 verification

- `npm run check` — passed (23 files, 127 tests, including formatting, lint, typecheck, catalog validation, and the full unit/integration suite).
- Collection integration coverage: 120-per-page full-catalog pagination, 18 pages, 湖 by literal/English/hiragana/katakana, stable `k-6e56` route, detail content, unknown-ID state, and due-filter empty state.
- Onboarding coverage: first visit shows onboarding, completion persists, and a second mount opens the Dojo directly. Settings service tests cover persistence, card preservation, and schema rejection.
- Chromium browser coverage: existing 11 tests passed after the onboarding-aware shell update.
- `npm run build` — passed with the existing non-fatal initial chunk-size warning.

## Checkpoint 11 notes

- Added a validated settings service and `/settings` page for the daily new-character limit (`0`–`10`) and the default input mode. Saving preferences never changes cards, due dates, or the number of characters introduced today; it only affects future planning and attempts.
- Added the version 1 backup envelope (`format: 'kanjipain-backup'`, `version: 1`) with export timestamp, catalog dataset version, pinned scheduler metadata (`adapterVersion: 1`, `packageVersion: '6.0.0'`, `model: 'FSRS-7'`), cards, events, finished sessions, settings, and content issues. The static catalog and every drawing are excluded.
- Export reads a consistent snapshot inside one read transaction and rejects export while any session is active. Import/export controls stay disabled with a resume link until the active session is finished.
- Import pipeline is size limit → header check → strict schema parse → cross-record validation → count preview → explicit replacement confirmation → one atomic write transaction. Files over 25 MiB, invalid JSON, unsupported versions, unsupported scheduler metadata, duplicate IDs, dangling references, inconsistent sessions/events/issues, and active sessions are rejected before any write.
- Import is replace-only. It validates the complete file, clears the user tables, and restores within the same transaction. A simulated write failure leaves the previous cards, events, sessions, and settings intact.
- A backup created with a different catalog dataset hash is accepted when every recorded kanji ID exists in the current catalog; each record keeps its original dataset metadata.
- Added the `/sources` page with EDRDG/KANJIDIC2 attribution and links, bundled documentation and license copies, CC BY-SA 4.0 notice, generated dataset date and all SHA-256 hashes, the transformation description, Noto Sans JP/OFL attribution, application version, and the monthly/pre-release data-maintenance notice. The shared footer links to it from every non-practice screen.
- Added import preview with record counts, dataset-version difference notice, explicit replacement warning, and an “Export current progress first” action.

## Checkpoint 11 verification

- `npm run check` — passed (24 files, 136 tests, including formatting, lint, typecheck, catalog validation, and the full unit/integration suite).
- Backup coverage: export → empty database → import round-trip for cards, schedules, history, finished sessions, settings, and content issues; scheduler state and pause state preserved; drawings absent from export; export re-parses under its own strict validator.
- Rejection coverage: malformed JSON, unsupported backup version, unsupported scheduler model, unknown catalog IDs, duplicate event IDs, dangling session references, active sessions, and files over 25 MiB.
- Failure coverage: a simulated `bulkAdd` failure rolls back the replace transaction and keeps the previous database byte-for-byte equivalent at the table level.
- Settings coverage: preferences persist, onboarding stays completed, invalid limits are rejected without a write, and changing the daily limit does not reduce today’s introduced cards.
- `npm run build` — passed with the existing non-fatal initial chunk-size warning.
- `npm run test:e2e` — passed (11 Chromium tests) after onboarding-aware shell updates.

## Checkpoint 12 notes

- Replaced the dev-server browser harness with a production build/preview on fixed port 4173, with unrelated-server reuse disabled. A separate multi-page `dist-e2e/` build serves both the actual app and the isolated drawing fixture; the deployable `dist/` stays fixture-free.
- Expanded Chromium coverage from 11 to 32 tests across onboarding, practice, persistence, backup, collection, accessibility, shell, and drawing. Tests use fresh contexts and a fixed browser clock; fixture generation pins its clock and local-day timezone.
- Added deterministic valid backup fixtures generated with the real catalog, FSRS adapter, and application services against fake IndexedDB. Browser seeding uses the public import preview/replacement flow. A read-only IndexedDB test helper waits for a committed stroke before reloading; no production debug API or globals were added.
- Covered first visit through summary; due-card hinted miss and three-distinct-card rematch spacing; both bounded short rematches and automatic finish; prompt/feedback/repair reloads; repeated grade activation and persisted history; stale tabs; keyboard paper input; 360px layout; ambiguity pause/resume with due date retained; backup into a new context; full 2,136-entry search/filter/pagination; loaded-app network-disabled practice; and attribution/license/font checks.
- Browser hardening fixed three actual UI defects: repair drafts were ignored by the controller; accepted short-rematch offers remained in transient UI state and prevented automatic completion; and keyed settings forms erased save confirmations after the live database update. Added integration regressions for each.
- Initial page load now leaves the first keyboard Tab available to the skip link; subsequent route changes still focus main content.
- Audit corrected the default meaning cue to the architecture's first three English meanings (rather than only the first), with unit and browser expectations updated. No schema or stored progress change was needed.
- A newly displayed but ungraded introduction counts toward the daily allowance and remains due. Summary tests now distinguish that intentional enrollment behavior from a reviewed card's future FSRS due date.

## Checkpoint 12 verification

- `npm run check` passed (25 files, 139 tests); production build passed; all 32 Chromium tests passed. Final clean-install verification is recorded below.
- Visual review on the production `dist/` preview at port 4174: inspected 360×800 introduction/drawing/feedback screenshots and a 1440×1000 keyboard/paper feedback screenshot. Large target glyphs were legible, drawing ink contrasted with the paper surface, mobile feedback stacked, desktop grading stayed beside the attempt, and keyboard focus was visible.
- Exercised four mouse-drawn strokes, compare, miss, repair hide/show, and early summary at phone width; keyboard paper confirmation, compare, grade, and summary at desktop width. No horizontal overflow or browser page errors occurred. Pointer capture/cancellation, touch and pen event paths are covered by the browser fixture tests; no claim of physical-device or screen-reader testing is made.
- Preview server was stopped after the review. Screenshots are review artifacts in the approved external temporary directory, not deployed app assets.

## Checkpoint 13 notes

- Added `README.md` with setup, commands, practice and grading rules, schedule/rematch distinction, IndexedDB scope and loss risks, backup workflow, static deployment/base path guidance, data attribution, and explicit version 1 limitations.
- Expanded `DATA_SOURCES.md` with monthly/pre-release review, all maintenance/check commands, manifest and fixture diff review, metadata provenance, stable-ID/no-reset requirements, and safe count-mismatch recovery without weakening validation.

## Release-criteria audit (architecture section 12)

| Criterion                                                     | Evidence                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 2,136 valid unique Jōyō entries and attribution               | `data:validate`, production-catalog tests, collection and sources browser tests; shipped `public/licenses/`         |
| Introduction → attempt → feedback → grade → rematch → summary | Practice integration and browser suites, including repair persistence and exhausted short-rematch completion        |
| One FSRS update per primary                                   | Review-service atomic/idempotency tests, adapter tests, rapid-click browser test with exact persisted history count |
| Assisted results cannot become independent successes          | Service rejection tests, reducer tests, hint/input/reload browser flow                                              |
| Mouse/touch/pen drawing and paper input                       | Drawing browser fixture tests, phone-width drawn flow, desktop keyboard/paper visual review                         |
| Reload preserves active/revealed/committed state              | Session-service and prompt/feedback/repair browser tests                                                            |
| Concurrent tabs / rapid-click safety                          | Revision/card-version checks, service replay tests, stale-tab and repeated-activation browser tests                 |
| Daily limits, 20/60 bounds, early finish                      | Date/queue/reducer/service tests, settings persistence and partial-summary browser tests                            |
| Full collection and validated portable progress               | Full-catalog search/filter/pagination tests; backup unit rollback/rejection and fresh-context browser round-trip    |
| All quality commands pass                                     | Clean install, check (139 tests), production build, and Chromium (32 tests) passed                                  |
| Phone/desktop review and shipped sources/licenses             | Visual review above; sources browser checks cover attribution, hashes, bundled license URLs and Japanese font       |

## Final verification and handoff

- `npm ci` — passed using Node 24.22.3 and npm 11.19.1.
- `npm run check` — passed: formatting, lint, strict typecheck, 2,136-entry catalog/hash validation, and 139 unit/integration tests in 25 files.
- `npm run build` — passed; deployable output is `dist/`, without the browser input fixture.
- `npm run test:e2e` — passed: 32 Chromium tests against the production-mode preview.
- `npm run e2e:fixtures` — passed; regenerated output was verified byte-for-byte stable after applying the repository JSON formatting in the generator.
- The source-manifest browser assertion uses Node's explicit JSON import attribute; ordinary app bundling remains unchanged.
- Non-blocking warnings: Vite's bundled-catalog chunk is over 500 kB; npm reports install-script approval notices and 9 moderate development-toolchain audit findings (minimatch glob amplification advisory propagated through ESLint/TypeScript-ESLint). `npm audit --omit=dev` reports zero vulnerabilities. No forced audit fix, dependency upgrade, or install-script approval was applied.
- All 13 implementation checkpoints are complete. Start development with `npm run dev`, or build and serve `dist/` over HTTP(S). Export local progress before clearing site data or changing origins/devices.
- Version 1 limitations remain intentional: honest self-grading, no automatic handwriting/stroke-order scoring, no full reading/vocabulary curriculum, no account sync, and no PWA/offline-cold-start guarantee. Physical-device and screen-reader QA remain outside the recorded Chromium/visual review.

## Next

No remaining implementation checkpoint. See `README.md` for running/deploying and `DATA_SOURCES.md` for ongoing data maintenance.
