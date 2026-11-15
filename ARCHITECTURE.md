# KanjiPain — Product and Architecture

Status: implementation specification, version 1.0  
Date: 2026-11-13  
Companion: [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)

## 1. Product thesis

**Make the effort of recalling kanji useful, visible, and repeatable.**

KanjiPain teaches the standard 2,136 Jōyō kanji through effortful retrieval,
immediate corrective feedback, and spaced practice. Its signature exercise is
writing a character from memory instead of selecting it from a list.

The product's playful severity belongs in its visual identity and occasional
copy. The learning system should be forgiving about mistakes and demanding about
honest recall. Difficulty is useful when the learner can recover; frustration and
repeated uncorrected failure are not objectives.

Promise: **“We won't make kanji effortless. We'll make the effort count.”**

### Learning principles translated into behavior

| Principle            | Application behavior                                                    |
| -------------------- | ----------------------------------------------------------------------- |
| Retrieval practice   | The answer stays hidden until the learner attempts or requests it.      |
| Spacing              | A scheduler chooses when each character returns.                        |
| Corrective feedback  | Compare the attempted character with the target immediately.            |
| Scaffolding          | Optional hints and immediate reveal prevent indefinite guessing.        |
| Delayed retrieval    | Misses return after other questions when possible.                      |
| Interleaving         | Reviews mix characters rather than repeat one continuously.             |
| Honest measurement   | Assisted attempts and short-term retries are not independent successes. |
| Sustainable workload | Limit new material, bound sessions, allow stopping at any time.         |

Do not claim that pain itself improves memory or that the app guarantees retention.
FSRS estimates scheduling needs; it does not measure a person's memory directly.

## 2. Release boundaries

### Version 1: a complete writing-recall product

- Browser-based application, responsive on phones, tablets, and desktops.
- All 2,136 Jōyō characters available in a searchable collection and curriculum.
- English interface; basic kana knowledge is assumed and stated during onboarding.
- Writing recall from English meanings plus Japanese reading cues.
- Introduction, hidden-answer attempt, reveal, self-grade, delayed rematch.
- Drawing input plus an equally valid “I wrote it on paper” mode.
- FSRS scheduling, local progress, resumable sessions, bounded daily introductions.
- Home, practice, summary, collection, character detail, settings, and sources pages.
- JSON export/import of progress.
- Honest loading, persistence-error, empty, and recovery states.
- Bundled learning content; no runtime dictionary service or paid API.

### Later releases: preserve the concept without blocking version 1

1. Curated vocabulary prompts and separate contextual reading/meaning cards.
2. Reviewed component breakdowns, mnemonics, and stroke-order diagrams. (Stroke-order
   diagrams and generated component hints exist; reviewed breakdowns do not.)
3. Deliberate contrast drills for confusable forms such as 未 and 末. (Done: a
   "look-alike pairs" extra session from a generated look-alike list.)
4. Installable PWA with offline cold starts and explicit update handling. (Done: a
   generated service worker and web manifest; the page is fetched network-first.)
5. Optional handwriting recognition with user override. (Done as verification
   against the expected character, see `src/recognition/`.)
6. Optional accounts and cross-device synchronization. (Done: see "Account sync" in
   section 10.) Placement assessment is still open.

Version 1 checks drawn characters against the expected form, including stroke
order and direction, as a suggestion the learner can override. It does **not** pretend to provide complete vocabulary teaching, or curated hints for every
character. The interface must not advertise unfinished features.

## 3. The learning experience

### 3.1 First visit

One short onboarding panel explains:

- “Try to write the character before revealing it.”
- “Compare honestly. A hint means this was an assisted recall.”
- “This first version trains written form. Reading cues help identify the target;
  seeing a cue does not demonstrate that you can read the character.”
- “Progress is saved in this browser. Export a backup to move devices.” Builds with a
  sync server add that signing in from Settings syncs progress across devices.

Defaults: five new characters per local calendar day, twenty primary exercises per
session, drawing mode. Settings may reduce new characters to zero or increase to
ten. Session size is fixed at twenty in version 1.

### 3.2 Introduction

For a new character, show the glyph, English meanings, Japanese readings, and
stroke count. Optional reviewed teaching notes may appear if available.

Button: **“Hide and try.”** There is no compulsory timer. Exposure consumes one
daily introduction slot when the introduction is first displayed and persisted,
not when the learner happens to finish it.

### 3.3 Recall prompt

Example, with the target hidden:

```text
Write the kanji for:

lake
Reading cues: みずうみ / コ

┌──────────────────────────────────┐
│                                  │
│          drawing area            │
│                                  │
└──────────────────────────────────┘

Undo     Clear         Compare answer
Give me a foothold     I don't know
```

The prompt is a cue to the character studied, not a claim that every English word
maps to a unique kanji. See the ambiguity policy in section 6.

- `Compare answer` requires at least one drawn stroke or explicit paper-attempt
  confirmation. It freezes the attempt and reveals the target.
- `I don't know` works immediately, including with an empty canvas, and leads to
  feedback with the eventual grade forced to `missed`.
- No visible countdown, speed bonus, or forced delay before hints.
- Do not mount the target glyph in hidden DOM, tooltips, accessible labels, or
  document titles during recall. This is UI hygiene, not anti-cheating security;
  the static catalog is necessarily present on the device.

