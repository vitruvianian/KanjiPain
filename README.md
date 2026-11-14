# KanjiPain

Effortful kanji recall practice. Version **0.1.0** implements the version 1 writing-practice scope: all **2,136 Jōyō kanji**, scheduled reviews, drawing or paper input, automatic checking of drawn characters with honest self-grading as the final word, and portable local progress.

No backend, account, analytics, remote AI grading, or runtime dictionary API is required. Drawings are checked in the browser against bundled stroke data.

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
2. For a new character, study the introduction, then hide it. The introduction shows how to write the character: an animation draws the strokes in order, each numbered at its starting point, with a step-by-step chart below. The same guide appears on each character's Collection page and when the answer is shown during repair. Recall prompts show up to three English meanings and Japanese reading cues, not the target glyph.
3. Draw at least one stroke, or select **Write on paper** and confirm your paper attempt. Compare only when ready; your submitted drawing is frozen.
4. For a drawn attempt, the app checks your strokes against the standard form and shows a verdict with a suggested grade:
   - **Matches** → suggests Got it.
   - **Right shape, wrong stroke order or direction**, or strokes joined/split → suggests Barely.
   - **Wrong stroke count, a look-alike character, or no match** → suggests Missed it.

   The checker compares stroke shape, position, order and direction after normalizing for where and how large you drew. It can be wrong, so the grade stays yours: grading a rejected drawing as correct asks for one confirmation. The verdict is saved with the review. Paper attempts, and the nine characters with two accepted stroke counts when drawn in the other form, are self-graded as before.

5. Grade the answer:
   - **Got it**: correct without extra help → FSRS Good.
   - **Barely**: correct but hesitant → FSRS Hard.
   - **Missed it**: wrong or incomplete → FSRS Again.
   - Any requested hint, full-answer reveal, or **I don't know** makes the attempt assisted and forces a miss. Switching input modes or reloading cannot undo assistance. The service enforces this, not just the buttons.
6. After a miss, repair is unscored. A rematch normally follows three distinct other card completions; short queues explicitly offer less-spaced practice. Each character gets at most two rematches per session.

Only primary attempts update FSRS, including a new character's first graded check. Rematches record local practice but never alter the schedule or count as independent reviews. The adapter pins `ts-fsrs@6.0.0`, FSRS-7, desired retention 0.9, short-term scheduling off, fuzz off, and maximum interval 36,500 days.

Sessions prioritize due cards and have at most 20 primary exercises and 60 graded attempts including rematches.

To study beyond the plan, start an **extra session** from the Dojo or from any session summary, as often as you like:

- **Learn more new characters** introduces 5 more, past the daily limit. They are counted in today's introductions, so regular sessions add no further new characters today.
- **Review ahead** practises up to 20 learned characters, the soonest due first, even if they are not due yet. These are real FSRS reviews: an early review strengthens memory less, so the next interval grows less than an on-time review would. The daily new limit defaults to 5 and is configurable from 0–10; 0 stops introductions, not due reviews. Enrollment counts when an introduction is displayed and persisted—not when graded. Finishing after the next introduction can therefore count an unreviewed new character, which remains due. You can finish early at any phase.

The Collection searches the whole catalog before pagination, with progress filters and character details/history. **This prompt is ambiguous** pauses the card without an FSRS failure; resume it from character details without moving its due date.

## Decks

Practice uses one deck at a time. Choose it on the Dojo, in Settings, or on the **Decks** page.

- The **Standard deck** is the 2,136 Jōyō kanji. It cannot be renamed, edited or deleted; **Copy to a new deck** gives you an editable copy.
- **Custom decks** hold any characters with your own meanings, readings, note and mnemonic. Add characters by pasting them (`猫犬鳥`, or one per line), by importing a CSV/TSV file with a header row (`kanji`, `meanings`, `readings`, `note`, `mnemonic`; separate several values with `;`), by importing a deck JSON file exported from KanjiPain, or with **Add to deck** on a Standard character's page. Every import shows a preview first: new characters, characters already in the deck (merged, not added twice), and rows that cannot be used.
- **Stroke order is added automatically** for the roughly 6,700 characters KanjiVG covers. A character without stroke data is still accepted, with a clear warning: it has no stroke-order guide and no automatic check, so you grade it yourself.
- An entry needs a meaning or a reading before sessions use it, because a prompt never shows the character itself. A cue that contains the character is rejected.
- **Progress belongs to the character, not the deck.** Each character has one card and one schedule, shared by every deck that contains it. Sessions, new introductions, due counts and the Collection are limited to the active deck; a card due in another deck stays due. Deleting a deck keeps cards and history; such characters are listed in the Collection under "Characters not in any deck".
- A deck cannot be edited or deleted while a session is using it. Limits: 50 custom decks, 5,000 characters per deck, 5 MiB per import file.
- **Export as JSON/CSV** on a deck page shares the entries without any progress.

