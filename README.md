# KanjiPain

Effortful kanji recall practice. Version **0.1.0** implements the version 1 writing-practice scope: all **2,136 Jōyō kanji**, scheduled reviews, drawing or paper input, honest self-grading, and portable local progress.

No backend, account, analytics, AI grading, or runtime dictionary API is required.

## Run locally

Use **Node.js 24** (`.nvmrc`) and **npm 11** (lockfile generated with 11.19.1).

```sh
nvm use 24
npm ci
npm run dev
```

Open the URL printed by Vite. Dependencies are pinned in `package-lock.json`; ordinary installation and builds use the bundled catalog without downloading dictionary data.

## Practice

1. Enter the Dojo. Start a session or resume the active one.
2. For a new character, study the introduction, then hide it. Recall prompts show up to three English meanings and Japanese reading cues, not the target glyph.
3. Draw at least one stroke, or select **Write on paper** and confirm your paper attempt. Compare only when ready; your submitted drawing is frozen.
4. Grade the answer yourself:
   - **Got it**: correct without extra help → FSRS Good.
   - **Barely**: correct but hesitant → FSRS Hard.
   - **Missed it**: wrong or incomplete → FSRS Again.
   - Any requested hint, full-answer reveal, or **I don't know** makes the attempt assisted and forces a miss. Switching input modes or reloading cannot undo assistance. The service enforces this, not just the buttons.
5. After a miss, repair is unscored. A rematch normally follows three distinct other card completions; short queues explicitly offer less-spaced practice. Each character gets at most two rematches per session.

Only primary attempts update FSRS, including a new character's first graded check. Rematches record local practice but never alter the schedule or count as independent reviews. The adapter pins `ts-fsrs@6.0.0`, FSRS-7, desired retention 0.9, short-term scheduling off, fuzz off, and maximum interval 36,500 days.

Sessions prioritize due cards and have at most 20 primary exercises and 60 graded attempts including rematches. The daily new limit defaults to 5 and is configurable from 0–10; 0 stops introductions, not due reviews. Enrollment counts when an introduction is displayed and persisted—not when graded. Finishing after the next introduction can therefore count an unreviewed new character, which remains due. You can finish early at any phase.

The Collection searches the whole catalog before pagination, with progress filters and character details/history. **This prompt is ambiguous** pauses the card without an FSRS failure; resume it from character details without moving its due date.

## Your data

Progress, settings, history, and active session drafts live in **IndexedDB** (`kanjipain`), scoped to the browser profile and site origin. Completed strokes, hints, and revealed phases survive reloads once saved. Rapid grade clicks are idempotent; stale tabs reload canonical state with a notice rather than overwriting it.

**Export backups regularly from Settings.** Clearing site data, discarding private browsing, browser eviction, or changing origin can lose access to local progress. There is no server copy or cross-device sync.

- Export/import is available only after finishing the active session.
- Backups are unencrypted version 1 JSON containing cards, schedules, events, finished sessions, settings, and content issues. They exclude drawings and the static catalog.
- Import checks the 25 MiB limit, schema, scheduler compatibility, catalog IDs, and record relationships before writing. Preview the counts, optionally export current progress, then explicitly confirm replacement.
- Import **replaces**, never merges, local progress in one transaction. Invalid files or failed writes leave existing progress intact.

Local-first does **not** mean installable/offline-first: once app assets and the scheduler have loaded, practice can continue with the network disabled. There is no service worker, guaranteed offline reload/cold start, or PWA installation support.

## Development commands

| Command                                   | Purpose                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `npm run format` / `npm run format:check` | Apply/check Prettier formatting                                         |
| `npm run lint`                            | ESLint                                                                  |
| `npm run typecheck`                       | Strict TypeScript project checks                                        |
| `npm test` / `npm run test:watch`         | Unit/integration tests, once/watch                                      |
| `npm run data:validate`                   | Validate catalog, notes, manifest hashes, and 2,136 count               |
| `npm run check`                           | Formatting, lint, types, catalog validation, all unit/integration tests |
| `npm run build`                           | Production app in `dist/`                                               |
| `npm run preview -- --host 127.0.0.1`     | Serve the production build locally                                      |
| `npm run test:e2e`                        | Production-preview Chromium tests                                       |
| `npm run e2e:fixtures`                    | Regenerate deterministic test backups using real services               |

Install the browser once before running E2E:

```sh
npx playwright install chromium
npm run test:e2e
```

Playwright builds `dist-e2e/` and owns port **4173**; stop anything else on that port first. It never reuses an existing server. The separate production-mode E2E build includes an isolated input fixture; the deployable `dist/` does not. Each test gets fresh browser storage and a fixed clock. Seed backups are imported through Settings, not production debug endpoints. Traces are retained under `test-results/` on failure.

Release gate:

```sh
npm ci
npm run check
npm run build
npm run test:e2e
```

Also visually review a 360px drawing flow and desktop keyboard/paper flow, including glyph visibility, contrast, focus, and pointer behavior. Chromium automation does not replace physical touch/pen or assistive-technology testing.

## Static deployment

Publish **`dist/`** to an HTTPS static host, including `assets/` and `licenses/`. No secrets or server environment variables are needed. Hash routing (`/#/practice`, `/#/collection`, etc.) needs no application-route rewrite rules. Serve the build over HTTP(S), not `file://`.

For a subdirectory deployment, set the Vite base at build time:

```sh
npm run build -- --base=/kanjipain/
```

Publish `dist/` at `/kanjipain/`. Keep the origin stable; moving to another origin requires exporting/importing progress. Vite preview is a local verification server, not the production hosting recommendation.

## Sources and limits

Catalog data is a transformed KANJIDIC2 extract, attributed to **James William Breen and EDRDG**, under **CC BY-SA 4.0**, separate from any application-code license. Japanese glyphs use bundled **Noto Sans JP**, under **SIL OFL 1.1**. The in-app Sources & licenses page ships the attribution, transformation notice, dates, hashes, and license copies. See [DATA_SOURCES.md](./DATA_SOURCES.md) for provenance and monthly/pre-release maintenance.

Version 1 does not recognize handwriting, assess stroke order, provide a full reading/vocabulary curriculum, promise curated mnemonics for every character, sync accounts, or guarantee PWA installation/offline cold starts. Dictionary cues can be ambiguous; use the local pause/resume workflow rather than treating ambiguity as a recall failure. The bundled catalog currently produces a non-fatal Vite chunk-size warning.

Dependency audit at handoff (2026-11-14): `npm audit` reports 9 moderate findings in the development-only ESLint/TypeScript-ESLint/minimatch chain; `npm audit --omit=dev` reports zero. Review toolchain updates separately rather than running `npm audit fix --force` against the pinned stack.

Design and implementation records: [ARCHITECTURE.md](./ARCHITECTURE.md), [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md), and [BUILD_PROGRESS.md](./BUILD_PROGRESS.md).