### 3.4 Hints

The hint button traverses only hints that exist:

1. Reviewed mnemonic cue, if supplied.
2. Stroke count, available from the catalog.
3. Component cue: a reviewed one if supplied, otherwise one generated from
   KanjiVG's component grouping ("Left: water · Right: every"). Parts are named by
   position, with the component's English name where one is known and its stroke
   count otherwise. About 1,940 of the 2,136 characters have one.
4. Full answer reveal.

Never generate a component explanation from the dictionary radical number. A
dictionary indexing radical is not a full structural decomposition; KanjiVG's
grouping is. Never invent etymology. The ladder climbs from the least revealing
hint to the most.

Any requested hint sets `assisted = true` for that attempt. The default reading
cues are part of the question and do not count as assistance. Revealing after a
submitted attempt is normal feedback and does not retroactively mark it assisted.

### 3.5 Feedback and self-grading

Show the frozen drawing beside the target, drawn from its KanjiVG strokes with the
drawing pad's brush: print fonts form several characters differently from
handwriting (令, 心, 糸, 北, 入). Characters without stroke data fall back to the
Japanese font. In paper mode, show the target and the instruction to compare with
the paper attempt. Characters whose written shapes are easily confused with the
target (a generated look-alike list, see 6) are shown beside it.

Desktop shortcuts: `1`/`2`/`3` grade, `Enter` compares or continues, `H` asks for
a hint, `Escape` cancels a grade override. They are ignored while typing, with
modifier keys, and while a modal dialog is open, and hidden on touch devices.

| Button    | Meaning                            | Scheduler rating |
| --------- | ---------------------------------- | ---------------- |
| Got it    | Correct without extra help         | Good             |
| Barely    | Correct without help, but hesitant | Hard             |
| Missed it | Wrong, incomplete, or assisted     | Again            |

Each grade button shows, beneath its label, how long until the character would come
back if that grade were chosen ("5d", "14h", "<1m"), as flashcard apps do. The values come
from `ReviewService.previewGrades`, which asks the scheduler adapter without saving; the
component only formats them. A rematch has no preview, because it never moves the card,
and says so with the review date already set. The character page gives the next review
as a distance and a date ("In 5 days (…)"), and a Collection tile of a learned character
that is not yet due ends with the same short interval.

`Easy` is deliberately not exposed. With assistance or an explicit surrender,
disable Got it/Barely and explain “Assisted recall — we'll practice this again.”
Show a `Continue — practice again` action that commits `missed`.

The app cannot judge a drawing. Do not imply that it detected errors, calculated a
similarity score, or verified stroke count. Differences in print style and
handwriting are not automatically errors.

After a miss, offer a short repair stage: inspect the answer, optionally hide it
and draw once more, then continue. This immediate repair is unscored and does not
call the scheduler.

### 3.6 Rematches

A failed primary exercise schedules a local rematch. Prefer three completed
exercises on other, distinct cards before showing it again. If the queue has no
other eligible work, offer the rematch immediately with “Short rematch — less
spacing this time,” or let the user finish.

At most two rematches per character per session. A passed rematch ends retries for
that character. A failed second rematch leaves it for a later session. Each retry
uses a fresh canvas and the same hint/self-grade rules.

**Rematches create practice events but never call FSRS.** The primary grade already
scheduled the next spaced review. This keeps a just-seen answer from producing
inflated long-term scheduling confidence.

### 3.7 Session summary

Show distinct, understandable counts:

- Independent reviews: passed, unassisted primary exercises on previously reviewed
  cards. Exclude first-learning checks and rematches.
- New characters introduced: actual exposures in this session.
- Misses recovered: distinct cards missed on a primary and passed on a rematch.
- Needs another round: distinct primary misses without a successful rematch.

“Recovered” does not mean “mastered.” Stopping early creates a valid partial
summary. Unanswered existing cards retain their due dates. Unseen planned new
characters consume no introduction slots.

## 4. Visual design and navigation

### Identity

- Dark palette (default): background `#141414`, surfaces `#20201E`, text `#F3F0E8`,
  muted text `#BCB7AB`, vermilion accent `#E87861`, success accent `#8FB9A2`.
- Light palette: background `#F7F4EE`, surfaces `#FFFFFF`, text `#1D1C19`, muted
  `#5C574D`, accent `#B23F28` with white button text, success `#2E6B4F`. It follows
  `prefers-color-scheme` unless Settings overrides it; the choice is a per-device
  `localStorage` value applied by `index.html` before first paint
  (`src/app/theme.ts`).
- Drawing paper `#F5F0E5`; ink `#1D1C19`, in both themes.
- Use system UI fonts for English. Bundle a Japanese font such as Noto Sans JP
  using a package with its OFL license, and apply `lang="ja"` to Japanese text.
- Four/eight-pixel spacing rhythm, generous whitespace, modest rounded corners.
- No external image dependency, elaborate textures, compulsory sound, or shaking
  error animation. Respect reduced-motion preferences.

Check actual text/background contrast; token choices are not a substitute for
accessibility testing. Use dark text on a filled vermilion button in the dark theme, white in the light.

### Screens