## Your data

Progress, settings, history, and active session drafts live in **IndexedDB** (`kanjipain`), scoped to the browser profile and site origin. Completed strokes, hints, and revealed phases survive reloads once saved. Rapid grade clicks are idempotent; stale tabs reload canonical state with a notice rather than overwriting it.

**Export backups regularly from Settings.** Clearing site data, discarding private browsing, browser eviction, or changing origin can lose access to local progress. There is no server copy or cross-device sync.

- Export/import is available only after finishing the active session.
- Backups are unencrypted version 2 JSON containing cards, schedules, events, finished sessions, settings, content issues, and custom decks. They exclude drawings and the static catalog. Version 1 backups (made before decks existed) still import.
- Import checks the 25 MiB limit, schema, scheduler compatibility, deck entries, and record relationships before writing. Preview the counts, optionally export current progress, then explicitly confirm replacement.
- Import **replaces**, never merges, local progress and custom decks in one transaction. Invalid files or failed writes leave existing progress intact.

Local-first does **not** mean installable/offline-first: once app assets and the scheduler have loaded, practice can continue with the network disabled. There is no service worker, guaranteed offline reload/cold start, or PWA installation support.

## Development commands

| Command                                   | Purpose                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `npm run format` / `npm run format:check` | Apply/check Prettier formatting                                         |
| `npm run lint`                            | ESLint                                                                  |
| `npm run typecheck`                       | Strict TypeScript project checks                                        |
| `npm test` / `npm run test:watch`         | Unit/integration tests, once/watch                                      |
| `npm run data:validate`                   | Validate catalog, notes, stroke data, manifest hashes, and 2,136 count  |
| `npm run checker:selftest`                | Redraw every character with simulated hand error and report accuracy    |
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

## Live site

Every push to `main` is checked, built and published to GitHub Pages by `.github/workflows/deploy.yml`: <https://vitruvianian.github.io/KanjiPain/>. Progress stays in each browser; use Export/Import in Settings to move it between devices.

## Static deployment

Publish **`dist/`** to an HTTPS static host, including `assets/` and `licenses/`. No secrets or server environment variables are needed. Hash routing (`/#/practice`, `/#/collection`, etc.) needs no application-route rewrite rules. Serve the build over HTTP(S), not `file://`.

For a subdirectory deployment, set the Vite base at build time:

```sh
npm run build -- --base=/kanjipain/
```

Publish `dist/` at `/kanjipain/`. Keep the origin stable; moving to another origin requires exporting/importing progress. Vite preview is a local verification server, not the production hosting recommendation.

## Sources and limits

Catalog data is a transformed KANJIDIC2 extract, attributed to **James William Breen and EDRDG**, under **CC BY-SA 4.0**, separate from any application-code license. Stroke data for checking drawings and showing stroke order is a transformed KanjiVG extract (about 6,700 characters, loaded in parts as custom decks need them), © **Ulrich Apel**, under **CC BY-SA 3.0**. Japanese glyphs use bundled **Noto Sans JP**, under **SIL OFL 1.1**. The in-app Sources & licenses page ships the attribution, transformation notice, dates, hashes, and license copies. See [DATA_SOURCES.md](./DATA_SOURCES.md) for provenance and monthly/pre-release maintenance.

The handwriting checker verifies a drawing against the one expected character; it does not recognize arbitrary handwriting, and its thresholds are calibrated on simulated hand error, not yet on collected real handwriting. Version 1 does not provide a full reading/vocabulary curriculum, promise curated mnemonics for every character, sync accounts, or guarantee PWA installation/offline cold starts. Dictionary cues can be ambiguous; use the local pause/resume workflow rather than treating ambiguity as a recall failure. The bundled catalog currently produces a non-fatal Vite chunk-size warning.

Dependency audit at handoff (2026-11-14): `npm audit` reports 9 moderate findings in the development-only ESLint/TypeScript-ESLint/minimatch chain; `npm audit --omit=dev` reports zero. Review toolchain updates separately rather than running `npm audit fix --force` against the pinned stack.

Design and implementation records: [ARCHITECTURE.md](./ARCHITECTURE.md), [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md), and [BUILD_PROGRESS.md](./BUILD_PROGRESS.md).