| Route (hash router) | Screen    | Responsibilities                                       |
| ------------------- | --------- | ------------------------------------------------------ |
| `/#/`               | Dojo      | Due count, new allowance, start/resume, recent summary |
| `/#/practice`       | Arena     | One exercise, clear help, save status, finish action   |
| `/#/sessions/:id`   | Summary   | Completed/partial session results                      |
| `/#/collection`     | Wall      | Search, status filters, paginated 2,136-character grid |
| `/#/kanji/:id`      | Character | Meanings, readings, progress, recent event history     |
| `/#/settings`       | Settings  | Daily new limit, input preference, backup tools        |
| `/#/sources`        | Sources   | Data/font acknowledgments, licenses, dataset version   |

Navigation: Dojo, Collection, Settings; Sources linked persistently in the footer.
Practice is visually quieter but always has a labeled exit/finish action.

Collection page size: 120 items. Search the whole catalog before pagination;
support literal character, case-insensitive English substring, and kana reading
substring with hiragana/katakana equivalence. Reset to page one after filters.

Character statuses:

- **Unseen:** no card record.
- **Introduced:** card exists but has no scheduled review event.
- **Developing:** reviewed, but not meeting the reliable threshold.
- **Reliable:** latest three scheduled reviews all unassisted Hard/Good, span at
  least fourteen elapsed days from first to last, and latest scheduled interval is
  at least seven days. This is a display heuristic, not an FSRS state.
- **Due:** independent badge when `dueAt <= now` and not suspended.
- **Paused:** independent badge for an ambiguous/problematic prompt.

Use labels/icons as well as color. An unseen character may be browsed, but browsing
does not enroll it or update scheduling.

### Accessibility and device behavior

- Interactive targets at least 44×44 CSS pixels; visible focus indicators.
- All controls keyboard accessible with native buttons/inputs.
- Drawing has an accessible description and a paper-mode alternative. No claim
  that canvas drawing is keyboard operable.
- Announce feedback with a polite live region; focus the feedback heading on
  reveal. Do not announce the target prematurely.
- At 360px viewport width there is no horizontal page overflow.
- Freeze the submitted drawing; preserve normalized strokes through resizing.
- Do not disable browser zoom or intercept page scrolling outside the canvas.

## 5. Technology decisions

| Concern                    | Decision                                       | Reason                                                        |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| Runtime/toolchain          | Node.js 24 LTS, npm, lockfile                  | Supports the chosen scheduler; one package manager            |
| Frontend                   | React 19 + TypeScript strict + Vite 8          | Straightforward static browser application                    |
| Routing                    | React Router 7, declarative HashRouter         | Works on static hosting without rewrite rules                 |
| Styling                    | Plain CSS with variables and component classes | Small dependency surface, explicit visual rules               |
| Persistence                | IndexedDB through Dexie 4                      | Transactions, structured records, indexed queries             |
| Reactive persistence reads | dexie-react-hooks                              | Update screens after committed database changes               |
| Scheduling                 | ts-fsrs 6.0.0, FSRS-7                          | Existing scheduling implementation behind one adapter         |
| Validation                 | Zod 4                                          | Validate catalog, backups, and persisted version boundaries   |
| Drawing                    | SVG brush outlines (perfect-freehand 1.2.3)    | Stored centreline points; variable-width ink derived on draw  |
| Handwriting check          | Geometric stroke matching against KanjiVG      | Offline, deterministic, explains errors; learner can override |
| Unit/integration tests     | Vitest, Testing Library, fake-indexeddb        | Deterministic domain/storage coverage                         |
| Browser tests              | Playwright: Chromium; WebKit for practice      | Verify actual drawing, reloads, and IndexedDB behavior        |
| Code quality               | ESLint flat config + Prettier + TypeScript     | Explicit repeatable checks                                    |
| Hosting                    | Static `dist/` on any HTTPS static host        | No server or recurring API costs required                     |
| Account sync (optional)    | Supabase: auth + one Postgres table, free tier | Static hosting cannot store accounts; loaded only if set up   |
| Data tooling               | Node scripts via tsx + fast-xml-parser         | Convert KANJIDIC2 once during content maintenance             |

Choose compatible stable versions in the specified majors at bootstrap, pin exact
direct dependency versions, and commit `package-lock.json`. `ts-fsrs` is pinned
specifically because version 6 uses a different API from version 5. Never copy old
`fsrs()/repeat()` examples into the version 6 integration.

There is no global state library, analytics service, remote LLM, or neural
handwriting model in version 1. The only backend is the optional sync server
(section 10, "Account sync"); a build without it makes no network requests of its own. Drawn attempts are verified
locally against bundled reference strokes (`src/recognition/`); the verdict only
suggests a grade. Local-first means progress is local
and practice works without network requests once the app has loaded.

The production build also emits `sw.js` and a web manifest (`vite-plugins.ts`,
`public/manifest.webmanifest`). The service worker precaches the app shell, the
catalog chunk and the Jōyō stroke data, so the app starts with no network once it
has been opened over HTTPS; stroke-data shards for custom decks, font subsets and
license pages are cached as they are first fetched. The page itself is fetched
network-first, so a new deployment shows up on the next online visit. The catalog
loads as its own chunk alongside database startup and is not schema-validated at
runtime: the build validates it and checks its SHA-256. Fonts ship as WOFF2 only.

## 6. Catalog and content pipeline

### Source of truth

Use KANJIDIC2 from EDRDG:

- Dataset: <https://www.edrdg.org/kanjidic/kanjidic2.xml.gz>
- Documentation: <https://www.edrdg.org/wiki/KANJIDIC_Project.html>
- License: <https://www.edrdg.org/edrdg/licence.html>

Select `misc.grade` in `{1,2,3,4,5,6,8}`. This is the Jōyō set. Grades 9/10 are
name-use kanji and are excluded. The result must contain exactly **2,136 distinct
Unicode literals**. Count mismatch is an import failure, not permission to trim
or pad the list. Do not infer modern JLPT levels from the dataset's old JLPT field.

Keep only literal, grade, first stroke count, frequency rank when present, English
meanings, and `ja_on`/`ja_kun` readings. Exclude dictionary search codes and other
fields that are unnecessary for the product.

English meanings have no `m_lang` attribute, or explicitly `en`. Preserve source
ordering while deduplicating. Preserve reading punctuation such as `た.べる` and
`-び`; explain it in character details. Do not treat nanori as ordinary readings.

### Generated assets

```text
src/data/kanji.generated.json       # complete normalized catalog, stable order
src/data/catalog-manifest.json      # source/date/hash/schema/license metadata
src/data/teaching-notes.json        # reviewed hints/overrides (prompt overrides for 3 cue pairs)
src/data/component-hints.generated.json  # KanjiVG component hints, by kanji ID
src/data/lookalikes.generated.json  # characters easily confused with each one
public/licenses/                   # source documentation/license and font notices
scripts/import-kanjidic.ts
scripts/validate-catalog.ts
```

Keep downloaded raw data in ignored `data/raw/`. Commit generated assets so
ordinary installation, tests, and builds require no dictionary download. Import
must accept a local gzipped file for reproducibility; fetching is a separate
explicit maintenance command. Record upstream header date, retrieval date, SHA-256
of the input gzip, SHA-256 of generated catalog bytes, and schema version. Define
`datasetVersion` as SHA-256 of the catalog hash, a newline, and the SHA-256 of the
teaching-notes file bytes. Thus changing a curated prompt also changes the content
version, even when the base dictionary is unchanged.

Stable IDs are `k-` plus lowercase Unicode code point in hexadecimal, padded to at
least four digits: 湖 → `k-6e56`. Preserve literal identity; do not compatibility-
normalize or merge character variants.

Curriculum order in version 1: ascending grade, ascending frequency rank (missing
last), ascending Unicode code point. This is deterministic and understandable;
component-prerequisite ordering is a later curated curriculum.

### Prompt generation and quality

Default prompt: first three English meanings, with all source Japanese on/kun
readings available as cue text. Do not display the target literal. Every imported
character needs at least one English meaning and one Japanese reading; reject and
investigate any gap instead of fabricating content.

The full catalog is usable without manually inventing 2,136 mnemonics or words.
Curated notes are optional and must identify their provenance/reviewer. They may
override prompt text and add mnemonic/component hints. Override prompts must not
contain the target glyph. Validate references and hint order.

After reveal, provide **“Prompt was ambiguous”**. This skips grading, records a
local content issue, pauses the card, and removes its pending rematches. Its FSRS
state is unchanged. Character detail offers **“Resume this prompt”**, which clears
the pause without moving its due date. Export includes issues. This is a local
workflow, not a report sent to a server.

### Attribution and maintenance

KANJIDIC2-derived catalog data is distributed under CC BY-SA 4.0 with EDRDG/James
William Breen attribution, source links, transformation notice, and license copy.
Keep the data license distinct from any eventual application-code license. Include
the actual applicable notices; do not invent a copyright ownership claim.

The sources page and persistent footer acknowledge dictionary use. Include font
license notices. Document a maintainer update procedure and check for dataset
updates monthly and before releases; follow the current upstream license terms.
Updates change static content, never silently reset user progress.

## 7. Module architecture

```text
React routes/components
        │ commands / subscriptions
        ▼
Application services (sessions, reviews, backups)
        │                  │
        ▼                  ▼
Pure domain functions     Dexie repositories / transactions
        │                  │
        ▼                  ▼
FSRS adapter              IndexedDB

Bundled validated catalog → read-only catalog repository → all layers as needed
```

Dependency rules:

1. Domain modules never import React, Dexie, browser globals, or route components.
2. Only the scheduler adapter imports `ts-fsrs`.
3. Only persistence modules create/open Dexie tables. UI uses services/hooks.
4. Time and ID generation are injected into services (`Clock.now()`, `IdSource.next()`).
5. Components render state and dispatch commands; they do not calculate intervals.
6. Pure functions receive all inputs explicitly and do not mutate arguments.
7. No external network calls on the practice path.

Suggested layout:

```text
src/
  app/              # router, providers, startup, error boundary
  components/       # Button, Dialog, DrawingPad, FeedbackPanel, etc.
  features/
    home/
    practice/
    collection/
    settings/
    sources/
  domain/           # types, prompts, queue, session reducer, metrics, status
  scheduler/        # fsrs adapter and serialization
  storage/          # Dexie schema, repositories, backup validation
  services/         # session/review/catalog/backup application services
  data/             # generated catalog and manifest, optional teaching notes
  styles/           # tokens.css, global.css, component styles
scripts/
tests/              # unit/integration support and fixtures
e2e/
```

## 8. Data contracts

All application timestamps are integer UTC epoch milliseconds (`UnixMs`). Local
calendar-day keys are used only for introduction limits and display. Generate
them with local year/month/day getters, not `toISOString().slice(0, 10)`.

```ts
type UnixMs = number;
type KanjiId = string; // validated /^k-[0-9a-f]{4,6}$/ plus catalog membership
type Skill = 'production'; // add other skills through a future schema migration
type Grade = 'got' | 'barely' | 'missed';
type InputMode = 'drawing' | 'paper';

interface KanjiEntry {
  id: KanjiId;
  literal: string;
  grade: 1 | 2 | 3 | 4 | 5 | 6 | 8;
  meanings: string[];
  onReadings: string[];
  kunReadings: string[];
  strokeCount: number;
  frequencyRank: number | null;
  curriculumOrder: number; // unique, 0..2135
}

interface CardRecord {
  id: string; // `${kanjiId}:production`
  kanjiId: KanjiId;
  skill: Skill;
  introducedAt: UnixMs;
  introducedLocalDay: string; // YYYY-MM-DD at first exposure
  introducedInSessionId: string;
  dueAt: UnixMs;
  schedulerState: SerializedFsrsCard;
  scheduledReviewCount: number;
  suspended: boolean;
  version: number; // optimistic concurrency counter, starts at 0
}

interface Point {
  x: number;
  y: number;
} // normalized [0,1]
type Stroke = Point[];

interface ProductionPrompt {
  kanjiId: KanjiId;
  meaningCue: string;
  readingCues: string[];
  hints: Array<{
    key: 'mnemonic' | 'component' | 'stroke-count';
    text: string;
  }>;
  // Full reveal is an action, not a hint object containing the answer.
}

interface ContentIssue {
  id: string;
  cardId: string;
  eventId: string;
  reason: 'ambiguous-prompt';
  createdAt: UnixMs;
  datasetVersion: string;
}

interface AttemptDraft {
  id: string;
  itemId: string;
  startedAt: UnixMs;
  inputMode: InputMode;
  strokes: Stroke[];
  paperAttemptConfirmed: boolean;
  hintKeysUsed: string[];
  surrendered: boolean;
  revealedAt: UnixMs | null;
}

interface ReviewEvent {
  id: string; // equal to attempt ID; unique, idempotency key
  sessionId: string;
  cardId: string;
  itemId: string;
  kind: 'scheduled' | 'rematch' | 'ambiguous';
  isFirstLearningCheck: boolean;
  grade: Grade | null; // null only for ambiguous
  assisted: boolean;
  hintKeysUsed: string[];
  inputMode: InputMode;
  occurredAt: UnixMs;
  durationMs: number; // informational only, never a rating input
  beforeVersion: number;
  afterVersion: number;
  schedulerLog: SerializedFsrsLog | null; // scheduled events only
  datasetVersion: string;
}
```

`SerializedFsrsCard`/`SerializedFsrsLog` are explicitly validated JSON forms of the
pinned library's complete card/log types, with Date values converted to epoch
milliseconds. Derive actual field names from the installed version, preserve every
scheduler field, and keep those details inside the adapter. Do not invent a
four-field substitute for FSRS-7's state. Add an envelope containing adapter
version `1`, package version `6.0.0`, and model `FSRS-7`.

### Session persistence

Persist a `SessionRecord` with:

- ID, status (`active | completed | ended`), revision, start/end timestamps,
  local start day, dataset version.
- Ordered primary items `{id, cardId, kanjiId, origin: due | new, status:
pending | done | skipped}` and expected card version when an attempt starts.
- Ordered rematch items `{id, cardId, ordinal: 1 | 2, afterOtherCompletions:
[{cardId, eventId}], status}`; track distinct other cards since enqueueing.
- Active item ID, current phase, current `AttemptDraft`, and fixed primary limit.
- Persisted completed-exercise event references for deterministic resumption.

Store full primary/rematch item state in the session record; keep event history in
its own table. A session is small (maximum sixty exercises). Strokes are retained
only in the active draft, cleared on advancing to the next exercise, and omitted
from history/backups. Version 1 does not provide a handwriting gallery.

### IndexedDB tables (database `kanjipain`, version 3)

| Table           | Primary key and useful indexes                                   |
| --------------- | ---------------------------------------------------------------- |
| `cards`         | `id`, `dueAt`, `kanjiId`, `introducedLocalDay`                   |
| `events`        | `id`, `sessionId`, `cardId`, `occurredAt`, `[cardId+occurredAt]` |
| `sessions`      | `id`, `status`, `startedAt`                                      |
| `settings`      | singleton `id = 'user'`                                          |
| `contentIssues` | `id`, `cardId`, `createdAt`                                      |
| `meta`          | singleton/versioned keys for app and backup metadata             |
| `decks`         | `id` (custom decks only; the Standard deck is never stored)      |
| `deckEntries`   | `id` = `deckId:kanjiId`, `deckId`, `kanjiId`                     |
| `syncShadow`    | `key` = `collection/id`; fingerprint of the cloud's copy         |

Do not index booleans in IndexedDB. Filter `suspended` in memory after querying the
small due set. There is at most one active session, enforced by reading/creating
sessions inside one read-write transaction on the sessions table.

Version 2 added the two deck tables and `settings.activeDeckId`; the upgrade leaves
cards, events and sessions untouched. Version 3 added `syncShadow` for account sync;
it stays empty until someone signs in. The sync position and account live in `meta`
under the key `sync`.

### Decks

- The Standard deck is the bundled catalog under the fixed ID `standard`. It is not a
  row, so nothing can edit it; `DeckService` also rejects every mutation aimed at it.
- A custom deck is a `decks` row plus one `deckEntries` row per character (`literal`,
  `meanings`, `readingCues`, optional `note`/`mnemonic`, `position`, `strokeStatus`,
  `strokeCount`).
- **One card per character, shared across decks.** A deck decides which cards a session
  uses and what the prompt says. `DeckContent` (`src/services/deck-content.ts`) is the
  single answer to "entry for this character in this deck"; sessions, prompts, the Dojo
  and the Collection read it instead of the catalog. `planSession` ignores cards outside
  the deck and entries with no cue.
- Sessions store `deckId`/`deckRevision` (absent for Standard) and keep that deck until
  they end. A deck with an active session cannot be edited or deleted.
- Stroke data for all KanjiVG characters ships as 64 lazily loaded shards
  (`src/data/stroke-shards/`, keyed by code point modulo 64). The Jōyō file is unchanged,
  so the default experience downloads nothing extra. A character with no stroke data is
  `unrecognized`: no guide, no check, no `checkerVerdict`.

Settings: `dailyNewLimit` (integer 0..10), `inputMode`, `onboardingCompleted`, `activeDeckId`,
`reviewPace` (`relaxed | steady | frequent | intensive`).
No user identity or timezone service is required; an account is optional. Timezone changes follow the
device's new local day; introduction caps are a convenience, not an anti-abuse rule.

## 9. Scheduler and session algorithms

### FSRS adapter

Initialize once, asynchronously, using the version 6 API, one scheduler per review pace:

```ts
const scheduler = await DefaultScheduler({
  version: 'FSRS-7',
  desiredRetention: RETENTION_BY_PACE[pace], // relaxed 0.90, steady 0.93, frequent 0.95, intensive 0.97
  enableShortTerm: false,
  enableFuzz: false,
  maximumInterval: 36_500,
});
```

Use `scheduler.newCard({ now })` and
`scheduler.review({ card, grade: Rating.Good /* mapped grade */, now })`.
Use the library's returned due date; do not implement your own interval formula or
overwrite FSRS dates to force the rematch queue. No parameter optimization in v1.

**Review pace.** `settings.reviewPace` chooses the retention target, and so how soon
characters return. FSRS-7 is steep in this parameter: a new character always graded "Got
it" returns after 5 days, 26 days, 3 months and 10 months at 0.90 (`relaxed`); 2, 9 and 28
days at 0.93 (`steady`); 1, 4, 11 and 25 days at 0.95 (`frequent`, close to Anki's
defaults); and 1, 1, 3, 6 and 11 days at 0.97 (`intensive`). New installations start
on `frequent`; settings saved before the choice existed read as `relaxed`, the only pace
there was, so nobody's schedule changes without them asking. The pace changes only due
dates: stability and difficulty after a review are the same at every pace.

One deliberate exception to "use the library's due date": a recalled character (Got it or
Barely) is never due sooner than 24 hours later. The higher targets otherwise ask for it
again within hours, which a once-a-day practice habit cannot use. A miss stays due at once.

Changing the pace (`SettingsService.setReviewPace`) moves the next review of every learned
character in one transaction, by replaying its scheduled reviews at the new pace
(`rescheduleCard`). A card is left alone if it is paused, has no review yet, or its
history does not reproduce its stored memory state. An open session is reconciled as it
is after a sync. The pace syncs with the account, and the moved cards sync as ordinary
card changes.

Adapter surface:

```ts
interface SchedulerAdapter {
  create(now: UnixMs): { state: SerializedFsrsCard; dueAt: UnixMs };
  review(
    state: SerializedFsrsCard,
    grade: Grade,
    now: UnixMs,
  ): {
    state: SerializedFsrsCard;
    log: SerializedFsrsLog;
    dueAt: UnixMs;
  };
}
```

Reject a review whose timestamp precedes the card's latest recorded scheduled
review. Show a clock-error recovery message; never silently write negative elapsed
time. Mock the adapter in session tests, but integration-test the real adapter.

### Starting a session

1. Resume an active session instead of creating another.
2. Query introduced, unsuspended cards with `dueAt <= now`.
3. Sort by dueAt, then curriculumOrder, then card ID. Select at most twenty.
4. Count introductions on the device's current local day.
5. If at least twenty cards are due, add no new characters. Otherwise select unseen
   characters in curriculum order up to `min(dailyNewLimit - introducedToday,
20 - selectedDueCount)`, clamped at zero.
6. Primary order is selected due cards followed by selected new characters.
7. Do not create card rows for planned new characters yet. Create a card and persist
   its introduction metadata when its introduction is actually opened.
8. If the plan is empty, show “You're done for now” with the next due time if any.

Opening a planned new item must recheck the current day's limit. If it is exhausted
(settings changed, another completed session, or a resumed session crossed a day),
skip the planned item without creating a card. A previously exposed card does not
consume a second slot. Unreviewed introduced cards remain due; reopening one shows
its introduction before its first learning check.

### Choosing the next exercise

1. Prefer the oldest eligible pending rematch whose gap includes three distinct
   other completed cards.
2. Otherwise choose the next pending primary item.
3. If only ineligible rematches remain, offer the oldest as a short rematch or finish.
4. If no pending items remain, complete the session.

Completion of a graded primary/rematch counts toward other cards' gaps; skipped
ambiguity events and unscored repairs do not. Never enqueue duplicate pending
rematches for a card. A failure of rematch 1 may enqueue rematch 2; rematch 2 never
enqueues more. The session has at most twenty primaries and forty rematches.

### State machine

```text
select item
  ├─ new/unreviewed → introduction → prompt
  └─ previously reviewed/rematch → prompt
prompt → feedback                 (compare or surrender)
feedback → commit grade → repair  (missed)
feedback → commit grade → select  (passed)
feedback → ambiguity skip → select
repair → select                   (no scheduler call)
select → summary                  (done or user finishes)
```

Pause/resume is navigation, not a new session. `Finish session` marks it ended and
cancels unprocessed planned work. Ending while in feedback does not invent a grade;
the card remains due. If a committed miss is still in repair, that grade remains
committed and summary metrics include it.

### Atomicity, durability, and concurrent tabs

Each transition checks the session revision. Each grade command carries attempt
ID, expected session revision, and expected card version.

Inside one Dexie transaction covering cards/events/sessions/contentIssues:

1. If the attempt event already exists, return its result without a second write.
2. Verify the active item, revision, reveal phase, and card version.
3. Apply forced assistance grading in the service, not just the UI.
4. For a scheduled event, call the synchronous adapter review on the loaded state.
5. Write the event, updated card if applicable, session progression/retry metadata,
   and incremented revision together.

For ambiguity, pause the card and insert the issue/event in the same transaction.
For rematches, leave card scheduler state/version unchanged; session revision and
event ID still prevent duplicate commits. Never await network or initialize FSRS
inside a transaction; initialize the adapter before making services available.

Save completed strokes, clear/undo, hint requests, reveal, and input-mode changes
through a serialized draft-save queue with revision checks. Await pending saves
before reveal/grade/navigation. A stroke interrupted before pointer-up may be lost;
completed acknowledged strokes should survive reload. On reload after reveal,
restore feedback with the same draft and hint status, never a fresh attempt.

On a stale revision, stop editing, reload canonical session state, and display
“This session changed in another tab.” Do not silently overwrite. A failed write
keeps the current attempt on screen and offers retry; never show a successful grade
before its transaction commits.

## 10. Backup, updates, and errors

### Backup format v2

JSON envelope: `format: 'kanjipain-backup'`, `version: 2`, export timestamp,
dataset version, scheduler adapter metadata, cards, events, completed/ended
sessions, settings, content issues, custom `decks` and `deckEntries`. Do not
duplicate the static catalog. Version 1 files (no decks) still import. Cards are not
required to belong to a deck: deleting a deck leaves its cards, and such a backup
must stay importable. The preview reports how many cards are outside every deck.

- Export/import is enabled only when there is no active session. Link to resume or
  finish it. This makes restore semantics explicit and avoids partial attempts.
- Export excludes all drawing data. Show this fact in the UI.
- Import is **replace**, not merge. Validate the complete file before any writes.
- Check IDs, references, timestamps, enums, unique event IDs, compatible scheduler
  metadata, card states, session statuses, and catalog membership.
- Reject unsupported versions, malformed kanji IDs or deck entries, malformed data, and files larger
  than 25 MiB with a useful message. No partial imports.
- Show a preview of counts and request confirmation to replace current progress;
  offer export of current progress first. Replace all user tables in one transaction.
- A different dataset content hash with the same schema and matching IDs is allowed;
  preserve history's original dataset metadata.

### Account sync

Optional, and absent from builds without `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`.
IndexedDB stays the source of truth; sync is a background round that never runs inside a
grade transaction and that practice never waits for (`src/services/sync/`).

- **Server.** One table, `sync_records(user_id, generation, collection, id, data, deleted,
device_id, seq)`, with row-level security limiting each invited user to their own rows
  (`supabase/schema.sql`). The server stores JSON and numbers changes; it validates
  nothing. Everything pulled is validated with the same Zod schemas as a backup, and an
  unreadable record fails the round without applying any of it.
- **Collections.** `sessions` (finished ones; an open session is uploaded as "ended so
  far" and later revisions replace it), `events`, `issues`, `cards`, `decks` (a deck and
  its entries as one record, with a tombstone when deleted), `settings` (daily limit,
  onboarding, active deck, review pace). Drawings, input mode and theme stay on the device.
- **Change detection.** No outbox: `syncShadow` holds a fingerprint of what the cloud is
  known to hold for each record, and a round uploads whatever differs. No write path can
  forget to queue a change. A deck in the shadow but not in the database was deleted here.
- **A round** (`SyncEngine.sync`): pull every change after the stored position that
  another device made, merge it in one transaction, then upload differences in the order
  sessions, events, issues, cards, decks, settings, so references exist before what
  refers to them.
- **Merging** (`src/domain/sync-merge.ts`). Events, issues and finished sessions are
  unions. A card unchanged here takes the cloud's copy. A card changed on both sides, or
  one whose `scheduledReviewCount` is behind its scheduled events, is rebuilt by replaying
  all its scheduled reviews in time order through the scheduler adapter; fuzz is off, so
  every device computes the same state. A paused card stays paused if either side paused
  it. A deck changed on both sides keeps the later `updatedAt`. Remote settings win.
- **Open session.** A pull never replaces it. Pending items whose card another device
  reviewed are skipped, the rest get the card's new version, and the session's revision
  increases so an open practice screen reloads it. A session whose deck changed is ended.
- **Generations.** Restoring a backup while signed in starts a new generation: the cloud
  copy is replaced, and other devices replace their data at their next round instead of
  merging. Deleting the cloud copy signs other devices out and leaves their data alone.
- **Accounts.** A device remembers whose data it holds. Signing in with no previous
  account merges local progress into the account; a different account must replace the
  device's data first.
- **Triggers.** Sign-in, app start, a change to any synced table (debounced), coming back
  online and returning to the tab. Tabs take turns through the Web Locks API.

### Content/app updates

All executable code/catalog assets are deployed together with cache-busted build
filenames. Do not modify an active session's prompts underneath the learner. If an
active session's dataset version differs after reload, present a summary and end
that old session before creating a new one; retain committed cards/events and leave
unanswered cards due. Discard only its ungraded draft.

Future Dexie versions require explicit migrations tested against a prior-version
fixture. A scheduler-library/model upgrade requires a separate state migration and
compatibility decision. Never reset the database to resolve a migration error.

### Failure states

- Catalog invalid: blocking startup error with retry; no partial production catalog.
- IndexedDB unavailable: explain that progress cannot be saved; do not imply a
  functioning persistent practice mode.
- Storage quota/write failure: retain in-memory attempt, show retry and backup path
  after recovery, never silently advance.
- No due cards/new limit zero: quiet completed state, collection link.
- Invalid character/session URL: explicit not-found state.
- Host unavailable before initial load: the service worker serves the cached app
  after the first visit over HTTPS; on a first visit, normal browser behavior.

## 11. Development rules

1. Implement the version 1 scope before any roadmap feature.
2. Follow the companion plan in order; complete one checkpoint at a time.
3. Treat this document as the source of truth. If a decision must change, update
   both documents and state why rather than silently diverging.
4. Keep scheduler math, queue selection, metrics, and status calculations pure.
5. Use strict TypeScript; validate untrusted JSON. No unexplained `any`, blanket
   lint suppression, or unchecked `as` casts at data boundaries.
6. Do not store progress in localStorage. Do not have two sources of truth for
   persisted session state. React state may hold rendering/input-in-progress only.
7. Never bypass transactions for grade writes. Retry requests must be idempotent.
8. No synthetic catalog entries, invented linguistic facts, or borrowed proprietary
   mnemonics. Fixtures are allowed only in tests/development harnesses.
9. No AI API calls in learning, grading, or catalog generation. Curated additions
   require source verification, not confidence in model output.
10. Test domain invariants and actual failure modes, not just rendered snapshots.
11. Use npm scripts for repeatable checks; keep install/data-fetch separate from tests.
12. Keep dependencies purposeful; do not introduce a backend to solve a UI problem.
13. Do not call a feature complete with placeholder buttons or in-memory progress.
14. Preserve user data across reloads, app changes, and failed writes.
15. Make every release usable with keyboard navigation and paper input.

## 12. Version 1 release criteria

- Exactly 2,136 valid, unique Jōyō entries and visible data attribution.
- New introduction → attempt → feedback → persisted grade → rematch → summary works.
- Existing due cards receive exactly one FSRS update per primary attempt.
- Assisted responses cannot become independent successes through UI or service calls.
- Drawing works with mouse/touch/pen; paper mode needs no drawing input.
- Reload preserves active session, revealed state, and committed progress.
- Concurrent tabs and rapid clicks cannot double-grade a card.
- Daily limits, twenty-primary/sixty-total bounds, and early finish behave as specified.
- Collection/search/status and validated backup round-trip work for the full dataset.
- Formatting, lint, typecheck, unit/integration tests, build, and browser tests pass.
- Phone-width and desktop flows are manually reviewed; sources/licenses are shipped.

## 13. Reference versions and documentation

Consulted 2026-11-13; package lockfile becomes the authority after implementation.

- KANJIDIC2 documentation/license: links in section 6.
- ts-fsrs v6 usage:
  <https://github.com/open-spaced-repetition/ts-fsrs/tree/main/packages/fsrs>
- FSRS quick start:
  <https://open-spaced-repetition.github.io/ts-fsrs/guide/quick-start>
- Dexie transactions: <https://dexie.org/docs/Dexie/Dexie.transaction()>
- React: <https://react.dev/>
- Vite: <https://vite.dev/>

The current scheduler documentation confirms `DefaultScheduler`, `newCard`, and
`review`; use the pinned package's declarations when implementing serialization.
